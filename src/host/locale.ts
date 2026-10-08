/**
 * Host-side approval-locale carrier: the browser half reports its active UI
 * locale through the `client/locale` RPC endpoint, and the pre-execute
 * approval gate renders its reason in that language (fallback 'en').
 *
 * Known limitation, by design: the value is a PROCESS-WIDE singleton with
 * last-writer-wins semantics. Two browser tabs (or two sessions) reporting
 * different languages therefore fight over it, and the approval gate renders in
 * whichever reported last. Making this per-source would change the RPC payload
 * and the gate's contract, so it is recorded here instead of silently assumed
 * away (the client re-reports on every locale change, so a single tab is always
 * correct).
 * @module @xiaoso/dsh-run-config/locale
 */

let approvalLocale: 'zh' | 'en' = 'en'

/** Record the browser-reported UI locale (normalized to zh/en). */
export function setApprovalLocale(locale: string): void {
  approvalLocale = locale === 'zh' ? 'zh' : 'en'
}

/** The locale the approval gate renders reasons in. */
export function getApprovalLocale(): 'zh' | 'en' {
  return approvalLocale
}
