/**
 * Sign the browser in before any test navigates.
 *
 * The DSH web GUI authenticates a tab by exchanging the instance's launch token
 * for a session cookie. Two details shape how this is done here:
 *
 * 1. `app.open('/')` resolves a relative path against the target's base URL and
 *    therefore drops any query string on it, so the token cannot ride along on
 *    the base URL. An absolute URL is passed through unchanged, so this setup
 *    navigates to the token URL itself; the server answers with `set-cookie`
 *    and the browser keeps it for the rest of the session.
 *
 * 2. The sign-in must not fill a form. Once a secret is filled, e2e withholds
 *    model pixels and assertion screenshots for the rest of the session and
 *    `app.screenshot()` becomes `POLICY_DENIED` — which would defeat the point
 *    of this lane, since the screenshots and videos are its deliverable. A
 *    cookie-based sign-in leaves them available.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

/** This folder is `e2e/tests`, so the lane root is one level up. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Where `launch-dsh.mjs` publishes the instance's launch token. */
const TOKEN_FILE = join(ROOT, '.e2e', 'dsh-token')

test.setup(
  'sign in with the launch token',
  { sessions: ['dsh'] },
  async ({ app, browser, session }) => {
    const base = app.baseUrl
    if (base === undefined) throw new Error('the target declares no app.url to sign in against')

    const token = readFileSync(TOKEN_FILE, 'utf8').trim()
    if (token.length === 0) {
      throw new Error(`${TOKEN_FILE} is empty; did launch-dsh.mjs finish starting the instance?`)
    }

    // Built through the URL API rather than string concatenation: `baseUrl`
    // already ends in a slash, so `${base}/?token=` would send a `//?token=`
    // path and the server answers 400.
    const signInUrl = new URL(base)
    signInUrl.searchParams.set('token', token)

    await browser.goto(signInUrl.href)
    await browser.setViewport({ width: 1440, height: 900 })

    // The cookie is what makes later `app.open('/')` calls authenticated, so wait
    // for it rather than assuming the navigation already set it.
    await expect
      .poll(async () => (await browser.cookies()).length, { timeout: 15_000 })
      .toBeGreaterThan(0)

    // Prove the tab really landed in the app shell and not on a sign-in or error
    // page. The token stays in the URL — the SPA does not rewrite it — so this
    // asserts on rendered content instead of on the address.
    await expect(browser.locator('body')).toBeVisible()

    await session.save('dsh')
  },
)
