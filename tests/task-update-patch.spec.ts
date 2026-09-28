/**
 * `TaskStore` 的补丁语义（用最小 fake 存储域驱动真实实现）。
 *
 * 契约：Host 把补丁里的 `undefined` 读作「不改这一项」（`tasks.ts` 的合并表达式），
 * 所以客户端**必须原样转发**用户清空的字段值 `''`；两边任一侧把它折成
 * `undefined`，「清空描述」就永远无效（上游对抗性审查 #2）。
 *
 * 本文件直接驱动 `TaskStore.update` 的真实合并 + 校验逻辑，因此它同时钉住
 * 两件事：`''` 能清空字段、漏传字段保持原值。
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../src/host/tasks.ts'
import { TaskStore } from '../src/host/tasks.ts'

/** The storage-domain surface `TaskStore` actually touches (table + global). */
function fakeDomain(): Domain<never> {
  const rows = new Map<string, TaskRecord>()
  const order: string[] = []
  const domain = {
    table: () => ({
      get: (id: string) => rows.get(id),
      put: async (id: string, record: TaskRecord) => {
        rows.set(id, record)
      },
      delete: async (id: string) => rows.delete(id),
      entries: () => rows.entries(),
    }),
    global: {
      get: () => ({ taskOrder: order }),
      set: (value: { taskOrder: string[] }) => {
        order.splice(0, order.length, ...value.taskOrder)
      },
    },
  }
  return domain as unknown as Domain<never>
}

async function storeWith(input: { description?: string; llmPrompt?: string }): Promise<TaskStore> {
  const store = new TaskStore(fakeDomain())
  await store.create({
    name: 't',
    type: 'llm',
    scope: 'global',
    llmPrompt: 'prompt',
    ...input,
  })
  return store
}

function firstId(store: TaskStore): string {
  const id = store.list()[0]?.id
  if (id === undefined) throw new Error('no task was created')
  return id
}

describe('TaskStore.update patch semantics', () => {
  it('drops workspacePath when the scope switches to global', async () => {
    const store = new TaskStore(fakeDomain())
    const created = await store.create({
      name: 't',
      type: 'llm',
      scope: 'workspace',
      workspacePath: process.cwd(),
      llmPrompt: 'prompt',
    })
    expect(created.workspacePath).toBeDefined()
    const updated = await store.update(created.id, { scope: 'global' })
    expect(updated.workspacePath).toBeUndefined()
  })

  it('drops the llm-only fields when the type switches to command', async () => {
    const store = new TaskStore(fakeDomain())
    const created = await store.create({
      name: 't',
      type: 'llm',
      scope: 'global',
      llmPrompt: 'prompt',
      autoSend: false,
    })
    const updated = await store.update(created.id, { type: 'command', command: 'echo hi' })
    expect(updated.llmPrompt).toBeUndefined()
    expect(updated.autoSend).toBeUndefined()
  })

  it('drops the command-only fields when the type switches to llm', async () => {
    const store = new TaskStore(fakeDomain())
    const created = await store.create({
      name: 't',
      type: 'command',
      scope: 'global',
      command: 'echo hi',
      notifyLlm: true,
    })
    const updated = await store.update(created.id, { type: 'llm', llmPrompt: 'prompt' })
    expect(updated.command).toBeUndefined()
    expect(updated.notifyLlm).toBeUndefined()
  })

  it('clears description when the patch carries an empty string', async () => {
    const store = await storeWith({ description: 'old description' })
    const id = firstId(store)
    const updated = await store.update(id, { description: '' })
    expect(updated.description).toBe('')
  })

  it('keeps description when the patch omits the field', async () => {
    const store = await storeWith({ description: 'keep me' })
    const id = firstId(store)
    const updated = await store.update(id, { llmPrompt: 'changed' })
    expect(updated.description).toBe('keep me')
  })
})
