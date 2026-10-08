/**
 * Integration test for the command-task runner: starts a real background job
 * (jobs-local registry) with the custom `task` kind, runs it on a stub shell,
 * and verifies the completion monitor keeps a live wait (so the settlement is
 * reported `awaited` and the official tool-jobs notice is suppressed) and
 * delivers the fixed-template notification to the owning agent (followup when
 * idle).
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent, Inbox } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { runCommandTask } from '../src/host/command.ts'
import type { TaskRecord } from '../src/host/tasks.ts'

/**
 * Minimal Inbox double. Since dsh 0.1.5 `Inbox` is an interface — its concrete
 * storage belongs to the agent driver — so a test agent supplies its own (still
 * an interface on 0.1.7, the peer line this repo targets). The
 * command runner never touches the inbox; it only notifies through the agent.
 */
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
 * A minimal live agent with spied notification sinks.
 * @param ctx - the plugin context (for the agent's scope fiber).
 * @param rawId - the session id this agent owns.
 * @param status - the lifecycle state the monitor reads to pick followup vs inject.
 */
function stubAgent(ctx: Context, rawId: string, status: 'idle' | 'running' = 'idle'): Agent {
  const id = SessionId(rawId)
  const scopeFiber = ctx.plugin(() => {})
  const session = Session.create(id)
  const followup = vi.fn()
  const inject = vi.fn()
  const agent = {
    id,
    options: {},
    session,
    inbox: stubInbox(),
    status,
    ctx: scopeFiber.ctx,
    send: () => {},
    followup,
    steer: () => ({
      outcome: Promise.resolve({ status: 'rejected' as const }),
    }),
    inject,
    cancel() {},
    runMaintenance: <T>(job: (signal: AbortSignal) => Promise<T>) =>
      job(new AbortController().signal),
    whenIdle() {
      return Promise.resolve()
    },
  }
  return agent as unknown as Agent
}

/** A stub shell that completes instantly with exit code 0. */
const shellRequests: ShellRequest[] = []
interface ShellRequest {
  command: string
  workdir?: string
  onExpiry?: string
  signal?: AbortSignal
  sandboxPolicy?: { mode: string; workspaceRoot: string }
}
/** Captured output returned by the stub's `readOutput` (per-run). */
let shellOutput = ''
let shellLossy = false
let shellSpillPath: string | undefined
/** Terminal facts of the started process (per-run); default is a clean exit. */
let shellStatus: 'completed' | 'killed' = 'completed'
let shellExitCode: number | null = 0
let shellSignal: NodeJS.Signals | null = null
/**
 * When true, `execute` stays pending until the passed signal aborts — the
 * shape of a slow spawn/preparation, where `cancel` must still be able to
 * stop the run before any process handle exists.
 */
let shellHoldUntilAbort = false
/** How many times the started process was killed (per-run). */
let shellKillCalls = 0
/**
 * When true, `execute` rejects instead of resolving. A confining executor
 * rejects when preparation is aborted (the argv step throws after the abort),
 * which is a different shape from a process that was spawned and killed.
 */
let shellRejectOnAbort = false

/** Reset every per-run knob so tests cannot leak state into each other. */
function resetShell(): void {
  shellRequests.length = 0
  shellOutput = ''
  shellLossy = false
  shellSpillPath = undefined
  shellStatus = 'completed'
  shellExitCode = 0
  shellSignal = null
  shellHoldUntilAbort = false
  shellKillCalls = 0
  shellRejectOnAbort = false
}

/** The live handle the stub's `execute` publishes once (or after) it starts. */
function startedProcess() {
  return {
    status: shellStatus,
    exitCode: shellExitCode,
    signal: shellSignal,
    done: Promise.resolve(),
    readOutput: () => ({
      delta: shellOutput,
      lossy: shellLossy,
      ...(shellSpillPath !== undefined ? { stdoutSpillPath: shellSpillPath } : {}),
    }),
    kill: () => {
      shellKillCalls += 1
      return true
    },
  }
}

const stubShell = {
  resolve: (request: ShellRequest) => {
    shellRequests.push(request)
    return {
      command: request.command,
      workdir: request.workdir ?? '',
      timeoutMs: 0,
      stdoutMaxBytes: 0,
      onExpiry: request.onExpiry ?? 'kill',
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
      sandboxPolicy: request.sandboxPolicy,
    }
  },
  // 0.1.7: `execute` replaced `start` and resolves with the live handle.
  execute: (spec: { signal?: AbortSignal } = {}) => {
    if (!shellHoldUntilAbort) return Promise.resolve(startedProcess())
    return new Promise((resolve, reject) => {
      const signal = spec.signal
      if (signal === undefined || signal.aborted) {
        if (shellRejectOnAbort) reject(new Error('preparation aborted'))
        else resolve(startedProcess())
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          if (shellRejectOnAbort) reject(new Error('preparation aborted'))
          else resolve(startedProcess())
        },
        { once: true },
      )
    })
  },
}

