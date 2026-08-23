/**
 * Task model + persistent store for dsh-task-runner.
 *
 * Tasks live in a `task-runner` storage domain (KV table `tasks` plus a
 * `global.taskOrder` array mirroring the workspace registry's
 * `global.workspaceIds` ordering scheme). The store is the single
 * authoritative CRUD surface shared by the RPC channel and the LLM tool.
 * @module @xiaoso/dsh-task-runner/tasks
 */

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.storageDomain` Context merge.
import type {} from '@deepseek-ai/dsh-storage-domain'
import { type Domain, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/** Task id: a uuid string. */
export type TaskId = string

/** Task type: `llm` sends a prompt into the current session; `command` runs a bash command in the background. */
export type TaskType = 'llm' | 'command'

/** Visibility scope. `global` shows in every workspace; `workspace` only in the declared one. */
export type TaskScope = 'global' | 'workspace'

/** One run configuration (see docs/预案-任务运行器.md §2.2). */
export interface TaskRecord {
  id: string
  name: string
  /** Optional note describing what this task does. */
  description?: string
  type: TaskType
  scope: TaskScope
  /** Canonical workspace directory path; required when scope === 'workspace'. */
  workspacePath?: string
  /** type === 'llm': the prompt sent to the LLM when the task runs. */
  llmPrompt?: string
  /** type === 'command': the bash command executed in the background. */
  command?: string
  /** type === 'command': notify the session LLM when the job finishes (default true). */
  notifyLlm?: boolean
  createdAt: string
  updatedAt: string
}

/** Storage schema for one task record (zod — the storage domain layer's schema language). */
export const taskRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['llm', 'command']),
  scope: z.enum(['global', 'workspace']),
  workspacePath: z.string().optional(),
  llmPrompt: z.string().optional(),
  command: z.string().optional(),
  notifyLlm: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Input accepted by {@link TaskStore.create}. */
export interface TaskCreateInput {
  name: string
  description?: string
  type: TaskType
  scope: TaskScope
  workspacePath?: string
  llmPrompt?: string
  command?: string
  notifyLlm?: boolean
}

/** Partial update accepted by {@link TaskStore.update}. */
export type TaskPatch = Partial<Omit<TaskCreateInput, 'name' | 'type' | 'scope'>> & {
  name?: string
  type?: TaskType
  scope?: TaskScope
}

/** The storage domain spec: one table plus the global order array. */
export const TASK_STORE_SPEC = defineDomain({
  // Domain names allow only [a-z0-9_]; the settings namespace keeps the
  // kebab-case 'task-runner' spelling.
  name: 'task_runner',
  version: 1,
  global: {
    schema: z.object({ taskOrder: z.array(z.string()) }),
    initial: { taskOrder: [] },
  },
  tables: {
    tasks: domainTable<TaskId, TaskRecord>(taskRecordSchema),
  },
})

/** Read side of a task for JSON RPC / tool results: identical to the record. */
export type TaskView = TaskRecord

/** Validate and normalize a user-supplied task input into a plain record. */
export async function validateTaskInput(input: TaskCreateInput): Promise<TaskCreateInput> {
  const name = input.name.trim()
  if (name.length === 0) throw new Error('task name must not be empty')
  // llmPrompt / command are intentionally allowed to be empty here: the
  // dialog creates an editable draft (IDEA-style) and fills it later. The
  // run-time guards reject empty prompts (RunControl) and empty commands
  // (runCommandTask) so an unfinished draft can never execute.
  if (input.scope === 'workspace') {
    if (input.workspacePath === undefined || input.workspacePath.trim().length === 0) {
      throw new Error('workspace-scoped tasks require a workspacePath')
    }
  }
  const workspacePath =
    input.scope === 'workspace'
      ? await canonicalizeWorkspacePath(input.workspacePath as string)
      : undefined
  return {
    name,
    type: input.type,
    scope: input.scope,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(workspacePath !== undefined ? { workspacePath } : {}),
    ...(input.llmPrompt !== undefined ? { llmPrompt: input.llmPrompt } : {}),
    ...(input.command !== undefined ? { command: input.command } : {}),
    ...(input.notifyLlm !== undefined ? { notifyLlm: input.notifyLlm } : {}),
  }
}

/**
 * Canonicalize a workspace directory path: `fs.realpath` wins (resolves
 * symlinks, case, and separator form); on failure (path does not exist yet)
 * fall back to a resolved absolute path. Mirrors the plan's rule that
 * `workspacePath` is a canonical path, never an id.
 */
export async function canonicalizeWorkspacePath(input: string): Promise<string> {
  try {
    return await realpath(input)
  } catch {
    return path.resolve(input)
  }
}

/**
 * Open the task store on the caller's context. The storage-domain handle is
 * closed on fiber disposal.
 * @param ctx - plugin context (requires `storageDomain`).
 */
export async function openTaskStore(ctx: Context): Promise<TaskStore> {
  const domain = await ctx.storageDomain.open(TASK_STORE_SPEC)
  ctx.effect(
    () => () => {
      void domain.close()
    },
    'task-runner: storage domain close',
  )
  return new TaskStore(domain)
}

/** Pure ordering: records in persisted order, unknown ids appended in insertion order. */
export function orderTasks(
  records: IterableIterator<[TaskId, TaskRecord]> | readonly TaskRecord[],
  order: readonly string[],
): TaskRecord[] {
  const byId = new Map<string, TaskRecord>()
  for (const entry of records) {
    if (Array.isArray(entry)) byId.set(entry[0], entry[1])
    else byId.set(entry.id, entry)
  }
  const ordered: TaskRecord[] = []
  for (const id of order) {
    const record = byId.get(id)
    if (record !== undefined) {
      ordered.push(record)
      byId.delete(id)
    }
  }
  for (const record of byId.values()) ordered.push(record)
  return ordered
}

/** Task CRUD over the storage domain. */
export class TaskStore {
  private readonly table: ReturnType<Domain<typeof TASK_STORE_SPEC>['table']>
  private readonly global: Domain<typeof TASK_STORE_SPEC>['global']

  constructor(domain: Domain<typeof TASK_STORE_SPEC>) {
    this.table = domain.table('tasks')
    this.global = domain.global
  }

  /** All tasks in persisted display order (unknown ids appended in insertion order). */
  list(): TaskView[] {
    return orderTasks(this.table.entries(), this.global.get().taskOrder)
  }

  get(id: TaskId): TaskView | undefined {
    return this.table.get(id)
  }

  async create(input: TaskCreateInput): Promise<TaskView> {
    const normalized = await validateTaskInput(input)
    const now = new Date().toISOString()
    const record: TaskRecord = {
      id: randomUUID(),
      ...normalized,
      createdAt: now,
      updatedAt: now,
    }
    await this.table.put(record.id, record)
    await this.appendOrder(record.id)
    return record
  }

  async update(id: TaskId, patch: TaskPatch): Promise<TaskView> {
    const current = this.table.get(id)
    if (current === undefined) throw new Error(`task ${id} not found`)
    const merged: TaskCreateInput = {
      name: patch.name ?? current.name,
      type: patch.type ?? current.type,
      scope: patch.scope ?? current.scope,
      description: patch.description !== undefined ? patch.description : current.description,
      workspacePath:
        patch.workspacePath !== undefined ? patch.workspacePath : current.workspacePath,
      llmPrompt: patch.llmPrompt !== undefined ? patch.llmPrompt : current.llmPrompt,
      command: patch.command !== undefined ? patch.command : current.command,
      notifyLlm: patch.notifyLlm !== undefined ? patch.notifyLlm : current.notifyLlm,
    }
    const normalized = await validateTaskInput(merged)
    const record: TaskRecord = {
      ...current,
      ...normalized,
      updatedAt: new Date().toISOString(),
    }
    await this.table.put(id, record)
    return record
  }

  async delete(id: TaskId): Promise<boolean> {
    const removed = await this.table.delete(id)
    if (removed) await this.removeOrder(id)
    return removed
  }

  /** IDEA Duplicate semantics: a same-name copy with a fresh id (the user renames it). */
  async duplicate(id: TaskId): Promise<TaskView> {
    const current = this.table.get(id)
    if (current === undefined) throw new Error(`task ${id} not found`)
    const now = new Date().toISOString()
    const record: TaskRecord = {
      ...current,
      id: randomUUID(),
      name: current.name,
      createdAt: now,
      updatedAt: now,
    }
    await this.table.put(record.id, record)
    await this.appendOrder(record.id)
    return record
  }

  /** Persist a full display order. Unknown ids are tolerated and ignored. */
  async reorder(ids: TaskId[]): Promise<void> {
    await this.global.set({ taskOrder: [...ids] })
  }

  private async appendOrder(id: TaskId): Promise<void> {
    const order = this.global.get().taskOrder
    if (order.includes(id)) return
    await this.global.set({ taskOrder: [...order, id] })
  }

  private async removeOrder(id: TaskId): Promise<void> {
    const order = this.global.get().taskOrder
    if (!order.includes(id)) return
    await this.global.set({ taskOrder: order.filter((candidate) => candidate !== id) })
  }
}

/** Narrow the spec constant type for use as a generic argument. */
type TaskStoreSpec = typeof TASK_STORE_SPEC
type TaskStoreDomain = Domain<TaskStoreSpec>

export type { TaskStoreDomain, TaskStoreSpec }
