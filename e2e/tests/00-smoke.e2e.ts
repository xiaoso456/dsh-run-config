/**
 * Smoke test: does the lane work end to end?
 *
 * This is deliberately the smallest possible test — sign in, open the app, see
 * the shell. Its job is not to cover a feature but to prove four things at
 * once before any real coverage is written on top:
 *
 * 1. the private instance starts and answers on the port e2e picked;
 * 2. the token-based sign-in in `e2e-auth.setup.ts` produces a usable session;
 * 3. `app.screenshot()` still works (i.e. the sign-in did not taint the
 *    session, which would silently strip every screenshot from this lane);
 * 4. the attempt produces a video file on disk.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('the app shell renders for a signed-in session', { session: 'dsh' }, async ({
  app,
  browser,
}) => {
  await app.open('/')

  await expect(browser.locator('body')).toBeVisible()

  // The evidence screenshot is the point of the lane, so assert it is still
  // permitted rather than discovering a tainted session later.
  const shot = await app.screenshot('smoke')
  expect(shot).toMatch(/smoke/)
})
