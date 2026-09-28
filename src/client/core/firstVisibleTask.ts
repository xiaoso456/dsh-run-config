/**
 * Which configuration the run-config dialog shows when it opens with nothing
 * selected. The dialog renders its left pane from groups; the same groups are
 * passed here, so "the first visible configuration" is by construction the
 * first row of the list the user sees (global → current workspace → other
 * workspaces by path).
 * @module @xiaoso/dsh-run-config/client/firstVisibleTask
 */

import type { TaskView } from './types.ts'

/** The dialog's left-pane grouping, in render order. */
export interface TaskGroups {
  /** Global-scope configurations, in store order. */
  global: TaskView[]
  /** The current workspace's configurations, in store order. */
  current: TaskView[]
  /** Other workspaces' configurations, grouped and sorted by workspace path. */
  others: Array<[string, TaskView[]]>
}

/**
 * The id of the first row the dialog's list would render.
 * @param groups - the dialog's grouping of the (already filtered) tasks.
 * @returns the first visible task id, or `undefined` when there is no row.
 */
export function firstVisibleTaskId(groups: TaskGroups): string | undefined {
  const firstOther = groups.others.find(([, tasks]) => tasks.length > 0)
  return groups.global[0]?.id ?? groups.current[0]?.id ?? firstOther?.[1][0]?.id
}
