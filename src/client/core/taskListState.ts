/**
 * The load states of a task list surface, derived from the store snapshot
 * alone: a surface must be able to say "loading", "empty" or "failed" instead
 * of reading a failed load as "you have no configurations".
 * @module @xiaoso/dsh-run-config/client/taskListState
 */

import type { TaskLoadStatus } from './store.ts'

/** Presentation of a list that is not ready yet. */
export type TaskListNoticeState = 'loading' | 'error'

/** A non-ready list presentation: the state and the locale key that words it. */
export interface TaskListNotice {
  state: TaskListNoticeState
  /** Locale key to render: `loadingTasks` (loading) or `tasksLoadFailed` (error). */
  key: 'loadingTasks' | 'tasksLoadFailed'
}

/**
 * The notice a list surface must show instead of its ordinary placeholder /
 * empty text, or `undefined` when the surface should speak for itself.
 *
 * `loaded` (the cache is non-null) is what separates the two loading cases: a
 * refresh over an already-loaded cache keeps the previous wording (so an empty
 * list does not flicker to "loading" every time the picker re-pulls), while a
 * first load that has not landed yet is genuinely "loading".
 * @param input - the store's load status and whether a cache exists.
 * @returns the notice to render, or `undefined` for the normal wording.
 */
export function taskListNotice(input: {
  status: TaskLoadStatus
  loaded: boolean
}): TaskListNotice | undefined {
  if (input.status === 'error') return { state: 'error', key: 'tasksLoadFailed' }
  if (input.status === 'ready') return undefined
  return input.loaded ? undefined : { state: 'loading', key: 'loadingTasks' }
}

/** Why a list surface is showing no row at all. */
export type TaskListEmptyReason =
  /** There is nothing to show: an empty library (or a surface with no rows). */
  | 'empty'
  /** The list is not empty — the search query filtered every row out. */
  | 'filtered'

/**
 * Which of the two "nothing on screen" cases a surface is in: an empty list, or
 * a search that filtered every row out. The two need different wording — the
 * empty-library text ("nothing yet, click + to create one") is wrong for a
 * filtered list that still holds rows.
 * @param input - how many rows the surface has in total and after filtering.
 * @returns `'filtered'` only when rows exist but none survived the filter.
 */
export function emptyListReason(input: { total: number; shown: number }): TaskListEmptyReason {
  return input.total > 0 && input.shown === 0 ? 'filtered' : 'empty'
}
