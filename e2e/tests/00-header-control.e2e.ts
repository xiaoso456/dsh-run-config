/**
 * The header run control is registered inside a session.
 *
 * Deterministic on purpose — no model, no tokens. It covers the prerequisite
 * every command-task test depends on (the header control only exists inside a
 * session), and it doubles as the cheap probe that tells a plumbing failure
 * apart from an agent failure: when an agentic test fails, this one says whether
 * the app was even in the right place.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { enterSession } from './helpers.ts'

test('the run control is registered in the session header', { session: 'dsh' }, async ({
  app,
  browser,
}) => {
  await app.open('/')
  await enterSession(browser)

  // Structural check, because the header is localized and no button label is a
  // stable reference. What matters is that the plugin's control lives inside
  // the official header-utilities cluster and offers a dropdown trigger.
  const placement = await browser.evaluate(() => {
    const utilities = document.querySelector('[class*="headerUtilities"]')
    if (utilities === null) return null
    return {
      buttons: utilities.querySelectorAll('button').length,
      triggers: utilities.querySelectorAll('button[aria-expanded]').length,
    }
  })

  expect(placement).not.toBeNull()
  expect(placement?.triggers).toBeGreaterThan(0)

  await app.screenshot('header-control')
})
