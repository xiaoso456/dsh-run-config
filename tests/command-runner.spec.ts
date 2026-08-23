/**
 * Integration test for the command-task runner: starts a real background job
 * (jobs-local registry) with the custom `task` kind, runs it on a stub shell,
 * and verifies the completion monitor marks the job reported and delivers the
 * fixed-template notification to the owning agent (followup when idle).
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { runCommandTask } from '../src/host/command.ts'
import type { TaskRecord } from '../src/host/tasks.ts'

/** A minimal live agent with spied notification sinks. */
function stubAgent(ctx: Context, rawId: string): Agent {
  const id = SessionId(rawId)
  const scopeFiber = ctx.plugin(() => {})
  const session = Session.create(id)
  const followup = vi.fn()
  const inject = vi.fn()
  const agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, {
      inserted: () => {},
      discarded: () => {},
      claimed: () => {},
    }),
    status: 'idle' as const,
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
  sandboxPolicy?: { mode: string; workspaceRoot: string }
}
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
  start: () => ({
    status: 'completed' as const,
    exitCode: 0,
    signal: null,
    done: Promise.resolve(),
    readOutput: () => ({ delta: '', lossy: false }),
    kill: () => true,
  }),
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
  it('starts a `task`-kind job, marks it reported, and notifies the idle owner', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    ctx.provide('shell', stubShell)
    // Deployment policy rooted elsewhere: the run must still confine the
    // command to the TASK's workspace (the bug that made `echo ok > marker`
    // fail with exit 1 when the server's cwd was not the task workspace).
    ctx.provide('sandboxPolicy', {
      resolve: () => ({
        mode: 'workspace-write' as const,
        workspaceRoot: 'D:\\deploy',
      }),
    })

    shellRequests.length = 0
    const id = runCommandTask(ctx, commandTask(), agent, 'D:\\work', 'zh')
    expect(id).toBe('task-1')

    // The shell request carries the session mode with the TASK workspace root.
    expect(shellRequests[0]?.sandboxPolicy).toEqual({
      mode: 'workspace-write',
      workspaceRoot: 'D:\\work',
    })

    // Let the job settle and the monitor continuation run.
    await tick()
    await tick()

    const snapshot = ctx.jobs.get(id as JobId, agent)
    expect(snapshot.status).toBe('completed')
    // The pending wait marked the job reported (tool-jobs notice suppressed).
    expect(snapshot.reported).toBe(true)

    // Idle owner → followup with the zh fixed template.
    expect(agent.followup).toHaveBeenCalledTimes(1)
    const message = (agent.followup as unknown as Mock).mock.calls[0]?.[0] as {
      content: { text: string }[]
    }
    expect(message.content[0]?.text).toBe(
      '后台任务 task-1「发布检查」已完成（用户手动启动）[status: completed]',
    )
  })

  it('stays silent when notifyLlm is false', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('test-controller')
    const agent = stubAgent(ctx, 'session-test')
    ctx.agents.register(agent)
    ctx.provide('shell', stubShell)

    const task = commandTask()
    task.notifyLlm = false
    runCommandTask(ctx, task, agent, 'D:\\work', 'en')

    await tick()
    await tick()

    expect(agent.followup).not.toHaveBeenCalled()
    expect(agent.inject).not.toHaveBeenCalled()
  })
})
