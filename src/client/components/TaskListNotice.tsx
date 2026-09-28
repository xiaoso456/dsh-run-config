/**
 * The "not ready" line of a task-list surface: a spinner plus the loading
 * wording, or a warning icon plus the failure wording. Shared by every surface
 * that lists configurations (hero / session-header combo, picker menus, dialog
 * panes) so the three states — loading, empty, failed — can never collapse
 * back into one wording again.
 * @module @xiaoso/dsh-run-config/client/TaskListNotice
 */

import { IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskListNotice as Notice } from '../core/taskListState.ts'
import { Spinner } from './Spinner.tsx'
import css from './TaskListNotice.module.css'

/** Props for the notice line. */
export interface TaskListNoticeProps {
  /** Which of the two non-ready states to present. */
  notice: Notice
  /** Localized text for `notice.key`. */
  text: string
}

/**
 * Render one non-ready list state.
 * @param props - the notice state and its localized text.
 */
export function TaskListNotice({ notice, text }: TaskListNoticeProps) {
  return (
    <span className={css.notice} data-state={notice.state}>
      {notice.state === 'loading' ? (
        <Spinner />
      ) : (
        <span className={css.icon}>
          <IconWarningOutlineRegular size={13} />
        </span>
      )}
      <span className={css.text}>{text}</span>
    </span>
  )
}
