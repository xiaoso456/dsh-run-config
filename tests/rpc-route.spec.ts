/**
 * D22: the browser RPC contract on dsh 0.1.5. The Host serves one exact POST
 * route per endpoint on the shared `/api` Connection channel (private channels
 * via `connection.rpc.handle` are gone: the service mounts them on the
 * registering context's `webServer`, which 0.1.5 no longer resolves). These
 * tests pin the route shape, the envelope decode, and the error mapping.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { registerTaskRunnerRpc } from '../src/host/rpc.ts'
import type { TaskStore } from '../src/host/tasks.ts'
import { TASK_RUNNER_ENDPOINTS, taskRunnerRoutePath } from '../src/shared/wire.ts'

/** One route as the plugin registers it on the Connection Fetch registry. */
interface RegisteredRoute {
  path: string
  methods: readonly string[]
  requestBody: string
  fetch(request: Request): Promise<Response>
}

/** The Connection Fetch registry face the plugin consumes. */
interface FakeConnection {
  fetch: { register(route: RegisteredRoute): () => void }
}

/** Minimal `connection` service capturing registered routes by path. */
function fakeConnection(routes: Map<string, RegisteredRoute>): FakeConnection {
  return {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return () => {
          routes.delete(route.path)
        }
      },
    },
  }
}

/** A store whose `list` is all these tests need. */
function stubStore(): TaskStore {
  return {
    list: () => [
      {
        id: 'task-1',
        name: '发布检查',
        type: 'command',
        scope: 'global',
        command: 'echo ok',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  } as unknown as TaskStore
}

/** Mount the plugin's routes the way `apply` does and return the captured registry. */
async function mount(): Promise<Map<string, RegisteredRoute>> {
  const routes = new Map<string, RegisteredRoute>()
  const ctx = new Context()
  ctx.provide('connection', fakeConnection(routes))
  await new Promise<void>((resolve) => {
    ctx.inject(['connection'], (connectionCtx) => {
      registerTaskRunnerRpc(connectionCtx, stubStore())
      resolve()
    })
  })
  return routes
}

/** Build one client-request envelope POST. */
function request(path: string, body: unknown | string): Request {
  return new Request(`http://127.0.0.1:3190${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('task-runner Fetch routes (dsh 0.1.5 wire)', () => {
  it('registers one buffered POST route per endpoint below /api', async () => {
    const routes = await mount()
    expect([...routes.keys()].sort()).toEqual(
      TASK_RUNNER_ENDPOINTS.map((endpoint) => taskRunnerRoutePath(endpoint)).sort(),
    )
    for (const route of routes.values()) {
      expect(route.path.startsWith('/api/task-runner/')).toBe(true)
      expect(route.methods).toEqual(['POST'])
      expect(route.requestBody).toBe('buffered')
    }
  })

  it('answers a valid envelope with the server-response shape', async () => {
    const routes = await mount()
    const route = routes.get(taskRunnerRoutePath('tasks/list'))
    if (route === undefined) throw new Error('tasks/list route missing')
    const response = await route.fetch(
      request('/api/task-runner/tasks/list', {
        type: 'client-request',
        rpcId: 'rpc-1',
        method: 'task-runner/tasks/list',
        payload: {},
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      type: string
      rpcId: string
      result: { ok: boolean; value?: { tasks: { id: string }[] } }
    }
    expect(body.type).toBe('server-response')
    expect(body.rpcId).toBe('rpc-1')
    expect(body.result.ok).toBe(true)
    expect(body.result.value?.tasks.map((task) => task.id)).toEqual(['task-1'])
  })

  it('reports a handler failure as an internal error envelope', async () => {
    const routes = await mount()
    const route = routes.get(taskRunnerRoutePath('tasks/delete'))
    if (route === undefined) throw new Error('tasks/delete route missing')
    const response = await route.fetch(
      request('/api/task-runner/tasks/delete', {
        type: 'client-request',
        rpcId: 'rpc-2',
        method: 'task-runner/tasks/delete',
        payload: {},
      }),
    )
    const body = (await response.json()) as {
      result: { ok: boolean; error?: { code: string; message: string } }
    }
    expect(body.result.ok).toBe(false)
    expect(body.result.error).toEqual({
      code: 'internal',
      message: 'delete requires id',
      details: {},
    })
  })

  it('rejects a mismatched method inside the envelope', async () => {
    const routes = await mount()
    const route = routes.get(taskRunnerRoutePath('tasks/list'))
    if (route === undefined) throw new Error('tasks/list route missing')
    const response = await route.fetch(
      request('/api/task-runner/tasks/list', {
        type: 'client-request',
        rpcId: 'rpc-3',
        method: 'task-runner/tasks/create',
        payload: {},
      }),
    )
    const body = (await response.json()) as {
      result: { ok: boolean; error?: { code: string } }
    }
    expect(body.result.ok).toBe(false)
    expect(body.result.error?.code).toBe('bad-request')
  })

  it('rejects a non-JSON body without pretending to be our client', async () => {
    const routes = await mount()
    const route = routes.get(taskRunnerRoutePath('tasks/list'))
    if (route === undefined) throw new Error('tasks/list route missing')
    const response = await route.fetch(request('/api/task-runner/tasks/list', 'not json'))
    expect(response.status).toBe(400)
  })
})
