/**
 * D25: the browser RPC contract on dsh 0.1.7. The Host serves one exact POST
 * route per endpoint on the shared `/api` Connection channel (private channels
 * via `connection.rpc.handle` are gone: the service mounts them on the
 * registering context's `webServer`, which neither 0.1.5 nor 0.1.7 resolves).
 * These tests pin the route shape, the envelope decode, and the error mapping.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent, Inbox } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import {
  SESSION_FORMAT_VERSION,
  Session,
  type SessionHeader,
  SessionId,
} from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { TASK_RUNNER_RPC_COVERAGE } from '../src/client/core/types.ts'
import { registerTaskRunnerRpc } from '../src/host/rpc.ts'
import type { TaskRecord, TaskStore } from '../src/host/tasks.ts'
import {
  TASK_RUNNER_ENDPOINTS,
  taskRunnerEndpointName,
  taskRunnerRoutePath,
} from '../src/shared/wire.ts'

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
async function mount(store: TaskStore = stubStore()): Promise<Map<string, RegisteredRoute>> {
  const routes = new Map<string, RegisteredRoute>()
  const ctx = new Context()
  ctx.provide('connection', fakeConnection(routes))
  await new Promise<void>((resolve) => {
    ctx.inject(['connection'], (connectionCtx) => {
      registerTaskRunnerRpc(connectionCtx, store)
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

describe('task-runner Fetch routes (dsh 0.1.7 wire)', () => {
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

  // `wire.ts` is documented as the single source for the endpoint list, but the
  // browser keeps a SECOND hand-written list (`TaskRunnerRpcMap`, the typed face
  // `createTaskRunnerRpc` is built from). The compile-time constraint lives in
  // `core/types.ts` (`TASK_RUNNER_RPC_COVERAGE`); this asserts that the coverage
  // map it exports really covers every wire endpoint at runtime too.
  it('keeps the browser RPC map in step with the wire endpoint list', () => {
    const covered: string[] = Object.keys(TASK_RUNNER_RPC_COVERAGE)
    const wire: string[] = [...TASK_RUNNER_ENDPOINTS]
    expect(covered.sort()).toEqual(wire.sort())
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

  it('forwards every optional task field on create (autoSend, description, notifyLlm)', async () => {
    // `tasks/create` lists its fields by hand, so a forgotten one is dropped
    // silently: `autoSend` and `description` were, which made a newly created
    // LLM task always send immediately and lose its description.
    let captured: Record<string, unknown> | undefined
    const store = {
      ...stubStore(),
      create: async (input: Record<string, unknown>) => {
        captured = input
        return {
          id: 'task-new',
          name: input.name,
          type: input.type,
          scope: input.scope,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }
      },
    } as unknown as TaskStore
    const routes = await mount(store)
    const route = routes.get(taskRunnerRoutePath('tasks/create'))
    if (route === undefined) throw new Error('tasks/create route missing')
    const response = await route.fetch(
      request('/api/task-runner/tasks/create', {
        type: 'client-request',
        rpcId: 'rpc-4',
        method: 'task-runner/tasks/create',
        payload: {
          name: '发布前审查',
          description: '检查变更',
          type: 'llm',
          scope: 'global',
          llmPrompt: 'review',
          autoSend: false,
          notifyLlm: false,
        },
      }),
    )
    expect(response.status).toBe(200)
    // `false` must survive: the handler tests `!== undefined`, not truthiness.
    expect(captured).toMatchObject({
      name: '发布前审查',
      description: '检查变更',
      llmPrompt: 'review',
      autoSend: false,
      notifyLlm: false,
    })
  })
})

/**
 * Round-1 review P1, browser path: `tasks/create` and `tasks/update` used to
 * hand `type`/`scope` to the store behind a TypeScript `as` assertion (compile
 * time only). An out-of-set value reaching the medium makes every later domain
 * `open` fail with `invalid-record` — and `openTaskStore` is the first
 * statement of `apply`, so the plugin never activates again. These tests pin the
 * runtime whitelist on the routes.
 */
