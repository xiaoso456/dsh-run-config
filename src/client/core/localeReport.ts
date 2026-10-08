/**
 * Approval-locale reporting: the browser tells the Host which UI language the
 * approval gate should render its reason in.
 *
 * The initial report alone is not enough — the user can switch language while
 * the page stays open, and the Host keeps the last reported value — so the same
 * report is re-sent on every locale snapshot change, and the subscription is
 * disposed with the plugin.
 *
 * Extracted from the client entry as a pure function over an injected face so
 * the "report now + report on every change" rule is unit-tested without a
 * browser.
 * @module @xiaoso/dsh-run-config/client/localeReport
 */

/** The faces the reporter needs: the active locale, the transport, the change source. */
export interface LocaleReportFace {
  /** The browser's currently active locale. */
  getActiveLocale(): string
  /** Send one report (fire-and-forget at the call site). */
  report(locale: string): void
  /** Subscribe to locale snapshot changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
}

/**
 * Report the active locale now, and again after every later change.
 * @param face - the locale source, the transport, and the change subscription.
 * @returns the disposer that ends the subscription.
 */
export function installLocaleReport(face: LocaleReportFace): () => void {
  const push = (): void => {
    face.report(face.getActiveLocale())
  }
  push()
  return face.subscribe(push)
}