function commandTask(): TaskRecord {
  return {
    id: 'task-record-1',
    name: '发布检查',
    type: 'command',
    scope: 'workspace',
    workspacePath: 'D:\\work',
    command: 'echo ok',
    notifyLlm: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const tick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

describe('runCommandTask', () => {
  it('starts a `task`-kind job, keeps a live wait, and notifies the idle owner', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    // 0.1.7 registers agents through a composite effect: let it enter the store
    // before a job resolves its live owner.
    await tick()
    ctx.provide('shell', stubShell)
    // Deployment policy rooted elsewhere: the run must still confine the
    // command to the run cwd (the bug that made `echo ok > marker` fail with
    // exit 1 when the server's cwd was not the run directory).
    ctx.provide('sandboxPolicy', {
      resolve: () => ({
        mode: 'workspace-write' as const,
        workspaceRoot: 'D:\\deploy',
      }),
    })

    // 0.1.7 replaced the `reported` flag with `awaited`: a settlement that
    // released a live `jobs.wait` is the one tool-jobs skips, which is exactly
    // how our pending monitor suppresses the official notice.
    const settled: { awaited?: boolean; cause?: string } = {}
    ctx.jobs.events.subscribe({ owner: agent.id }, (event) => {
      if (event.type !== 'settled') return
      settled.awaited = event.awaited
      settled.cause = event.cause
    })

    resetShell()
    const id = runCommandTask(ctx, commandTask(), agent, 'D:\\work')
    expect(id).toBe('task-1')

    // The shell request carries the session mode rooted at the run cwd.
    expect(shellRequests[0]?.sandboxPolicy).toEqual({
      mode: 'workspace-write',
      workspaceRoot: 'D:\\work',
    })

    // Let the job settle and the monitor continuation run.
    await tick()
    await tick()

    const snapshot = ctx.jobs.get(id as JobId, agent.id)
    expect(snapshot.status).toBe('completed')
    // The pending wait released on settlement (tool-jobs notice suppressed).
    expect(settled.awaited).toBe(true)
    expect(settled.cause).toBe('producer')

    // Idle owner → followup with the fixed English template (official
    // tool-jobs shape: brief status + job_output pointer, no output body).
    expect(agent.followup).toHaveBeenCalledTimes(1)
    const message = (agent.followup as unknown as Mock).mock.calls[0]?.[0] as {
      content: { text: string }[]
    }
    expect(message.content[0]?.text).toBe(
      'User-started job task-1 (task: 发布检查) finished [status: completed, exit code: 0]. Read its output with job_output.',
    )
  })

  it('stays silent when notifyLlm is false', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    // 0.1.7 registers agents through a composite effect: let it enter the store
    // before a job resolves its live owner.
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()
    shellOutput = 'ignored output'

    const task = commandTask()
    task.notifyLlm = false
    runCommandTask(ctx, task, agent, 'D:\\work')

    await tick()
    await tick()

    expect(agent.followup).not.toHaveBeenCalled()
    expect(agent.inject).not.toHaveBeenCalled()
  })

  it('keeps the full captured output on the job for job_output', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    // 0.1.7 registers agents through a composite effect: let it enter the store
    // before a job resolves its live owner.
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()
    shellOutput = 'hello\nworld\n'

    runCommandTask(ctx, commandTask(), agent, 'D:\\work')

    await tick()
    await tick()

    // The notice stays brief; the FULL output lives on the job (no
    // outputLimitBytes) and is served verbatim by jobs.read / job_output.
    const message = (agent.followup as unknown as Mock).mock.calls[0]?.[0] as {
      content: { text: string }[]
    }
    expect(message.content[0]?.text).toBe(
      'User-started job task-1 (task: 发布检查) finished [status: completed, exit code: 0]. Read its output with job_output.',
    )
    const snapshot = ctx.jobs.get('task-1' as JobId, agent.id)
    expect(snapshot.outputLimitBytes).toBeUndefined()
    const read = ctx.jobs.read('task-1' as JobId, agent.id)
    // 0.1.7: a producer's outcome rides `JobRead.result` (the ring carries
    // streamed chunks; this job deliberately streams nothing).
    expect(read.result).toBe('hello\nworld\n')
  })

  it('injects the notice into a BUSY owner instead of waking it with followup', async () => {
    // The idle→followup branch is covered above; this pins the other half of
    // the monitor: a running owner gets an `inject` (the message queues for its
    // next step) and must NOT be woken with `followup`.
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-busy', 'running')
    ctx.agents.register(agent)
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()

    runCommandTask(ctx, commandTask(), agent, 'D:\\work')

    await tick()
    await tick()

    expect(agent.followup).not.toHaveBeenCalled()
    expect(agent.inject).toHaveBeenCalledTimes(1)
    const message = (agent.inject as unknown as Mock).mock.calls[0]?.[0] as {
      content: { text: string }[]
      source: { kind: string; form: string; summary: string }
    }
    // Same fixed English template as the idle branch: only the delivery differs.
    expect(message.content[0]?.text).toBe(
      'User-started job task-1 (task: 发布检查) finished [status: completed, exit code: 0]. Read its output with job_output.',
    )
    // Still the plugin's own notice source (never the tool-jobs shape).
    expect(message.source.kind).toBe('task-runner')
    expect(message.source.form).toBe('notice')
  })

  it('keeps the spill-file pointer on the job when the executor truncated', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    // 0.1.7 registers agents through a composite effect: let it enter the store
    // before a job resolves its live owner.
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()
    shellOutput = 'tail of the long output'
    shellLossy = true
    shellSpillPath = 'D:\\tmp\\task-stdout.spill'

    runCommandTask(ctx, commandTask(), agent, 'D:\\work')

    await tick()
    await tick()

    // The notice is unchanged; the spill pointer rides on the job output so
    // job_output readers can reach the full stream file.
    const message = (agent.followup as unknown as Mock).mock.calls[0]?.[0] as {
      content: { text: string }[]
    }
    expect(message.content[0]?.text).toBe(
      'User-started job task-1 (task: 发布检查) finished [status: completed, exit code: 0]. Read its output with job_output.',
    )
    const read = ctx.jobs.read('task-1' as JobId, agent.id)
    expect(read.result).toBe(
      'tail of the long output\n[Output truncated; read D:\\tmp\\task-stdout.spill for full output]',
    )
  })

  it("runs with onExpiry 'none' and a job-owned signal, so no deadline kills a background task", async () => {
    // A background job must never be bounded by the executor's own deadline:
    // `PwshLocalExecutor.resolve` defaults `onExpiry` to 'kill' and `timeoutMs`
    // to 120s, which silently killed any command task running longer than two
    // minutes (observed in the wild as `[status: killed]` with no detail). The
    // official background tools pass `onExpiry: 'none'` for the same reason.
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()

    runCommandTask(ctx, commandTask(), agent, 'D:\\work')
    await tick()
    await tick()

    expect(shellRequests[0]?.onExpiry).toBe('none')
    // The job owns an abort signal: that is the only way `cancel` can stop a
    // run whose process does not exist yet (a slow spawn/preparation).
    expect(shellRequests[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports how a killed command ended instead of dropping the cause', async () => {
    // `{ status: 'killed' }` with no detail made a deadline kill, a user
    // `job_kill`, and an owner teardown indistinguishable in the transcript.
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()
    shellStatus = 'killed'
    shellExitCode = null
    shellSignal = 'SIGTERM'

    runCommandTask(ctx, commandTask(), agent, 'D:\\work')
    await tick()
    await tick()

    const snapshot = ctx.jobs.get('task-1' as JobId, agent.id)
    expect(snapshot.status).toBe('killed')
    expect(snapshot.detail).toBe('signal: SIGTERM')
  })

  it('kills the run through the job signal while the process is still starting', async () => {
    // `cancel` used to be a no-op until `execute` resolved, so a kill request
    // that arrived during spawn/preparation did nothing at all.
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()
    shellHoldUntilAbort = true
    shellStatus = 'killed'
    shellExitCode = null

    const id = runCommandTask(ctx, commandTask(), agent, 'D:\\work')
    const signal = shellRequests[0]?.signal
    expect(signal?.aborted).toBe(false)

    ctx.jobs.kill(id, agent.id, 'user stopped it')

    // The run is stopped by the job's own signal, before any handle existed.
    expect(signal?.aborted).toBe(true)
    await tick()
    await tick()
    const snapshot = ctx.jobs.get(id, agent.id)
    expect(snapshot.status).toBe('killed')
    // jobs-local appends the kill reason itself; the detail must not echo it.
    expect(snapshot.detail).toBe('user stopped it')
    // Killed during preparation: the signal is the only stop path that exists
    // at that moment, and the handle that materialises afterwards is killed
    // too, so no process is left orphaned.
    expect(shellKillCalls).toBe(1)
  })

  it("reports a preparation abort as 'killed', not a failure", async () => {
    // A confining executor rejects the spawn promise when preparation is
    // aborted, so `execute` itself rejects. The official background tool maps
    // exactly this shape to `killed` (`processJob`: `controller.signal.aborted
    // && process === undefined ? 'killed' : 'failed'`); a user-requested stop
    // must not be reported as a crash.
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    await tick()
    ctx.provide('shell', stubShell)
    resetShell()
    shellHoldUntilAbort = true
    shellRejectOnAbort = true

    const id = runCommandTask(ctx, commandTask(), agent, 'D:\\work')
    ctx.jobs.kill(id, agent.id, 'user stopped it')

    await tick()
    await tick()
    const snapshot = ctx.jobs.get(id, agent.id)
    expect(snapshot.status).toBe('killed')
    expect(snapshot.detail).toBe('user stopped it')
  })
})
