/**
 * The two UI-state derivations behind the acceptance round's "task list tells
 * three different states apart" and "dialog opens with nothing selected"
 * defects. Both live in `core/` (no React, no DOM) so they are pinned here
 * without a browser — and, as in `create-scope.spec.ts`, the last tests assert
 * the components still delegate to them: unit tests only have teeth while that
 * wiring exists.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { firstVisibleTaskId } from '../src/client/core/firstVisibleTask.ts'
import { emptyListReason, taskListNotice } from '../src/client/core/taskListState.ts'
import type { TaskView } from '../src/client/core/types.ts'

/** One task row; only the fields a grouping reads are set. */
function task(id: string, overrides: Partial<TaskView> = {}): TaskView {
  return {
    id,
    name: id,
    type: 'llm',
    scope: 'global',
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  }
}

/** The component source of one client surface, for the wiring assertions. */
function source(relative: string): string {
  return readFileSync(new URL(`../src/client/components/${relative}`, import.meta.url), 'utf8')
}

describe('taskListNotice (loading / empty / failed must read differently)', () => {
  it('is a LOADING notice while the first load is still in flight', () => {
    expect(taskListNotice({ status: 'loading', loaded: false })).toEqual({
      state: 'loading',
      key: 'loadingTasks',
    })
    // `idle` is only ever observed before the first effect runs.
    expect(taskListNotice({ status: 'idle', loaded: false })).toEqual({
      state: 'loading',
      key: 'loadingTasks',
    })
  })

  it('is an ERROR notice after a failed load, even with a cache present', () => {
    expect(taskListNotice({ status: 'error', loaded: true })).toEqual({
      state: 'error',
      key: 'tasksLoadFailed',
    })
    expect(taskListNotice({ status: 'error', loaded: false })).toEqual({
      state: 'error',
      key: 'tasksLoadFailed',
    })
  })

  it('says nothing once the list is ready (the surface speaks for itself)', () => {
    expect(taskListNotice({ status: 'ready', loaded: true })).toBeUndefined()
  })

  it('keeps the ready wording while a REFRESH of a loaded cache is in flight', () => {
    // Otherwise an empty list would flicker to "loading" on every picker open.
    expect(taskListNotice({ status: 'loading', loaded: true })).toBeUndefined()
  })

  it('shows the three states on the hero control, the header control and the dialog', () => {
    for (const file of ['HeroRunControl.tsx', 'RunControl.tsx', 'RunConfigDialog.tsx']) {
      const text = source(file)
      expect(text).toContain('taskListNotice(')
      expect(text).toContain('<TaskListNotice')
    }
  })
})

describe('firstVisibleTaskId (the dialog opens on a configuration)', () => {
  it('takes the first GLOBAL row, like the rendered list', () => {
    expect(
      firstVisibleTaskId({
        global: [task('g1'), task('g2')],
        current: [task('c1')],
        others: [['D:\\other', [task('o1')]]],
      }),
    ).toBe('g1')
  })

  it('falls through to the current workspace, then to the other workspaces', () => {
    expect(
      firstVisibleTaskId({
        global: [],
        current: [task('c1')],
        others: [['D:\\other', [task('o1')]]],
      }),
    ).toBe('c1')
    expect(
      firstVisibleTaskId({
        global: [],
        current: [],
        others: [
          ['D:\\a', []],
          ['D:\\b', [task('o2')]],
        ],
      }),
    ).toBe('o2')
  })

  it('yields undefined for a genuinely empty list (nothing to select)', () => {
    expect(firstVisibleTaskId({ global: [], current: [], others: [] })).toBeUndefined()
    expect(firstVisibleTaskId({ global: [], current: [], others: [['D:\\a', []]] })).toBeUndefined()
  })

  it('is what the dialog selects on open (the rows cannot drift from it)', () => {
    const text = source('RunConfigDialog.tsx')
    expect(text).toContain('firstVisibleTaskId({')
    // Fed from the very arrays the left pane renders.
    expect(text).toContain('global: globalTasks')
    expect(text).toContain('current: currentTasks')
    expect(text).toContain('others: otherGroups')
    expect(text).toContain('select(firstVisibleId)')
  })
})

describe('emptyListReason (a filtered-out list is not an empty library)', () => {
  it('says "filtered" only when rows exist and the search removed every one', () => {
    expect(emptyListReason({ total: 9, shown: 0 })).toBe('filtered')
    expect(emptyListReason({ total: 0, shown: 0 })).toBe('empty')
    // Not asked by the dialog (it only asks with nothing on screen), but the
    // rule must never call a populated list "filtered".
    expect(emptyListReason({ total: 9, shown: 9 })).toBe('empty')
  })

  it('is how the dialog picks its empty wording', () => {
    const text = source('RunConfigDialog.tsx')
    expect(text).toContain('emptyListReason({ total: tasks.length, shown: filtered.length })')
    // "Nothing matches" must not offer to create a configuration, and the
    // genuine empty-library wording must stay reachable for an empty list.
    expect(text).toContain("t('noMatchTasks')")
    expect(text).toContain("t('emptyListHint')")
  })

  it('gives both task pickers the no-match wording too', () => {
    for (const file of ['RunControl.tsx', 'HeroRunControl.tsx']) {
      expect(source(file)).toContain('noMatchText=')
    }
  })
})
