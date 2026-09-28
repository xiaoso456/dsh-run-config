/**
 * `taskRunnerStore.upsertTask` — the write-path invariant on the task cache.
 *
 * A write response may be MERGED into the cache, so the record it carries is selectable
 * at once; the cache's own load state belongs to the list — `tasks === null` still means
 * "no list yet" (the hero → session handoff defers on it), and a write neither announces
 * nor clears a load result. The cases share the module-level store and run in this order
 * on purpose: the first two observe the never-loaded state, the rest build a delivered list.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { consumePendingRun } from '../src/client/core/pendingRun.ts'
import { taskRunnerStore } from '../src/client/core/store.ts'
import { taskListNotice } from '../src/client/core/taskListState.ts'
import type { TaskView } from '../src/client/core/types.ts'

/** One stored task. */
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

/** The notice the surfaces derive from the snapshot (their `loaded` input). */
function noticeOf(): ReturnType<typeof taskListNotice> {
  const snap = taskRunnerStore.getSnapshot()
  return taskListNotice({ status: snap.tasksStatus, loaded: snap.tasks !== null })
}

describe('upsertTask (a write may fill the cache, never judge it)', () => {
  it('does not turn "no list yet" into a one-item list', () => {
    expect(taskRunnerStore.getSnapshot().tasks).toBeNull()
    taskRunnerStore.upsertTask(task('written-before-load', { name: 'written' }))
    // Still "no list": the surfaces must keep saying "loading"…
    expect(taskRunnerStore.getSnapshot().tasks).toBeNull()
    expect(noticeOf()?.key).toBe('loadingTasks')
  })

  it('leaves a handoff deferred when a write lands before the list', () => {
    const pending = { taskId: 'task-not-in-the-cache', sessionId: 's1' }
    taskRunnerStore.requestPendingRun(pending)
    taskRunnerStore.upsertTask(task('written-before-load-2'))
    const snap = taskRunnerStore.getSnapshot()
    const report = vi.fn()
    const start = vi.fn()

    const outcome = consumePendingRun({
      pending: snap.pendingRun,
      sessionId: 's1',
      tasksLoaded: snap.tasks !== null,
      canStart: true,
      visible: snap.tasks ?? [],
      clearPendingRun: (entry) => {
        taskRunnerStore.clearPendingRun(entry)
      },
      reportUnavailable: report,
      start,
    })

    // … and the requested run must NOT be judged "gone" against a partial cache.
    expect(outcome).toEqual({ kind: 'deferred' })
    expect(taskRunnerStore.getSnapshot().pendingRun).toBe(pending)
    expect(report).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    taskRunnerStore.clearPendingRun(pending)
  })

  it('merges into a delivered list: insert first, then replace by id', () => {
    taskRunnerStore.setTasks([task('a'), task('b')])
    taskRunnerStore.upsertTask(task('c', { name: 'C' }))
    expect(taskRunnerStore.getSnapshot().tasks?.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    taskRunnerStore.upsertTask(task('a', { name: 'A-renamed' }))
    const snap = taskRunnerStore.getSnapshot()
    expect(snap.tasks?.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(snap.tasks?.find((entry) => entry.id === 'a')?.name).toBe('A-renamed')
    expect(noticeOf()).toBeUndefined()
  })

  it('does not clear a failed load, and still merges', () => {
    taskRunnerStore.setLoadError('transport failure for /api/task-runner/tasks/list: HTTP 500')
    taskRunnerStore.upsertTask(task('d'))
    const snap = taskRunnerStore.getSnapshot()
    expect(snap.tasksStatus).toBe('error')
    expect(snap.loadError).toBe('transport failure for /api/task-runner/tasks/list: HTTP 500')
    expect(snap.tasks?.some((entry) => entry.id === 'd')).toBe(true)
    expect(noticeOf()?.key).toBe('tasksLoadFailed')
  })

  it('is only the cache write: the write paths call it, the state fields stay with the load', () => {
    const store = readFileSync(new URL('../src/client/core/store.ts', import.meta.url), 'utf8')
    expect(store).toContain('patch({ tasks: next })')
    expect(store).not.toContain('patch({ tasks: next, tasksStatus')
    // The consumers' "no list yet" input is what the invariant rests on.
    const control = readFileSync(
      new URL('../src/client/components/RunControl.tsx', import.meta.url),
      'utf8',
    )
    expect(control).toContain('tasksLoaded: snap.tasks !== null')
    const dialog = readFileSync(
      new URL('../src/client/components/RunConfigDialog.tsx', import.meta.url),
      'utf8',
    )
    expect(dialog.match(/upsertTask\(/g)).toHaveLength(3)
  })
})
