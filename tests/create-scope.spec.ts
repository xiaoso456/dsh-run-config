/**
 * The run-config dialog's "New" button: its scope semantics (`scope` +
 * `workspacePath`) are derived by the pure `nextCreateInput`, so they can be
 * pinned without a DOM. This is the regression net for the first-round
 * naming-trap #3 — the button used to hardcode `scope: 'global'`, which
 * contradicted both the `task_run_config` tool's documented default and the
 * dialog's own "global / current workspace / other workspaces" grouping.
 *
 * The final test asserts the dialog still delegates to the derivation: the unit
 * tests above only have teeth while that wiring exists (there is no client
 * component test facility in this repo, and dependencies are frozen).
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nextCreateInput } from '../src/client/core/createInput.ts'

describe('nextCreateInput (the dialog "New" button)', () => {
  it('creates a WORKSPACE config bound to the current session cwd', () => {
    expect(
      nextCreateInput({
        currentCwd: 'D:\\work\\session',
        workspaces: [{ path: 'D:\\work\\other' }],
      }),
    ).toEqual({
      kind: 'create',
      input: { scope: 'workspace', workspacePath: 'D:\\work\\session' },
    })
  })

  it('falls back to the FIRST registered workspace when the session has no cwd', () => {
    expect(
      nextCreateInput({
        currentCwd: undefined,
        workspaces: [{ path: 'D:\\work\\first' }, { path: 'D:\\work\\second' }],
      }),
    ).toEqual({
      kind: 'create',
      input: { scope: 'workspace', workspacePath: 'D:\\work\\first' },
    })
  })

  it('refuses the create when there is neither a session cwd nor a workspace', () => {
    // Never a silent `scope: 'global'` fallback.
    expect(nextCreateInput({ currentCwd: undefined, workspaces: [] })).toEqual({
      kind: 'refuse',
      reason: 'no-workspace',
    })
  })

  it('refuses the create when the first workspace carries no path', () => {
    expect(nextCreateInput({ currentCwd: undefined, workspaces: [{}] })).toEqual({
      kind: 'refuse',
      reason: 'no-workspace',
    })
  })

  it('is used by the dialog itself (no hardcoded global scope on the New path)', () => {
    const source = readFileSync(
      new URL('../src/client/components/RunConfigDialog.tsx', import.meta.url),
      'utf8',
    )

    // The delegation must still exist, and its result is the value the payload
    // has to carry: `const decision = nextCreateInput({ … })`.
    const decision = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*nextCreateInput\s*\(/.exec(
      source,
    )?.[1]
    expect(decision, 'the dialog must delegate to nextCreateInput').toBeDefined()

    // Read the `tasks/create` payload itself instead of stripping comments out
    // of the whole file: the file legitimately *documents* the old bug, and a
    // trailing `// … scope: 'global'` comment on a code line is not a hardcoded
    // payload. Pinning the two fields to the delegation's own values keeps the
    // teeth — any literal (e.g. `scope: 'global'`) fails the equality — while a
    // comment can no longer make this guard red by accident.
    const call = source.indexOf("'tasks/create'")
    expect(call, 'the dialog must still call tasks/create').toBeGreaterThan(-1)
    // Start at the payload's own opening brace: prose sitting between the call
    // and the object literal then cannot be read as one of its fields.
    const open = source.indexOf('{', call)
    expect(open, 'the tasks/create call must carry an inline payload').toBeGreaterThan(call)
    const payload = source.slice(open, open + 400)
    expect(fieldValue(payload, /\bscope\s*:\s*([^,\n]+)/)).toBe(`${decision}.input.scope`)
    expect(fieldValue(payload, /\bworkspacePath\s*:\s*([^,\n]+)/)).toBe(
      `${decision}.input.workspacePath`,
    )
  })
})

/**
 * One field of a `tasks/create` payload region, as written in the source, with
 * a trailing comment removed (never with the whole file's comments stripped).
 * @param region - the source slice holding the payload's own fields.
 * @param field - the field matcher; capture group 1 is its value.
 * @returns the value, or `undefined` when the field is absent.
 */
function fieldValue(region: string, field: RegExp): string | undefined {
  return field
    .exec(region)?.[1]
    ?.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/, '')
    .trim()
}
