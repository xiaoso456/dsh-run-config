/**
 * The `task_runner_config` model tool: lets the LLM list run configurations
 * (with full prompts) and manage them (create/update/delete/duplicate).
 * Read operations run freely; write operations are gated by the official
 * `tools/pre-execute` approval mechanism (see decideTaskRunnerApproval /
 * registerTaskRunnerApprovalGate) — the tool itself never touches approval.
 * Description and parameters are fixed English (matching the official tool
 * surface convention — the tool does not follow the UI locale).
 * @module @xiaoso/dsh-task-runner/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getApprovalLocale } from './locale.ts'
import type { TaskPatch, TaskScope, TaskStore, TaskType } from './tasks.ts'

/** One task-management action. */
export type TaskRunnerAction = 'list' | 'create' | 'update' | 'delete' | 'duplicate'

/** Tool arguments: `action` plus per-action optional fields. */
export interface TaskRunnerToolArgs {
  action: TaskRunnerAction
  /** list: filter tasks by name substring. */
  query?: string
  /** update/delete/duplicate: the target task id. */
  id?: string
  /** create/update: task name. */
  name?: string
  /** create/update: optional note describing what the task does. */
  description?: string
  /** create/update: 'llm' | 'command'. */
  type?: TaskType
  /** create/update: 'global' | 'workspace'. */
  scope?: TaskScope
  /** create/update (scope=workspace): canonical workspace path. */
  workspacePath?: string
  /** create/update (type=llm): the prompt sent to the LLM on run. */
  llmPrompt?: string
  /** create/update (type=command): the bash command to run. */
  command?: string
  /** create/update (type=command): notify the session LLM on completion. */
  notifyLlm?: boolean
}

/** Write actions that go through the approval gate. */
const WRITE_ACTIONS: readonly TaskRunnerAction[] = ['create', 'update', 'delete', 'duplicate']

/** Decision returned by a `tools/pre-execute` guard. */
export type TaskRunnerGateDecision =
  | { kind: 'allow' }
  | { kind: 'ask'; reason: string }
  | { kind: 'deny'; reason: string }

/** One-line approval reason shown in the approval prompt (i18n: zh/en). */
function writeApprovalReason(
  action: TaskRunnerAction,
  args: TaskRunnerToolArgs,
  locale: 'zh' | 'en',
): string {
  const plugin = locale === 'zh' ? '【dsh-task-runner】' : '[dsh-task-runner] '
  const typeName = (type: string | undefined): string =>
    locale === 'zh'
      ? type === 'command'
        ? '命令任务'
        : 'LLM 任务'
      : type === 'command'
        ? 'command task'
        : 'LLM task'
  const scopeName = (scope: string | undefined): string =>
    locale === 'zh'
      ? scope === 'global'
        ? '全局'
        : '工作区'
      : scope === 'global'
        ? 'global'
        : 'workspace'
  switch (action) {
    case 'create':
      return (
        plugin +
        (locale === 'zh'
          ? `创建任务「${args.name ?? ''}」（${typeName(args.type)}，${scopeName(args.scope)}）`
          : `Create task "${args.name ?? ''}" (${typeName(args.type)}, ${scopeName(args.scope)})`)
      )
    case 'update':
      return locale === 'zh'
        ? `${plugin}更新任务「${args.id ?? ''}」`
        : `${plugin}Update task "${args.id ?? ''}"`
    case 'delete':
      return locale === 'zh'
        ? `${plugin}删除任务「${args.id ?? ''}」`
        : `${plugin}Delete task "${args.id ?? ''}"`
    case 'duplicate':
      return locale === 'zh'
        ? `${plugin}复制任务「${args.id ?? ''}」`
        : `${plugin}Duplicate task "${args.id ?? ''}"`
    default:
      return locale === 'zh'
        ? `${plugin}管理任务配置（${action}）`
        : `${plugin}Manage task configuration (${action})`
  }
}

