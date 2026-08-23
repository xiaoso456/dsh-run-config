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
import type { TaskCreateInput, TaskRecord, TaskStore, TaskView } from '../src/host/tasks.ts'
import { registerTaskRunnerTool } from '../src/host/tool.ts'

/** In-memory TaskStore with an observable record list. */
function fakeStore(): { store: TaskStore; records: TaskRecord[] } {
  const records: TaskRecord[] = []
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
    update: async (): Promise<TaskView> => {
      throw new Error('unexpected update')
    },
    delete: async () => {
      throw new Error('unexpected delete')
    },
    duplicate: async (): Promise<TaskView> => {
      throw new Error('unexpected duplicate')
    },
    reorder: async () => {},
  } as unknown as TaskStore
  return { store, records }
}

type ToolLike = {
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

async function mountTool(): Promise<{ tool: ToolLike; records: TaskRecord[] }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const { store, records } = fakeStore()
  registerTaskRunnerTool(ctx, store)
  const tool = ctx.tools.get('task_runner_config') as unknown as ToolLike
  return { tool, records }
}

describe('task_runner_config execute body', () => {
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

  it('rejects unknown actions', async () => {
    const { tool } = await mountTool()
    await expect(tool.execute({ action: 'nope' as never })).rejects.toThrow(/unknown action/)
  })
})
