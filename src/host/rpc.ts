/**
 * The task-runner browser RPC: one exact Fetch route per endpoint on the
 * Connection shared API channel (`/api/task-runner/<endpoint>`). The carrier
 * owning `/api` applies its Host/Origin + browser-session policy before the
 * handler runs, and every handler returns the standard
 * `{ type, rpcId, result }` response envelope built from the same
 * `clientRequestSchema` the carriers use.
 *
 * Private channel prefixes (`connection.rpc.handle`) are gone on purpose: the
 * service mounts them on the *registering* context's `webServer`, which dsh
 * 0.1.5 no longer resolves (the Connection plugin dropped `webServer` from its
 * own inject, so the shadow context it hands back fails the inject guard).
 * @module @xiaoso/dsh-run-config/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
// Value imports: the shared request envelope parser and the rpc-id brand are
// what the physical carriers use, so our routes decode exactly like a channel.
import { clientRequestSchema, RpcId } from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  TASK_RUNNER_ENDPOINTS,
  taskRunnerEndpointName,
  taskRunnerRoutePath,
} from '../shared/wire.ts'
import { runCommandTask } from './command.ts'
import { setApprovalLocale } from './locale.ts'
import type { TaskPatch, TaskStore } from './tasks.ts'

/** The channel result shape: `{ ok, value }` / `{ ok, error }`. */
type RpcResult<T> = ConnectionRpcResult<T>

/**
 * Register one POST route per endpoint on the caller's fiber.
 * @param ctx - plugin context bound to `connection` (see `ctx.inject`).
 * @param store - the open task store.
 */
export function registerTaskRunnerRpc(ctx: Context, store: TaskStore): void {
  for (const endpoint of TASK_RUNNER_ENDPOINTS) {
    ctx.effect(() => {
      const dispose = ctx.connection.fetch.register({
        path: taskRunnerRoutePath(endpoint),
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => serve(ctx, store, endpoint, request),
      })
      return () => {
        void dispose()
      }
    }, `task-runner: ${endpoint} Fetch route`)
  }
}

/**
 * Decode one client-request envelope, dispatch it, and answer in the standard
 * server-response shape. Malformed traffic (not our client) gets a plain HTTP
 * status; a well-formed envelope always gets an envelope back.
 * @param ctx - plugin context.
 * @param store - the open task store.
 * @param endpoint - the endpoint this route owns.
 * @param request - the carrier-authenticated Fetch request.
 * @returns the JSON response envelope.
 */
async function serve(
  ctx: Context,
  store: TaskStore,
  endpoint: string,
  request: Request,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('body is not JSON', { status: 400 })
  }
  const envelope = clientRequestSchema.safeParse(body)
  if (!envelope.success) return new Response('invalid client-request envelope', { status: 400 })
  const message = envelope.data
  // The wire method is the namespaced endpoint the caller used
  // (`task-runner/tasks/list`), which is exactly the route path below `/api`.
  const expected = taskRunnerEndpointName(endpoint)
  if (message.method !== expected) {
    return respond(
      message.rpcId,
      fail(
        'bad-request',
        `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(expected)}`,
      ),
    )
  }
  let result: RpcResult<unknown>
  try {
    result = await dispatch(ctx, store, endpoint, message.payload)
  } catch (error) {
    result = fail('internal', error instanceof Error ? error.message : String(error))
  }
  return respond(message.rpcId, result)
}

/** Serialize one result as the Connection server-response envelope. */
function respond(rpcId: string, result: RpcResult<unknown>): Response {
  return Response.json({ type: 'server-response', rpcId: RpcId(rpcId), result })
}

/** A success result. */
function ok(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}

/** A failure result. */
function fail(code: string, message: string): RpcResult<unknown> {
  return { ok: false, error: { code, message, details: {} } }
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
      return ok({
        task: await store.update(id, stripUndefined(input.patch) as TaskPatch),
      })
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
      // Session workspace first (matches the official bash tool's cwd and
      // sandbox root); the task's bound workspace is only the fallback for
      // sessions without a cwd (e.g. the new-session hero page).
      const cwd =
        agent.session.header.cwd ?? (task.scope === 'workspace' ? task.workspacePath : undefined)
      if (cwd === undefined) throw new Error('no working directory for the command task')
      const jobId = runCommandTask(ctx, task, agent, cwd)
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
