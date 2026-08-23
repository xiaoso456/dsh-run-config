/**
 * D20: official-pattern approval gate for `task_runner_config` write
 * actions. `decideTaskRunnerApproval` is the pure decision (unit-tested
 * exhaustively); `registerTaskRunnerApprovalGate` wires it into the
 * `tools/pre-execute` waterfall, which the ToolRuntime resolves through the
 * standard approval seam. Semantics (mirroring the official
 * permission-presets): `danger-full-access` sandbox mode → allow without
 * approval; any other / unknown mode → ask (fail closed to approval).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  decideTaskRunnerApproval,
  registerTaskRunnerApprovalGate,
} from '../src/host/tool/approval.ts'

/** Minimal `sandboxPolicy` service standing in for dsh-sandbox-policy. */
class FakeSandboxPolicy extends Service {
  static current: FakeSandboxPolicy | undefined

  mode = 'workspace-write'

  constructor(ctx: Context) {
    super(ctx, 'sandboxPolicy')
    FakeSandboxPolicy.current = this
  }

  resolve(): { mode: string } {
    return { mode: this.mode }
  }
}

describe('decideTaskRunnerApproval (pure)', () => {
  it('ignores other tools', () => {
    expect(
      decideTaskRunnerApproval('some_other_tool', 'create', {} as never, 'workspace-write'),
    ).toBeUndefined()
    expect(
      decideTaskRunnerApproval('some_other_tool', 'create', {} as never, undefined),
    ).toBeUndefined()
  })

  it('ignores the read-only list action', () => {
    expect(
      decideTaskRunnerApproval('task_runner_config', 'list', {} as never, 'workspace-write'),
    ).toBeUndefined()
    expect(
      decideTaskRunnerApproval('task_runner_config', 'list', {} as never, 'danger-full-access'),
    ).toBeUndefined()
  })

  it('asks for create under workspace-write with a descriptive reason', () => {
    const decision = decideTaskRunnerApproval(
      'task_runner_config',
      'create',
      {
        action: 'create',
        name: 'sleep后说哈喽',
        type: 'command',
        scope: 'global',
      },
      'workspace-write',
    )
    expect(decision).toEqual({
      kind: 'ask',
      reason: '[dsh-task-runner] Create task "sleep后说哈喽" (command task, global)',
    })
  })

  it('asks for update/delete/duplicate', () => {
    expect(
      decideTaskRunnerApproval(
        'task_runner_config',
        'update',
        { action: 'update', id: 't-1' },
        'workspace-write',
      ),
    ).toMatchObject({
      kind: 'ask',
      reason: '[dsh-task-runner] Update task "t-1"',
    })
    expect(
      decideTaskRunnerApproval(
        'task_runner_config',
        'delete',
        { action: 'delete', id: 't-1' },
        'workspace-write',
      ),
    ).toMatchObject({
      kind: 'ask',
      reason: '[dsh-task-runner] Delete task "t-1"',
    })
    expect(
      decideTaskRunnerApproval(
        'task_runner_config',
        'duplicate',
        { action: 'duplicate', id: 't-1' },
        'workspace-write',
      ),
    ).toMatchObject({
      kind: 'ask',
      reason: '[dsh-task-runner] Duplicate task "t-1"',
    })
  })

  it('asks under read-only mode', () => {
    expect(
      decideTaskRunnerApproval(
        'task_runner_config',
        'create',
        { action: 'create' } as never,
        'read-only',
      ),
    ).toMatchObject({
      kind: 'ask',
    })
  })

  it('renders the reason in zh when the locale is zh', () => {
    const decision = decideTaskRunnerApproval(
      'task_runner_config',
      'create',
      {
        action: 'create',
        name: 'sleep后说哈喽',
        type: 'command',
        scope: 'workspace',
      },
      'workspace-write',
      'zh',
    )
    expect(decision).toEqual({
      kind: 'ask',
      reason: '【dsh-task-runner】创建任务「sleep后说哈喽」（命令任务，工作区）',
    })
  })

  it('allows without approval under danger-full-access', () => {
    expect(
      decideTaskRunnerApproval(
        'task_runner_config',
        'create',
        { action: 'create' } as never,
        'danger-full-access',
      ),
    ).toEqual({
      kind: 'allow',
    })
    expect(
      decideTaskRunnerApproval(
        'task_runner_config',
        'delete',
        { action: 'delete', id: 'x' },
        'danger-full-access',
      ),
    ).toEqual({
      kind: 'allow',
    })
  })

  it('fails closed to ask when the sandbox mode is unknown (no policy service)', () => {
    expect(
      decideTaskRunnerApproval(
        'task_runner_config',
        'create',
        { action: 'create' } as never,
        undefined,
      ),
    ).toMatchObject({
      kind: 'ask',
    })
  })
})

describe('registerTaskRunnerApprovalGate (waterfall wiring)', () => {
  function makeExec(name: string, arguments_: Record<string, unknown>): never {
    return {
      name,
      agent: undefined,
      arguments: arguments_,
      rootCallId: 'root',
      token: 'token',
      callId: 'call',
      signal: new AbortController().signal,
    } as never
  }

  it('asks write actions through the pre-execute waterfall without a policy service', async () => {
    const ctx = new Context()
    registerTaskRunnerApprovalGate(ctx)
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      makeExec('task_runner_config', { action: 'create', name: 'x' }),
      async () => ({ kind: 'allow' as const }),
    )
    expect(decision).toMatchObject({ kind: 'ask' })
  })

  it('allows write actions under danger-full-access', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSandboxPolicy)
    if (FakeSandboxPolicy.current === undefined) throw new Error('policy did not mount')
    FakeSandboxPolicy.current.mode = 'danger-full-access'
    registerTaskRunnerApprovalGate(ctx)
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      makeExec('task_runner_config', { action: 'create', name: 'x' }),
      async () => ({ kind: 'allow' as const }),
    )
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('falls through for list and for other tools', async () => {
    const ctx = new Context()
    registerTaskRunnerApprovalGate(ctx)
    const listDecision = await ctx.waterfall(
      'tools/pre-execute',
      makeExec('task_runner_config', { action: 'list' }),
      async () => ({ kind: 'allow' as const }),
    )
    expect(listDecision).toEqual({ kind: 'allow' })
    const otherDecision = await ctx.waterfall(
      'tools/pre-execute',
      makeExec('some_other_tool', { action: 'create' }),
      async () => ({ kind: 'allow' as const }),
    )
    expect(otherDecision).toEqual({ kind: 'allow' })
  })
})
