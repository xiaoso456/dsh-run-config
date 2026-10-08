/**
 * Approval-locale reporting (round-1 review P3).
 *
 * The Host renders the tool-write approval reason in the language the browser
 * last reported. The client used to report ONCE during `apply`, so switching the
 * UI language left the approval copy in the old language until a page reload —
 * while dsh's client locale face already publishes a snapshot per change
 * (`ctx.locale.subscribe`). The rule lives in `core/localeReport.ts` (pure over
 * an injected face) so it is asserted here.
 */
import { describe, expect, it, vi } from 'vitest'
import { installLocaleReport, type LocaleReportFace } from '../src/client/core/localeReport.ts'

/** A locale face that lets the test drive the snapshot. */
function fakeFace(initial: string): { face: LocaleReportFace; snapshot: (locale: string) => void } {
  let active = initial
  const listeners = new Set<() => void>()
  return {
    face: {
      getActiveLocale: () => active,
      report: vi.fn(),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    snapshot: (locale) => {
      active = locale
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('installLocaleReport', () => {
  it('reports the active locale immediately', () => {
    const { face } = fakeFace('zh')
    installLocaleReport(face)
    expect(face.report).toHaveBeenCalledTimes(1)
    expect(face.report).toHaveBeenCalledWith('zh')
  })

  it('re-reports on every later locale change, with the NEW locale', () => {
    const { face, snapshot } = fakeFace('zh')
    installLocaleReport(face)
    snapshot('en')
    snapshot('zh')
    expect((face.report as ReturnType<typeof vi.fn>).mock.calls).toEqual([['zh'], ['en'], ['zh']])
  })

  it('stops reporting once the returned disposer ran', () => {
    const { face, snapshot } = fakeFace('zh')
    const dispose = installLocaleReport(face)
    dispose()
    snapshot('en')
    expect(face.report).toHaveBeenCalledTimes(1)
  })
})
