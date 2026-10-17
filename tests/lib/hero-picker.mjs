/**
 * Open the Hero task picker (`RunCombo`'s picker segment) through the CDP
 * `Runtime.evaluate` bound to a page.
 *
 * Why this lives here: the app restores the last session on load, so the Hero —
 * and with it the official `heroWorkspaceRow` our control sits in — can be
 * unmounted at ANY moment, not only on the first load. The two acceptance
 * scripts that open the run-config dialog from the Hero used to sleep a fixed
 * 1500ms after waiting for the row and then dereference it unconditionally;
 * when the restore won that race the expression threw
 * `TypeError: Cannot read properties of null (reading 'querySelectorAll')`
 * instead of a diagnosis. This helper keeps the row and the click in the same
 * `evaluate` round trip, retries by asking for a fresh session, and reports a
 * structured failure — no fixed sleep, no retry loop hiding a real bug.
 *
 * @module tests/lib/hero-picker
 */

/** Give the app up to this long to mount the official Hero row. */
const ROW_TIMEOUT_MS = 15000
/** Between two row probes (a poll interval, not a settling sleep). */
const POLL_MS = 200

/** Ask the app for the Hero page (idempotent; the row may already be there). */
const NEW_SESSION_JS = `(() => {
  const row = document.querySelector('[class*="heroWorkspaceRow"]')
  if (row !== null) return true
  const button = [...document.querySelectorAll('button')].find(b => /新会话|New session/.test(b.innerText))
  if (button) button.click()
  return true
})()`

/**
 * Wait for the Hero task picker, then click its segment in the same page turn.
 *
 * @param evaluate - the script's `Runtime.evaluate` wrapper (`(expression) =>
 * Promise<unknown>`).
 * @returns `{ ok: true, pickerText }`, or `{ ok: false, reason }` naming exactly
 * which part was missing.
 */
export async function openHeroTaskMenu(evaluate) {
  const deadline = Date.now() + ROW_TIMEOUT_MS
  let last = { ok: false, reason: 'the hero row was never observed' }
  while (Date.now() < deadline) {
    // The ask-for-hero click and the row probe share this turn; the click
    // itself is the retry, so a restore that steals the page is recoverable.
    last = await evaluate(`(() => {
      const row = document.querySelector('[class*="heroWorkspaceRow"]')
      if (row === null) {
        const button = [...document.querySelectorAll('button')].find(b => /新会话|New session/.test(b.innerText))
        if (button !== undefined) button.click()
        return { ok: false, reason: 'the app is not showing the Hero page (asked for a new session)' }
      }
      const segments = [...row.querySelectorAll('button[aria-expanded]')]
      const picker = segments[1]
      if (picker === undefined) {
        return { ok: false, reason: 'the Hero row has no task-picker segment yet (only ' + segments.length + ' aria-expanded button(s))' }
      }
      if (picker.innerText.trim().length === 0) {
        return { ok: false, reason: 'the task-picker segment is still empty (task list not loaded)' }
      }
      picker.click()
      return { ok: true, pickerText: picker.innerText.trim() }
    })()`)
    if (last?.ok === true) return last
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return last
}

/** Re-exported for callers that prefer to ask unconditionally. */
export { NEW_SESSION_JS }

/**
 * The plugin control's own leading margin (`0px` is the asserted value — the
 * host row/slot owns the spacing).
 * @returns an expression string for `Runtime.evaluate`; its value is the
 * computed `margin-left` of the control element, or `null` when the run
 * segment is not rendered.
 */
export function controlMarginProbe() {
  return `(() => {
  const run = document.querySelector('button[aria-label="运行"], button[aria-label="Run"]')
  if (run === null) return null
  let control = run.parentElement
  while (control instanceof Element && getComputedStyle(control).display === 'contents') {
    control = control.parentElement
  }
  return control instanceof Element ? getComputedStyle(control).marginLeft : null
})()`
}

/**
 * Is the plugin control flush with the row/slot that owns the spacing?
 *
 * The host row (`heroWorkspaceRow`, 2px gap) and the session header's
 * `headerUtilities` cluster (8px gap) both own the spacing between their items.
 * An own `margin-left` on `.control` adds to that gap, so the control reads as
 * detached from the surface it belongs to. This measures the real gap against
 * the container's own gap (tolerance 1px for sub-pixel rounding) and reports
 * the numbers that failed, so a regression is named, not just red.
 *
 * @returns an expression string for `Runtime.evaluate`; its value is
 * `{ ok, gap, containerGap, controlMarginLeft, why }` (`ok: false` when the
 * row still has no sibling to measure against).
 */
export function controlSpacingProbe() {
  return `(() => {
  const px = (v) => parseFloat(v) || 0
  const run = document.querySelector('button[aria-label="运行"], button[aria-label="Run"]')
  if (run === null) return { ok: false, why: 'the run segment is not rendered' }
  // Nearest laid-out ancestor above the run segment: the surface's own wrappers
  // are display:contents and report no box of their own, while the plugin's
  // control (or, on one surface, the combo itself) is a real flex box.
  let control = run.parentElement
  while (control instanceof Element && getComputedStyle(control).display === 'contents') {
    control = control.parentElement
  }
  if (!(control instanceof Element)) return { ok: false, why: 'the run segment has no laid-out ancestor' }
  const rect = control.getBoundingClientRect()
  if (rect.width === 0) return { ok: false, why: 'the run control has no box' }
  // The preceding painted element on the same line, found by geometry so the
  // probe does not depend on which wrapper level the host renders.
  const lineTop = rect.top - 6
  const lineBottom = rect.bottom + 6
  let prev = null
  let prevRight = 0
  const all = document.querySelectorAll('body *')
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i]
    if (el === control || control.contains(el) || el.contains(control)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.top < lineTop || r.bottom > lineBottom) continue
    if (r.right > rect.left + 0.5) continue
    if (prev !== null && r.right <= prevRight) continue
    prev = el
    prevRight = r.right
  }
  if (prev === null) return { ok: false, why: 'no painted neighbour precedes the control on its line' }
  const gap = Math.round((rect.left - prevRight) * 100) / 100
  // The container whose own gap rule this spacing must obey: the lowest common
  // ancestor of the control and the neighbour. (Starting at the control itself
  // would read the combo's internal 4px gap instead; that is also why the
  // ancestor must actually hold BOTH elements.)
  let hostGap = 0
  let containerCls = ''
  for (let el = control.parentElement; el instanceof Element; el = el.parentElement) {
    if (!el.contains(prev) || !el.contains(control)) continue
    const cs = getComputedStyle(el)
    const candidate = cs.columnGap === 'normal' ? px(cs.gap) : px(cs.columnGap)
    if (candidate <= 0) continue
    hostGap = candidate
    containerCls = (el.className || '').toString().slice(0, 40)
    break
  }
  const ownMargin = px(getComputedStyle(control).marginLeft)
  const ok = ownMargin === 0 && hostGap > 0 && Math.abs(gap - hostGap) <= 1
  return { ok, gap, containerGap: hostGap, containerCls, controlMarginLeft: ownMargin, why: ok ? '' : 'the control must sit at its container gap (' + hostGap + 'px), not at gap + own margin' }
})()`
}