/**
 * Official-pattern approval gate for `task_runner_config` (pure, unit-testable).
 *
 * The harness runs `tools/pre-execute` before every tool call; a guard
 * returning `{ kind: 'ask' }` makes the ToolRuntime resolve the decision
 * through the standard approval seam (`serviceAsk` → `approval.request`),
 * while `{ kind: 'allow' }` skips approval entirely. Per the official
 * permission-presets semantics, a session with `danger-full-access` sandbox
 * mode needs no approval for write actions — the sandbox mode is the
 * deployment's policy; the tool itself never touches `approval` directly.
 *
 * Returns `undefined` for anything the gate does not cover (other tools and
 * the read-only `list` action), so the waterfall falls through to the next
 * guard.
 */
export function decideTaskRunnerApproval(
  execName: string,
  action: string | undefined,
  args: TaskRunnerToolArgs,
  mode: string | undefined,
  locale: 'zh' | 'en' = 'en',
): TaskRunnerGateDecision | undefined {
  if (execName !== 'task_runner_config') return undefined
  if (typeof action !== 'string' || !WRITE_ACTIONS.includes(action as TaskRunnerAction)) {
    return undefined
  }
  const typed = action as TaskRunnerAction
  if (mode === 'danger-full-access') return { kind: 'allow' }
  return { kind: 'ask', reason: writeApprovalReason(typed, args, locale) }
}

/**
 * Shared JSON schema for one task in tool results (mirrors the TaskRecord
 * shape). Every field of TaskRecord MUST be declared here — the harness
 * validates tool output against this schema with `additionalProperties:
 * false` and rejects the whole call when a record carries an undeclared
 * field (the `tests/tool-schema.spec.ts` regression test enforces this).
 */
export const TASK_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    type: { type: 'string', required: true },
    scope: { type: 'string', required: true },
    workspacePath: { type: 'string' },
    llmPrompt: { type: 'string' },
    command: { type: 'string' },
    notifyLlm: { type: 'boolean' },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

