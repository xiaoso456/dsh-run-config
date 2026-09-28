/**
 * The inline spinner used by the task-list notice. Hand-rolled (a ring with a
 * transparent arc) instead of the official `TextShimmer`: that primitive is a
 * text-highlight animation, while this slot needs a bare 12px ring that follows
 * `currentColor`.
 * @module @xiaoso/dsh-run-config/client/Spinner
 */

import css from './Spinner.module.css'

/** A 12px indeterminate ring, `currentColor`, frozen under reduced motion. */
export function Spinner() {
  return <span className={css.spinner} aria-hidden="true" />
}
