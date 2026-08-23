/**
 * Runtime verification against the EXACT tool pipeline the harness runs:
 * defineTool() compiles the output spec (valueSchemaSpecToJsonSchema) and
 * the registry validates every result with validateJsonSchemaValue against
 * the compiled schema (dsh-tools lib/index.js: createSuccessResult).
 *
 * Proves the fixed TASK_JSON_SCHEMA accepts list/create outputs carrying
 * `description`, and that the OLD schema (without `description`) reproduces
 * the reported bug: "value.tasks[1].description" is not a declared property
 * (additionalProperties: false).
 *
 * Not part of `pnpm test` (imports the harness's dsh-tools by absolute
 * path); run manually:
 *   node --experimental-strip-types tests/verify-tool-schema.mjs
 */
import { pathToFileURL } from 'node:url'
import { TASK_JSON_SCHEMA } from '../src/host/tool/tool.ts'

const dshToolsUrl = pathToFileURL(
  'D:/program/nvm/v22.23.2/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
).href
const { defineTool, validateJsonSchemaValue } = await import(dshToolsUrl)

/** Compile an output spec exactly like defineTool does at registration. */
function compileOutputSpec(schema) {
  const tool = defineTool({
    name: 'verify_task_runner_config',
    description: 'verification stub',
    parameters: { action: { type: 'string', required: true } },
    output: {
      schema,
      render: () => [{ type: 'text', text: '' }],
    },
    execute: async () => ({ ok: true }),
  })
  return tool.output.schema
}

const outputSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    tasks: { type: 'array', items: TASK_JSON_SCHEMA },
    task: TASK_JSON_SCHEMA,
    deleted: { type: 'boolean' },
    message: { type: 'string' },
  },
}

const taskWithDescription = {
  id: 't2',
  name: '输出hello',
  type: 'command',
  scope: 'workspace',
  workspacePath: 'D:\\code',
  command: 'echo hello',
  description: '输出hello',
  notifyLlm: true,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
}

const listOutput = {
  ok: true,
  tasks: [
    {
      id: 't1',
      name: '发布检查',
      type: 'command',
      scope: 'workspace',
      workspacePath: 'D:\\code',
      command: 'echo hi',
      notifyLlm: true,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    },
    taskWithDescription,
  ],
}
const createOutput = {
  ok: true,
  task: {
    id: 't3',
    name: '延迟问好',
    description: 'sleep 3 后说哈喽',
    type: 'command',
    scope: 'global',
    command: 'sleep 3 && echo 哈喽',
    notifyLlm: true,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  },
}

// Current (fixed) spec: compiled the same way the harness compiles it.
const compiled = compileOutputSpec(outputSpec)
const listViolations = validateJsonSchemaValue(compiled, listOutput, 'value')
const createViolations = validateJsonSchemaValue(compiled, createOutput, 'value')

// Reproduce the bug: the OLD spec without `description`.
const oldSpec = structuredClone(outputSpec)
delete oldSpec.properties.task.properties.description
delete oldSpec.properties.tasks.items.properties.description
const oldCompiled = compileOutputSpec(oldSpec)
const oldViolations = validateJsonSchemaValue(
  oldCompiled,
  { ok: true, tasks: [taskWithDescription] },
  'value',
)

console.log('compiled schema property keys:', Object.keys(compiled.properties).join(', '))
console.log('fixed schema · list output violations:', JSON.stringify(listViolations))
console.log('fixed schema · create output violations:', JSON.stringify(createViolations))
console.log('old schema · list output violations (bug repro):', JSON.stringify(oldViolations))
const ok = listViolations.length === 0 && createViolations.length === 0 && oldViolations.length > 0
console.log(ok ? 'FIX VERIFIED — old spec rejects, new spec accepts' : 'CHECK FAILED')
if (!ok) process.exit(1)