describe('task type/scope runtime whitelist on the RPC routes', () => {
  /** A store recording every create/update call the handler forwards. */
  function recordingStore(): {
    store: TaskStore
    created: Record<string, unknown>[]
    updated: Array<{ id: string; patch: unknown }>
  } {
    const created: Record<string, unknown>[] = []
    const updated: Array<{ id: string; patch: unknown }> = []
    const store = {
      ...stubStore(),
      create: async (input: Record<string, unknown>) => {
        created.push(input)
        return {
          id: 'task-new',
          name: input.name,
          type: input.type,
          scope: input.scope,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }
      },
      update: async (id: string, patch: unknown) => {
        updated.push({ id, patch })
        return stubStore().list()[0]
      },
    } as unknown as TaskStore
    return { store, created, updated }
  }

  /** POST one envelope to `endpoint` and decode the result. */
  async function call(
    routes: Map<string, RegisteredRoute>,
    endpoint: string,
    payload: unknown,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
    const route = routes.get(taskRunnerRoutePath(endpoint))
    if (route === undefined) throw new Error(`${endpoint} route missing`)
    const response = await route.fetch(
      request(taskRunnerRoutePath(endpoint), {
        type: 'client-request',
        rpcId: 'rpc-p1',
        method: taskRunnerEndpointName(endpoint),
        payload,
      }),
    )
    const body = (await response.json()) as {
      result: { ok: boolean; error?: { code: string; message: string } }
    }
    return body.result
  }

  it('refuses a create whose type is not in the closed set, without touching the store', async () => {
    const { store, created } = recordingStore()
    const routes = await mount(store)
    const result = await call(routes, 'tasks/create', {
      name: 'bad',
      type: 'shell',
      scope: 'global',
      command: 'echo hi',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toEqual({
      code: 'internal',
      message: 'create type must be one of llm, command',
      details: {},
    })
    expect(created).toEqual([])
  })

  it('refuses a create whose scope is not in the closed set', async () => {
    const { store, created } = recordingStore()
    const routes = await mount(store)
    const result = await call(routes, 'tasks/create', {
      name: 'bad',
      type: 'llm',
      scope: 'everywhere',
      llmPrompt: 'p',
    })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('create scope must be one of global, workspace')
    expect(created).toEqual([])
  })

  it('refuses an update patch whose type/scope is not in the closed set', async () => {
    const { store, updated } = recordingStore()
    const routes = await mount(store)
    const badType = await call(routes, 'tasks/update', { id: 'task-1', patch: { type: 5 } })
    expect(badType.ok).toBe(false)
    expect(badType.error?.message).toBe('update patch type must be one of llm, command')
    const badScope = await call(routes, 'tasks/update', { id: 'task-1', patch: { scope: null } })
    expect(badScope.ok).toBe(false)
    expect(badScope.error?.message).toBe('update patch scope must be one of global, workspace')
    expect(updated).toEqual([])
  })

  it('still forwards a legal update patch (shape fields included)', async () => {
    const { store, updated } = recordingStore()
    const routes = await mount(store)
    const result = await call(routes, 'tasks/update', {
      id: 'task-1',
      patch: { type: 'command', scope: 'global', command: 'echo hi' },
    })
    expect(result.ok).toBe(true)
    expect(updated).toEqual([
      { id: 'task-1', patch: { type: 'command', scope: 'global', command: 'echo hi' } },
    ])
  })
})

/**
 * `tasks/run` cwd priority — the semantic body of the first-round drift #4/#5:
 * a command task runs in the OWNING SESSION's cwd and only falls back to the
 * task's bound workspace when that session has no cwd at all. Both documents
 * (host/command.ts module header, the dialog's `fieldCommandHint`) and the
 * implementation promise this, so it is pinned here on the real route.
 */

/** Let a queued microtask/effect enter the registries before the route reads them. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

interface ShellRequest {
  command: string
  workdir?: string
  sandboxPolicy?: { mode: string; workspaceRoot: string }
}

/** A stub shell that records every resolved request and completes instantly. */
const shellRequests: ShellRequest[] = []
const stubShell = {
  resolve: (request: ShellRequest) => {
    shellRequests.push(request)
    return {
      command: request.command,
      workdir: request.workdir ?? '',
      timeoutMs: 0,
      stdoutMaxBytes: 0,
      sandboxPolicy: request.sandboxPolicy,
    }
  },
  execute: () =>
    Promise.resolve({
      status: 'completed' as const,
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      kill: () => true,
    }),
}

/** Minimal Inbox double (the command runner never touches it). */
function stubInbox(): Inbox {
  return {
    nextTurn: [],
    nextStep: [],
    clear: () => {},
    append: () => {},
    prepend: () => {},
    replace: () => false,
    remove: () => false,
    splice: () => [],
  }
}

/**
 * The full creation header `Session.create` validates. `cwd` is optional and
 * must be absolute when present, exactly like a stored session header.
 * @param id - the session id the header must echo.
 * @param cwd - the session's working directory, when it has one.
 * @returns the header record.
 */
function sessionHeader(id: SessionId, cwd: string | undefined): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    isSeeded: false,
    ...(cwd === undefined ? {} : { cwd }),
  }
}

/** A live agent whose session header carries `cwd` when one is supplied. */
function stubAgent(ctx: Context, rawId: string, cwd: string | undefined): Agent {
  const id = SessionId(rawId)
  const scopeFiber = ctx.plugin(() => {})
  const session = Session.create(id, undefined, sessionHeader(id, cwd))
  return {
    id,
    options: {},
    session,
    inbox: stubInbox(),
    status: 'idle' as const,
    ctx: scopeFiber.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: <T>(job: (signal: AbortSignal) => Promise<T>) =>
      job(new AbortController().signal),
    whenIdle() {
      return Promise.resolve()
    },
  } as unknown as Agent
}

