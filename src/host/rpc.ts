/**
 * The `/task-runner` Connection RPC channel: the browser half calls these
 * endpoints for task CRUD and command runs. Endpoints are plain JSON; every
 * handler returns the `{ ok, value }` / `{ ok, error }` result shape the
 * channel contract requires.
 * @module @xiaoso/dsh-task-runner/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the `ctx.connection` Context merge (HostConnectionHandle).
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { runCommandTask } from './command.ts'
import { setApprovalLocale } from './locale.ts'
import type { TaskPatch, TaskStore } from './tasks.ts'

/** The logical channel serving this plugin's client side. */
export const TASK_RUNNER_CHANNEL = '/task-runner'

function ok(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}

function fail(message: string): RpcResult<unknown> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/**
 * Register the channel handlers on the caller's fiber.
 * @param ctx - plugin context (requires `connection`, `agents`).
 * @param store - the open task store.
 */
export function registerTaskRunnerRpc(ctx: Context, store: TaskStore): void {
  const dispose = ctx.connection.rpc.handle(
    TASK_RUNNER_CHANNEL,
    async (endpoint, payload) => {
      try {
        return await dispatch(ctx, store, endpoint, payload)
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    },
    { authority: 'loopback' },
  )
  ctx.effect(
    () => () => {
      void dispose()
    },
    'task-runner: rpc channel',
  )
}

async function dispatch(
  ctx: Context,
  store: TaskStore,
  endpoint: string,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'client/locale': {
      // The browser reports its active UI locale so the approval gate can
      // render its reason in the user's language.
      const input = requireObject(payload)
      const locale = input.locale
      if (typeof locale !== 'string') throw new Error('client/locale requires locale')
      setApprovalLocale(locale)
      return ok({})
    }
    case 'tasks/list':
      return ok({ tasks: store.list() })
    case 'tasks/create': {
      const input = requireObject(payload)
      requireString(input, 'name', 'create requires name')
      requireString(input, 'type', 'create requires type')
      requireString(input, 'scope', 'create requires scope')
      return ok({
        task: await store.create({
          name: input.name as string,
          type: input.type as 'llm' | 'command',
          scope: input.scope as 'global' | 'workspace',
          ...(input.workspacePath !== undefined
            ? { workspacePath: input.workspacePath as string }
            : {}),
          ...(input.llmPrompt !== undefined ? { llmPrompt: input.llmPrompt as string } : {}),
          ...(input.command !== undefined ? { command: input.command as string } : {}),
          ...(input.notifyLlm !== undefined ? { notifyLlm: input.notifyLlm as boolean } : {}),
        }),
      })
    }
    case 'tasks/update': {
      const input = requireObject(payload)
      const id = requireString(input, 'id', 'update requires id')
      return ok({ task: await store.update(id, stripUndefined(input.patch) as TaskPatch) })
    }
    case 'tasks/delete': {
      const input = requireObject(payload)
      const id = requireString(input, 'id', 'delete requires id')
      return ok({ deleted: await store.delete(id) })
    }
    case 'tasks/duplicate': {
      const input = requireObject(payload)
      const id = requireString(input, 'id', 'duplicate requires id')
      return ok({ task: await store.duplicate(id) })
    }
    case 'tasks/reorder': {
      const input = requireObject(payload)
      const ids = input.ids
      if (!Array.isArray(ids) || ids.some((candidate) => typeof candidate !== 'string')) {
        throw new Error('reorder requires an array of task ids')
      }
      await store.reorder(ids as string[])
      return ok({})
    }
    case 'tasks/run': {
      const input = requireObject(payload)
      const id = requireString(input, 'id', 'run requires a task id')
      const sessionId = requireString(input, 'sessionId', 'run requires sessionId')
      const task = store.get(id)
      if (task === undefined) throw new Error(`task ${id} not found`)
      if (task.type !== 'command') throw new Error(`task ${id} is not a command task`)
      const agent = ctx.agents.get(sessionId as SessionId)
      if (agent === undefined) throw new Error(`no live agent for session ${sessionId}`)
      const cwd =
        task.scope === 'workspace' && task.workspacePath !== undefined
          ? task.workspacePath
          : agent.session.header.cwd
      if (cwd === undefined) throw new Error('no working directory for the command task')
      const locale = typeof input.locale === 'string' ? input.locale : 'en'
      const jobId = runCommandTask(ctx, task, agent, cwd, locale)
      return ok({ jobId })
    }
    default:
      throw new Error(`unknown endpoint ${endpoint}`)
  }
}

/** Require a JSON object payload. */
function requireObject(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object')
  }
  return payload as Record<string, unknown>
}

/** Require a non-empty string field on a payload object. */
function requireString(input: Record<string, unknown>, field: string, message: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value.length === 0) throw new Error(message)
  return value
}

/** Drop `undefined` entries from a partial patch (JSON has no undefined). */
function stripUndefined(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined) out[key] = entry
  }
  return out
}
