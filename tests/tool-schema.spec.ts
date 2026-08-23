/**
 * Regression test for the tool output schema: the harness validates every
 * `task_runner_config` result against `TASK_JSON_SCHEMA` with
 * `additionalProperties: false`, so EVERY field of a TaskRecord must be
 * declared there. This guards the class of bug where a new record field
 * (e.g. `description`, D17) is added to the store/client but forgotten in
 * the tool schema — which made every list/create/update/duplicate call fail
 * at runtime with "is not a declared property (additionalProperties: false)".
 */
import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../src/host/tasks.ts'
import { TASK_JSON_SCHEMA } from '../src/host/tool.ts'

/** A maximal record: every optional field present (the worst case for output). */
function fullRecord(): TaskRecord {
  return {
    id: 'abc-123',
    name: '延迟问好',
    description: '等待 3 秒后说哈喽',
    type: 'command',
    scope: 'workspace',
    workspacePath: 'D:\\workspace',
    command: 'sleep 3 && echo hello',
    notifyLlm: true,
    llmPrompt: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('TASK_JSON_SCHEMA', () => {
  it('declares every field of a full TaskRecord (additionalProperties is false)', () => {
    const record = fullRecord()
    const declared = new Set(Object.keys(TASK_JSON_SCHEMA.properties))
    for (const key of Object.keys(record)) {
      expect(
        declared.has(key),
        `TaskRecord field "${key}" is missing from TASK_JSON_SCHEMA.properties — ` +
          'the harness rejects tool output containing it (additionalProperties: false)',
      ).toBe(true)
    }
  })

  it('declares every optional field too (description / workspacePath / llmPrompt / command / notifyLlm)', () => {
    for (const key of ['description', 'workspacePath', 'llmPrompt', 'command', 'notifyLlm']) {
      expect(TASK_JSON_SCHEMA.properties).toHaveProperty(key)
    }
  })

  it('keeps additionalProperties false so the declared set is the whole contract', () => {
    expect(TASK_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(TASK_JSON_SCHEMA.type).toBe('object')
  })

  it('declares the required identity fields', () => {
    const properties = TASK_JSON_SCHEMA.properties as Record<string, { required?: boolean }>
    for (const key of ['id', 'name', 'type', 'scope', 'createdAt', 'updatedAt']) {
      expect(properties[key]).toMatchObject({ required: true })
    }
  })
})
