/**
 * Unit tests for the pure task-model logic: input validation, canonical path
 * normalization, and persisted ordering.
 */
import { describe, expect, it } from 'vitest'
import {
  canonicalizeWorkspacePath,
  orderTasks,
  type TaskRecord,
  validateTaskInput,
} from '../src/host/tasks.ts'

function record(id: string, name: string): TaskRecord {
  return {
    id,
    name,
    type: 'llm',
    scope: 'global',
    llmPrompt: 'prompt',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('validateTaskInput', () => {
  it('rejects an empty name', async () => {
    await expect(
      validateTaskInput({ name: '  ', type: 'llm', scope: 'global', llmPrompt: 'p' }),
    ).rejects.toThrow('task name must not be empty')
  })

  // Draft-friendly: the dialog creates an empty llm/command draft (IDEA
  // style) and fills it later; run-time guards reject empty prompts/commands.
  it('allows an empty llmPrompt draft for llm tasks', async () => {
    const input = await validateTaskInput({ name: 't', type: 'llm', scope: 'global' })
    expect(input.llmPrompt).toBeUndefined()
  })

  it('allows an empty command draft for command tasks', async () => {
    const input = await validateTaskInput({ name: 't', type: 'command', scope: 'global' })
    expect(input.command).toBeUndefined()
  })

  it('requires workspacePath for workspace scope', async () => {
    await expect(
      validateTaskInput({ name: 't', type: 'llm', scope: 'workspace', llmPrompt: 'p' }),
    ).rejects.toThrow('workspace-scoped tasks require a workspacePath')
  })

  it('normalizes a valid llm task', async () => {
    const input = await validateTaskInput({
      name: ' 每日总结 ',
      type: 'llm',
      scope: 'global',
      llmPrompt: ' 总结 ',
    })
    expect(input.name).toBe('每日总结')
    expect(input.llmPrompt).toBe(' 总结 ')
  })

  it('defaults notifyLlm to undefined (host applies true at run time)', async () => {
    const input = await validateTaskInput({
      name: 't',
      type: 'command',
      scope: 'global',
      command: 'ls',
    })
    expect(input.notifyLlm).toBeUndefined()
  })
})

describe('canonicalizeWorkspacePath', () => {
  it('resolves a relative path to absolute when the path does not exist', async () => {
    const resolved = await canonicalizeWorkspacePath('some/relative/path')
    expect(resolved).toMatch(/some[\\/]relative[\\/]path$/)
  })
})

describe('orderTasks', () => {
  it('orders by the persisted order array', () => {
    const a = record('a', 'A')
    const b = record('b', 'B')
    const c = record('c', 'C')
    const ordered = orderTasks([a, b, c], ['c', 'a', 'b'])
    expect(ordered.map((task) => task.id)).toEqual(['c', 'a', 'b'])
  })

  it('appends unknown ids in insertion order', () => {
    const a = record('a', 'A')
    const b = record('b', 'B')
    const c = record('c', 'C')
    const ordered = orderTasks([a, b, c], ['c'])
    expect(ordered.map((task) => task.id)).toEqual(['c', 'a', 'b'])
  })

  it('tolerates order entries for missing tasks', () => {
    const a = record('a', 'A')
    const ordered = orderTasks([a], ['ghost', 'a'])
    expect(ordered.map((task) => task.id)).toEqual(['a'])
  })
})
