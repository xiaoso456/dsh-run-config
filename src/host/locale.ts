/**
 * Host-side approval-locale carrier: the browser half reports its active UI
 * locale through the `client/locale` RPC endpoint, and the pre-execute
 * approval gate renders its reason in that language (fallback 'en').
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