/** Register the task-management tool; returns the exact disposer. */
export function registerTaskRunnerTool(ctx: Context, store: TaskStore): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'task_runner_config',
      description:
        'Manage dsh-task-runner run configurations (tasks) for the web run-control: ' +
        'list existing tasks (global and workspace-scoped, including their full prompts, commands, and descriptions), ' +
        'or create / update / delete / duplicate a task. ' +
        'list needs no approval; write actions (create, update, delete, duplicate) go through the session approval gate ' +
        '(skipped automatically under danger-full-access sandbox). ' +
        'Example: to create a command task that waits 3 seconds then says hello, call ' +
        'action=create, type=command, scope=global, name="...", command="sleep 3 && echo hello", notifyLlm=true ' +
        '(the session is notified when the background command finishes).',
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: 'The operation: "list", "create", "update", "delete", or "duplicate".',
        },
        query: {
          type: 'string',
          description:
            'With action=list: return only tasks whose name contains this substring (case-insensitive).',
        },
        id: { type: 'string', description: 'Task id; required for update, delete, and duplicate.' },
        name: { type: 'string', description: 'Task name (create; optional in update).' },
        description: {
          type: 'string',
          description: 'Optional note describing what the task does (create; optional in update).',
        },
        type: {
          type: 'string',
          description:
            'Task type: "llm" (sends a prompt into the current session) or "command" (runs a bash command in the background).',
        },
        scope: {
          type: 'string',
          description:
            'Task scope: "global" (visible in every workspace) or "workspace" (visible only in the declared workspace).',
        },
        workspacePath: {
          type: 'string',
          description: 'Canonical workspace directory path; required when scope=workspace.',
        },
        llmPrompt: {
          type: 'string',
          description:
            'For type=llm tasks: the prompt sent to the LLM when the task runs. Required for llm tasks.',
        },
        command: {
          type: 'string',
          description:
            'For type=command tasks: the bash command to run in the background. Required for command tasks; ' +
            'the session LLM is notified when it finishes if notifyLlm is true.',
        },
        notifyLlm: {
          type: 'boolean',
          description:
            'For type=command tasks: whether the session LLM is notified when the background job finishes (default true).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            tasks: { type: 'array', items: TASK_JSON_SCHEMA },
            task: TASK_JSON_SCHEMA,
            deleted: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args: TaskRunnerToolArgs) {
        // Approval is NOT the tool's concern: the `tools/pre-execute` gate
        // (registerTaskRunnerApprovalGate) decides allow/ask per the
        // session's sandbox mode, and the ToolRuntime resolves `ask`
        // through the standard approval seam.
        if (args.action === 'list') {
          const tasks = store.list()
          const query = args.query?.trim().toLowerCase()
          const filtered =
            query === undefined || query.length === 0
              ? tasks
              : tasks.filter((task) => task.name.toLowerCase().includes(query))
          return { ok: true, tasks: filtered }
        }
        switch (args.action) {
          case 'create': {
            const task = await store.create({
              name: args.name ?? '',
              type: args.type ?? 'llm',
              scope: args.scope ?? 'global',
              ...(args.description !== undefined ? { description: args.description } : {}),
              ...(args.workspacePath !== undefined ? { workspacePath: args.workspacePath } : {}),
              ...(args.llmPrompt !== undefined ? { llmPrompt: args.llmPrompt } : {}),
              ...(args.command !== undefined ? { command: args.command } : {}),
              ...(args.notifyLlm !== undefined ? { notifyLlm: args.notifyLlm } : {}),
            })
            return { ok: true, task }
          }
          case 'update': {
            if (args.id === undefined) throw new Error('update requires id')
            const patch: TaskPatch = {}
            if (args.name !== undefined) patch.name = args.name
            if (args.description !== undefined) patch.description = args.description
            if (args.type !== undefined) patch.type = args.type
            if (args.scope !== undefined) patch.scope = args.scope
            if (args.workspacePath !== undefined) patch.workspacePath = args.workspacePath
            if (args.llmPrompt !== undefined) patch.llmPrompt = args.llmPrompt
            if (args.command !== undefined) patch.command = args.command
            if (args.notifyLlm !== undefined) patch.notifyLlm = args.notifyLlm
            const task = await store.update(args.id, patch)
            return { ok: true, task }
          }
          case 'delete': {
            if (args.id === undefined) throw new Error('delete requires id')
            const deleted = await store.delete(args.id)
            return { ok: true, deleted }
          }
          case 'duplicate': {
            if (args.id === undefined) throw new Error('duplicate requires id')
            const task = await store.duplicate(args.id)
            return { ok: true, task }
          }
          default:
            throw new Error(`unknown action ${args.action}`)
        }
      },
    }),
  )
}

/**
 * Register the official-pattern approval gate for `task_runner_config`
 * write actions on `tools/pre-execute` (returns the exact disposer).
 *
 * The gate resolves the session's sandbox mode through the optional
 * `sandboxPolicy` service (`ctx.get` — never injected, matching the harness
 * convention). `danger-full-access` → allow without approval; anything else
 * → `ask`, which the ToolRuntime resolves through the standard approval
 * seam (UI prompt + audit). A missing sandboxPolicy service fails closed to
 * `ask`. Guards covering other tools fall through via `next()`.
 */
export function registerTaskRunnerApprovalGate(ctx: Context): () => void {
  return ctx.on('tools/pre-execute', async (exec, next) => {
    const policy = ctx.get('sandboxPolicy')
    const mode = policy?.resolve({ session: exec.agent?.session }).mode
    const arguments_ = exec.arguments as Record<string, unknown> | undefined
    const decision = decideTaskRunnerApproval(
      exec.name,
      arguments_?.action as string | undefined,
      arguments_ as unknown as TaskRunnerToolArgs,
      mode,
      getApprovalLocale(),
    )
    return decision ?? next()
  })
}
