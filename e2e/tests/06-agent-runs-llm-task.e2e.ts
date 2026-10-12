/**
 * Running an LLM configuration fills the composer instead of starting a job.
 *
 * The plugin's second task type: an LLM configuration does not run anything in
 * the background — it puts its prompt into the composer, either sending it at
 * once (`autoSend`) or leaving it there to edit. This test pins the
 * non-sending variant, because that one is observable without depending on what
 * a model replies: the prompt must appear in the composer and stay there.
 *
 * It also checks the part a user actually notices: a prompt is offered from the
 * session header only for LLM configurations, and running one leaves the
 * composer holding exactly that prompt.
 *
 * Needs a model; skips itself without one.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, createTask, enterSession, uniqueName } from './helpers.ts'

const PREFIX = 'e2e-llm'
const NAME = uniqueName(PREFIX)
const PROMPT = `e2e-llm-prompt-${Date.now().toString(36)}`

const hasModel =
  process.env.E2E_LLM_BASE_URL !== undefined &&
  process.env.E2E_LLM_API_KEY !== undefined &&
  process.env.E2E_LLM_MODEL !== undefined

test.afterEach(async ({ browser }) => {
  if (hasModel) await cleanupByPrefix(browser, PREFIX)
})

test('running an LLM configuration fills the composer', { session: 'dsh' }, async ({
  app,
  agent,
  browser,
}) => {
  test.skip(!hasModel, 'set E2E_LLM_* in e2e/.env (copy e2e/.env.example) to run agent steps')

  await app.open('/')
  await enterSession(browser)

  // `autoSend: false` is the observable variant: the run fills the composer and
  // stops, rather than submitting and making the assertion depend on a reply.
  await createTask(browser, {
    name: NAME,
    type: 'llm',
    scope: 'global',
    llmPrompt: PROMPT,
    autoSend: false,
  })

  // No reload: the header control re-pulls whenever its dropdown opens.
  await agent.act(`run the run configuration named "${NAME}" from the session header`, {
    params: { name: NAME },
  })

  // The composer holds the configuration's prompt. This is the plugin's own
  // contract for an LLM run and needs no model reply to verify.
  await expect
    .poll(
      () =>
        browser.evaluate(() => {
          const composer = document.querySelector(
            'textarea, [contenteditable="true"], [role="textbox"]',
          )
          if (composer === null) return null
          return (
            (composer instanceof HTMLTextAreaElement ? composer.value : composer.textContent) ?? ''
          ).trim()
        }),
      { timeout: 20_000, message: 'the prompt never reached the composer' },
    )
    .toContain(PROMPT)
})