/** A command task with a bound workspace and an explicit scope. */
function commandTaskRecord(scope: TaskRecord['scope'], workspacePath?: string): TaskRecord {
  return {
    id: 'task-run-1',
    name: '发布检查',
    type: 'command',
    scope,
    ...(workspacePath === undefined ? {} : { workspacePath }),
    command: 'echo ok',
    notifyLlm: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/**
 * Mount the real routes with a live agent, a real jobs registry and a stub
 * shell, so `tasks/run` performs its own cwd resolution.
 * @param task - the command task the store serves.
 * @param sessionCwd - the owning session's cwd (`undefined` = no cwd at all).
 * @returns the captured routes and the record of `tasks/run` responses.
 */
async function mountRunner(
  task: TaskRecord,
  sessionCwd: string | undefined,
): Promise<Map<string, RegisteredRoute>> {
  const routes = new Map<string, RegisteredRoute>()
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry)
  ctx.jobs.attachController('test-controller')
  const agent = stubAgent(ctx, 'session-run', sessionCwd)
  ctx.agents.register(agent)
  await settle()
  ctx.provide('shell', stubShell)
  const store = {
    list: () => [task],
    get: (id: string) => (id === task.id ? task : undefined),
  } as unknown as TaskStore
  ctx.provide('connection', fakeConnection(routes))
  // `apply` declares `inject = [... 'connection', 'agents' ...]` and registers
  // the routes in that shadow context, so its handlers may read `ctx.agents`.
  await new Promise<void>((resolve) => {
    ctx.inject(['connection', 'agents'], (connectionCtx) => {
      registerTaskRunnerRpc(connectionCtx, store)
      resolve()
    })
  })
  return routes
}

/** POST one `tasks/run` call and decode the server-response envelope. */
async function callRun(
  routes: Map<string, RegisteredRoute>,
): Promise<{ ok: boolean; value?: { jobId?: string }; error?: { code: string; message: string } }> {
  const route = routes.get(taskRunnerRoutePath('tasks/run'))
  if (route === undefined) throw new Error('tasks/run route missing')
  const response = await route.fetch(
    request('/api/task-runner/tasks/run', {
      type: 'client-request',
      rpcId: 'rpc-run',
      method: 'task-runner/tasks/run',
      payload: { id: 'task-run-1', sessionId: 'session-run' },
    }),
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    result: { ok: boolean; value?: { jobId?: string }; error?: { code: string; message: string } }
  }
  return body.result
}

describe('tasks/run cwd priority (session cwd first, task workspace as fallback)', () => {
  it('runs in the SESSION cwd when the session has one, ignoring the task workspace', async () => {
    shellRequests.length = 0
    const routes = await mountRunner(
      commandTaskRecord('workspace', 'D:\\work\\task-workspace'),
      'D:\\work\\session-cwd',
    )
    const result = await callRun(routes)
    expect(result.ok).toBe(true)
    expect(result.value?.jobId).toBe('task-1')
    await settle()
    // The command ran in the session's cwd, NOT in the task's bound workspace.
    expect(shellRequests[0]?.workdir).toBe('D:\\work\\session-cwd')
    expect(shellRequests).toHaveLength(1)
  })

  it('falls back to the task workspace when the session has NO cwd (hero / new session)', async () => {
    shellRequests.length = 0
    const routes = await mountRunner(
      commandTaskRecord('workspace', 'D:\\work\\task-workspace'),
      undefined,
    )
    const result = await callRun(routes)
    expect(result.ok).toBe(true)
    await settle()
    expect(shellRequests[0]?.workdir).toBe('D:\\work\\task-workspace')
  })

  it('refuses the run when neither the session nor a workspace-scoped task supplies a cwd', async () => {
    shellRequests.length = 0
    const routes = await mountRunner(commandTaskRecord('global'), undefined)
    const result = await callRun(routes)
    // Documented behaviour: no silent fallback to the server's deployment cwd.
    expect(result.ok).toBe(false)
    expect(result.error).toEqual({
      code: 'internal',
      message: 'no working directory for the command task',
      details: {},
    })
    await settle()
    expect(shellRequests).toHaveLength(0)
  })

  it('does not resurrect a stale workspacePath on a global task as a fallback', async () => {
    shellRequests.length = 0
    const routes = await mountRunner(commandTaskRecord('global', 'D:\\work\\stale'), undefined)
    const result = await callRun(routes)
    // The fallback is gated on `scope === 'workspace'`: a global task's
    // leftover path is not a working directory.
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('no working directory for the command task')
    await settle()
    expect(shellRequests).toHaveLength(0)
  })
})
