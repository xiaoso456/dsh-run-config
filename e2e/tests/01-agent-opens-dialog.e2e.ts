/**
 * Agentic smoke test: can the model drive the plugin's UI?
 *
 * This is the test the whole lane exists for. It hands the agent a goal in
 * natural language and lets it find the controls itself, then checks the result
 * with an ordinary locator assertion. Nothing here hard-codes a click path, so
 * the test survives the plugin's markup changing.
 *
 * That assertion is also what makes the step cheap on later runs: e2e records a
 * verified `act` and replays it without a model call, handing control back to
 * the model only when a control or the end state no longer matches. See
 * `docs/cache.mdx` in the upstream clone.
 *
 * Needs a model. Without one the built-in agent reports `MODEL_UNAVAILABLE`, so
 * the test skips itself rather than failing.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

/** True when `.env`/`.env.local` supplied a model; the config reads the same vars. */
const hasModel =
  process.env.E2E_LLM_BASE_URL !== undefined &&
  process.env.E2E_LLM_API_KEY !== undefined &&
  process.env.E2E_LLM_MODEL !== undefined

test('the agent opens the run-config dialog', { session: 'dsh' }, async ({
  app,
  agent,
  screen,
}) => {
  test.skip(!hasModel, 'set E2E_LLM_* in e2e/.env (copy e2e/.env.example) to run agent steps')

  await app.open('/')

  // The goal, not the path: the agent has to find the control itself.
  await agent.act('open the run configuration dialog')

  // Deterministic check that the goal was reached. The dialog is the plugin's
  // own surface, so its title is the fact worth asserting.
  await expect(screen.getByRole('dialog')).toBeVisible()
})
