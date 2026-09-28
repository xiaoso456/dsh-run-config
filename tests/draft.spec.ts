/**
 * The run-config dialog's editable draft: the dirty rule behind the Save
 * button and the value the form is rebuilt on. Both live in `core/draft.ts`
 * (no React, no DOM), so they are pinned here without a browser.
 *
 * The two acceptance defects they cover:
 * - clearing a prompt and saving left Save enabled forever (the form folded
 *   `''` to "unset" while the stored task kept the empty string);
 * - dragging a row to reorder discarded the unsaved edits in the right pane
 *   (the reorder bumps the store revision and replaces the task array, and the
 *   form was rebuilt on those instead of on the value it shows).
 *
 * As in `ui-state.spec.ts`, the last test asserts the dialog still delegates to
 * this module: unit tests only have teeth while that wiring exists.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { draftSignature, sameAsTask, toDraft } from '../src/client/core/draft.ts'
import type { TaskView } from '../src/client/core/types.ts'

/** One stored task; the id/timestamps are not part of the draft. */
function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: 'task-1',
    name: 'task-1',
    type: 'llm',
    scope: 'global',
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  }
}

describe('sameAsTask (the Save button is enabled only for a real edit)', () => {
  it('reads a stored empty string and an absent field as the same "unset"', () => {
    // `task_run_config` accepts `llmPrompt: ''`, and clearing the textarea and
    // saving stores the same thing: neither is "a change waiting to be saved".
    const stored = task({ llmPrompt: '', command: '', description: '' })
    expect(sameAsTask(toDraft(stored), stored)).toBe(true)
  })

  it('treats an optional field as unchanged when only the empty form differs', () => {
    const stored = task()
    const draft = toDraft(stored)
    // The form spells every optional field as '', the stored task as absent.
    expect(draft.command).toBe('')
    expect(stored.command).toBeUndefined()
    expect(sameAsTask(draft, stored)).toBe(true)
  })

  it('still reports a real edit as dirty — including clearing a filled prompt', () => {
    const stored = task({ llmPrompt: 'original' })
    expect(sameAsTask({ ...toDraft(stored), llmPrompt: '' }, stored)).toBe(false)
    expect(sameAsTask({ ...toDraft(stored), llmPrompt: 'changed' }, stored)).toBe(false)
    expect(sameAsTask({ ...toDraft(stored), name: 'renamed' }, stored)).toBe(false)
  })

  it('defaults autoSend / notifyLlm the way the Host does', () => {
    const stored = task()
    expect(sameAsTask(toDraft(stored), stored)).toBe(true)
    expect(sameAsTask({ ...toDraft(stored), autoSend: false }, stored)).toBe(false)
    expect(sameAsTask(toDraft(task({ autoSend: false })), task({ autoSend: false }))).toBe(true)
  })

  it('notices a scope or workspace change', () => {
    const stored = task({ scope: 'workspace', workspacePath: 'D:\\work' })
    expect(sameAsTask(toDraft(stored), stored)).toBe(true)
    expect(sameAsTask({ ...toDraft(stored), scope: 'global' }, stored)).toBe(false)
    expect(sameAsTask({ ...toDraft(stored), workspacePath: 'D:\\other' }, stored)).toBe(false)
  })
})

describe('draftSignature (what the form is rebuilt on)', () => {
  it('does not move when only the list order does (a reorder keeps edits)', () => {
    const stored = task({ name: 'A', llmPrompt: 'original' })
    // Same stored value, different object identity — a reload after
    // `tasks/reorder` hands the dialog exactly this.
    expect(draftSignature({ ...stored })).toBe(draftSignature(stored))
  })

  it('moves when any committed field moves', () => {
    const stored = task({ name: 'A', llmPrompt: 'original' })
    expect(draftSignature(task({ name: 'B', llmPrompt: 'original' }))).not.toBe(
      draftSignature(stored),
    )
    expect(draftSignature(task({ name: 'A', llmPrompt: '' }))).not.toBe(draftSignature(stored))
    expect(draftSignature(task({ name: 'A', llmPrompt: 'original', autoSend: false }))).not.toBe(
      draftSignature(stored),
    )
  })

  it('is what the dialog rebuilds its form on — not the revision, not the array', () => {
    const text = readFileSync(
      new URL('../src/client/components/RunConfigDialog.tsx', import.meta.url),
      'utf8',
    )
    expect(text).toContain('draftSignature(selected)')
    expect(text).toContain('[snap.dialogOpen, snap.selectedId, selectedSignature]')
    // A reorder bumps the revision and replaces the task array; keying the
    // reset effect on either one is what discarded unsaved edits on a drop.
    expect(text).not.toContain('[snap.selectedId, snap.revision, tasks]')
  })
})
