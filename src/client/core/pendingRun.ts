/**
 * The hero → session pending-run handoff: what a run control does with a
 * handoff it is asked to consume. Extracted from `RunControl`'s effect as a
 * pure orchestrator (side effects injected) so the boundary rules can be
 * asserted without a DOM — this module imports neither React nor any browser
 * API.
 *
 * Rules:
 * - a handoff addressed to another Session is left alone (only the target
 *   Session's own run control may execute it);
 * - while the task cache has not loaded, the handoff is KEPT (deferred), so a
 *   slow first load can never drop a requested run;
 * - while the target run control is busy with a run of its own, the handoff is
 *   KEPT as well: `start` would refuse to run and the request would vanish;
 * - a target the loaded cache proves gone is reported (cleared + surfaced to
 *   the user), never dropped silently;
 * - a visible target is cleared and started exactly once.
 * @module @xiaoso/dsh-run-config/client/pendingRun
 */

import type { PendingRun } from './store.ts'

/** What consuming one handoff did. */
export type PendingRunOutcome =
  /** Not addressed to this Session — nothing touched. */
  | { readonly kind: 'ignored' }
  /** The task cache has not loaded yet — the handoff is kept for the next pass. */
  | { readonly kind: 'deferred' }
  /** The loaded cache proves the target gone — cleared and reported. */
  | { readonly kind: 'unavailable'; readonly taskId: string }
  /** Visible target — cleared and started. */
  | { readonly kind: 'started'; readonly taskId: string }

/** One consumption attempt: the state plus the effects the caller owns. */
export interface PendingRunHandoff<Task extends { id: string }> {
  /** The handoff currently in the store, if any. */
  readonly pending: PendingRun | undefined
  /** The Session this run control serves. */
  readonly sessionId: string
  /** Whether the task cache has loaded at least once (`tasks !== null`). */
  readonly tasksLoaded: boolean
  /**
   * Whether the run control can start a run right now — `false` while it is
   * already busy. `start` alone cannot express this: it returns early instead
   * of throwing, so asking it without asking this clears the handoff and then
   * silently runs nothing.
   */
  readonly canStart: boolean
  /** The tasks this run control may act on. */
  readonly visible: readonly Task[]
  /** Clear exactly this handoff (identity-guarded by the store). */
  clearPendingRun(pending: PendingRun): void
  /** Tell the user the requested configuration is no longer reachable. */
  reportUnavailable(taskId: string): void
  /** Run the task. */
  start(task: Task): void
}

/**
 * Consume the hero → session handoff for one run control.
 * @param handoff - the handoff state plus the caller's effects.
 * @returns what happened (see {@link PendingRunOutcome}).
 */
export function consumePendingRun<Task extends { id: string }>(
  handoff: PendingRunHandoff<Task>,
): PendingRunOutcome {
  const { pending } = handoff
  if (pending === undefined || pending.sessionId !== handoff.sessionId) return { kind: 'ignored' }
  if (!handoff.tasksLoaded) return { kind: 'deferred' }
  // Busy: keep the handoff for the next pass instead of clearing it for a start
  // that will not happen.
  if (!handoff.canStart) return { kind: 'deferred' }
  const task = handoff.visible.find((candidate) => candidate.id === pending.taskId)
  if (task === undefined) {
    handoff.clearPendingRun(pending)
    handoff.reportUnavailable(pending.taskId)
    return { kind: 'unavailable', taskId: pending.taskId }
  }
  handoff.clearPendingRun(pending)
  handoff.start(task)
  return { kind: 'started', taskId: task.id }
}
