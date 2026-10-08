/**
 * The hero → session pending-run handoff boundary (first-round test-gap #6).
 * `consumePendingRun` owns the rules and is driven here with the REAL store, so
 * the assertions cover the actual handoff, not a double:
 *
 * - not loaded yet  → the handoff is KEPT (a slow first load never drops a run);
 * - loaded + gone   → cleared AND reported (never dropped silently);
 * - loaded + there  → cleared and started exactly once;
 * - other Session   → untouched.
 *
 * No DOM and no new dependency: `core/pendingRun.ts` is pure apart from the
 * effects its caller injects.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { consumePendingRun } from '../src/client/core/pendingRun.ts'
import { type PendingRun, taskRunnerStore } from '../src/client/core/store.ts'
import type { TaskView } from '../src/client/core/types.ts'

/** One visible task (only `id` is read by the handoff rules). */
function taskView(id: string, workspacePath: string): TaskView {
  return {
    id,
    name: id,
    type: 'llm',
    scope: 'workspace',
    workspacePath,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** The handoff the hero page stores for session `s1`. */
function handoff(taskId: string, sessionId = 's1'): PendingRun {
  return { taskId, sessionId }
}

describe('consumePendingRun (hero → session handoff)', () => {
  it('KEEPS the handoff while the task cache has not loaded yet', () => {
    const pending = handoff('task-1')
    taskRunnerStore.requestPendingRun(pending)
    const report = vi.fn()
    const start = vi.fn()

    const outcome = consumePendingRun({
      pending,
      sessionId: 's1',
      tasksLoaded: false,
      canStart: true,
      visible: [],
      clearPendingRun: (entry) => {
        taskRunnerStore.clearPendingRun(entry)
      },
      reportUnavailable: report,
      start,
    })

    expect(outcome).toEqual({ kind: 'deferred' })
    // The run is NOT lost: the store still holds the very same handoff.
    expect(taskRunnerStore.getSnapshot().pendingRun).toBe(pending)
    expect(report).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    taskRunnerStore.clearPendingRun(pending)
  })

  it('clears AND reports a handoff whose target the loaded cache proves gone', () => {
    const pending = handoff('task-gone')
    taskRunnerStore.requestPendingRun(pending)
    const report = vi.fn()
    const start = vi.fn()

    const outcome = consumePendingRun({
      pending,
      sessionId: 's1',
      tasksLoaded: true,
      canStart: true,
      visible: [taskView('task-other', 'D:\\work')],
      clearPendingRun: (entry) => {
        taskRunnerStore.clearPendingRun(entry)
      },
      reportUnavailable: report,
      start,
    })

    expect(outcome).toEqual({ kind: 'unavailable', taskId: 'task-gone' })
    expect(taskRunnerStore.getSnapshot().pendingRun).toBeUndefined()
    // Not silent: the user is told the requested configuration is unreachable.
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('task-gone')
    expect(start).not.toHaveBeenCalled()
  })

  it('clears the handoff and starts the target exactly once when it is visible', () => {
    const pending = handoff('task-1')
    taskRunnerStore.requestPendingRun(pending)
    const report = vi.fn()
    const start = vi.fn()
    const target = taskView('task-1', 'D:\\work')

    const outcome = consumePendingRun({
      pending,
      sessionId: 's1',
      tasksLoaded: true,
      canStart: true,
      visible: [taskView('task-other', 'D:\\work'), target],
      clearPendingRun: (entry) => {
        taskRunnerStore.clearPendingRun(entry)
      },
      reportUnavailable: report,
      start,
    })

    expect(outcome).toEqual({ kind: 'started', taskId: 'task-1' })
    expect(taskRunnerStore.getSnapshot().pendingRun).toBeUndefined()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(target)
    expect(report).not.toHaveBeenCalled()
  })

  it('leaves a handoff addressed to ANOTHER Session untouched', () => {
    const pending = handoff('task-1', 's2')
    taskRunnerStore.requestPendingRun(pending)
    const report = vi.fn()
    const start = vi.fn()

    const outcome = consumePendingRun({
      pending,
      sessionId: 's1',
      tasksLoaded: true,
      canStart: true,
      visible: [taskView('task-1', 'D:\\work')],
      clearPendingRun: (entry) => {
        taskRunnerStore.clearPendingRun(entry)
      },
      reportUnavailable: report,
      start,
    })

    expect(outcome).toEqual({ kind: 'ignored' })
    expect(taskRunnerStore.getSnapshot().pendingRun).toBe(pending)
    expect(start).not.toHaveBeenCalled()
    taskRunnerStore.clearPendingRun(pending)
  })

  it('does not let a stale consumer drop a NEWER handoff (store identity guard)', () => {
    const older = handoff('task-older')
    const newer = handoff('task-newer')
    taskRunnerStore.requestPendingRun(older)
    taskRunnerStore.requestPendingRun(newer)

    // The older handoff was replaced: clearing it must be a no-op.
    taskRunnerStore.clearPendingRun(older)
    expect(taskRunnerStore.getSnapshot().pendingRun).toBe(newer)
    taskRunnerStore.clearPendingRun(newer)
    expect(taskRunnerStore.getSnapshot().pendingRun).toBeUndefined()
  })

  it('KEEPS the handoff while the run control is busy, then starts it once free', () => {
    const pending = handoff('task-1')
    taskRunnerStore.requestPendingRun(pending)
    const report = vi.fn()
    const start = vi.fn()

    const busy = consumePendingRun({
      pending,
      sessionId: 's1',
      tasksLoaded: true,
      canStart: false,
      visible: [taskView('task-1', 'D:\\work')],
      clearPendingRun: (entry) => {
        taskRunnerStore.clearPendingRun(entry)
      },
      reportUnavailable: report,
      start,
    })

    // Busy is not "gone": clearing here cleared a requested run that `start`
    // then refused to run (it returns early while busy) — dropped in silence.
    expect(busy).toEqual({ kind: 'deferred' })
    expect(taskRunnerStore.getSnapshot().pendingRun).toBe(pending)
    expect(start).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()

    // The very same handoff is what the next, free pass consumes.
    const free = consumePendingRun({
      pending,
      sessionId: 's1',
      tasksLoaded: true,
      canStart: true,
      visible: [taskView('task-1', 'D:\\work')],
      clearPendingRun: (entry) => {
        taskRunnerStore.clearPendingRun(entry)
      },
      reportUnavailable: report,
      start,
    })

    expect(free).toEqual({ kind: 'started', taskId: 'task-1' })
    expect(start).toHaveBeenCalledTimes(1)
    expect(taskRunnerStore.getSnapshot().pendingRun).toBeUndefined()
  })

  it('is used by the run control itself (the rules are not inlined again)', () => {
    const source = readFileSync(
      new URL('../src/client/components/RunControl.tsx', import.meta.url),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // A real usage: either a plain call or an explicit type argument.
    expect(code).toMatch(/consumePendingRun\s*[<(]/)
    // The "report it instead of dropping it" callback must stay wired.
    expect(code).toContain('reportUnavailable')
    // ... and so must the busy window: the rules must be TOLD when a run may
    // start, otherwise a handoff arriving mid-run is cleared and never runs.
    expect(code).toContain('canStart')
  })

  // Round-1 review P4: the handoff lookup must receive the tasks THIS control
  // may act on (current workspace + global), not the whole cache — the two
  // disagreed while `pendingRun`'s `visible` is documented as the former.
  it('gives the handoff its own visible set, not the whole task cache', () => {
    const source = readFileSync(
      new URL('../src/client/components/RunControl.tsx', import.meta.url),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/visible:\s*visibleTasks/)
    expect(code).not.toMatch(/visible:\s*visible,/)
  })
})
