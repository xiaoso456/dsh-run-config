/**
 * Tool-body tests after the D20 refactor: approval is NO LONGER the tool's
 * concern — the `tools/pre-execute` gate (tests/approval-gate.spec.ts)
 * decides allow/ask from the session sandbox mode, and the ToolRuntime
 * resolves `ask` through the standard approval seam. The execute body here
 * must therefore be pure: list runs freely, write actions execute directly.
 */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import type {
  TaskCreateInput,
  TaskPatch,
  TaskRecord,
  TaskStore,
  TaskView,
} from '../src/host/tasks.ts'
import { registerTaskRunnerTool } from '../src/host/tool/tool.ts'

/** In-memory TaskStore with an observable record list and recorded update patches. */
function fakeStore(): {
  store: TaskStore
  records: TaskRecord[]
  patches: Array<{ id: string; patch: unknown }>
} {
  const records: TaskRecord[] = []
  const patches: Array<{ id: string; patch: unknown }> = []
  const store = {
    list: () => [...records],
    get: () => undefined,
    create: async (input: TaskCreateInput): Promise<TaskView> => {
      const record: TaskRecord = {
        id: `t-${records.length}`,
        ...input,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      records.push(record)
      return record
    },
    update: async (id: string, patch: TaskPatch): Promise<TaskView> => {
      patches.push({ id, patch })
      return {
        id,
        name: patch.name ?? 'probe',
        type: patch.type ?? 'command',
        scope: patch.scope ?? 'global',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }
    },
    delete: async () => {
      throw new Error('unexpected delete')
    },
    duplicate: async (): Promise<TaskView> => {
      throw new Error('unexpected duplicate')
    },
    reorder: async () => {},
  } as unknown as TaskStore
  return { store, records, patches }
}

type ToolLike = {
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<unknown>
}

/**
 * Minimal caller stand-in for the registry execution context. The tool body
 * reads exactly one thing off it: the calling session's workspace directory
 * (`exec.agent.session.header.cwd`).
 * @param cwd - the calling session's working directory, when it has one.
 */
function callerExec(cwd?: string): unknown {
  return cwd === undefined ? {} : { agent: { session: { header: { cwd } } } }
}

async function mountTool(): Promise<{
  tool: ToolLike
  records: TaskRecord[]
  patches: Array<{ id: string; patch: unknown }>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const { store, records, patches } = fakeStore()
  registerTaskRunnerTool(ctx, store)
  const tool = ctx.tools.get('task_run_config') as unknown as ToolLike
  return { tool, records, patches }
}

describe('task_run_config execute body', () => {
  it('list runs freely and returns the store tasks', async () => {
    const { tool } = await mountTool()
    const result = await tool.execute({ action: 'list' })
    expect(result).toMatchObject({ ok: true, tasks: [] })
  })

  it('create executes directly — approval lives in the pre-execute gate', async () => {
    const { tool, records } = await mountTool()
    const result = await tool.execute({
      action: 'create',
      type: 'command',
      scope: 'global',
      name: 'sleep后说哈喽',
      command: 'sleep 3 && echo 哈喽',
      description: '等待3秒后输出"哈喽"（测试任务）',
      notifyLlm: true,
    })
    expect(result).toMatchObject({ ok: true })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      name: 'sleep后说哈喽',
      command: 'sleep 3 && echo 哈喽',
      description: '等待3秒后输出"哈喽"（测试任务）',
      notifyLlm: true,
      type: 'command',
      scope: 'global',
    })
  })

  it('create without an explicit scope defaults to the calling session workspace', async () => {
    const { tool, records } = await mountTool()
    const result = await tool.execute(
      {
        action: 'create',
        type: 'llm',
        name: 'code review',
        llmPrompt: 'Review the recent changes in this workspace',
      },
      callerExec('D:\\work\\alpha'),
    )
    expect(result).toMatchObject({ ok: true })
    expect(records).toHaveLength(1)
    // The model-visible contract (tool description + scope parameter + the
    // run-configuration skill's Defaults) promises workspace scope with the
    // current session's workspace path — NOT the cross-workspace 'global'.
    expect(records[0]).toMatchObject({
      scope: 'workspace',
      workspacePath: 'D:\\work\\alpha',
    })
  })

  it('create with scope=workspace also infers the session workspace path', async () => {
    const { tool, records } = await mountTool()
    await tool.execute(
      { action: 'create', type: 'command', scope: 'workspace', name: 'hello', command: 'echo hi' },
      callerExec('D:\\work\\beta'),
    )
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ scope: 'workspace', workspacePath: 'D:\\work\\beta' })
  })

  it('create fails closed without a session workspace instead of silently going global', async () => {
    const { tool, records } = await mountTool()
    await expect(
      tool.execute({ action: 'create', type: 'llm', name: 'orphan', llmPrompt: 'p' }, callerExec()),
    ).rejects.toThrow(/needs a workspace directory/)
    // The conservative behaviour is a refusal: nothing was stored, and in
    // particular no 'global' configuration leaked into every workspace.
    expect(records).toHaveLength(0)
  })

  it('update forwards every editable field to the store — including autoSend', async () => {
    const { tool, patches } = await mountTool()
    const result = await tool.execute({
      action: 'update',
      id: 't-7',
      name: 'renamed',
      description: 'd',
      autoSend: false,
      notifyLlm: false,
      command: 'echo hi',
    })
    expect(result).toMatchObject({ ok: true })
    // The model-facing contract (CHANGELOG: the update action covers autoSend)
    // is the tool's own field mapping — the merge semantics live in TaskStore.
    expect(patches).toEqual([
      {
        id: 't-7',
        patch: {
          name: 'renamed',
          description: 'd',
          autoSend: false,
          notifyLlm: false,
          command: 'echo hi',
        },
      },
    ])
  })

  it('update without an id fails before touching the store', async () => {
    const { tool, patches } = await mountTool()
    await expect(tool.execute({ action: 'update', name: 'x' })).rejects.toThrow(/requires id/)
    expect(patches).toEqual([])
  })

  it('rejects unknown actions', async () => {
    const { tool } = await mountTool()
    await expect(tool.execute({ action: 'nope' as never })).rejects.toThrow(/unknown action/)
  })
})
