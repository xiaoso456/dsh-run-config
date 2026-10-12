/**
 * The hero control offers LLM configurations only.
 *
 * A rule the plugin states deliberately: the hero page has no session, so it
 * has no working directory — and a command task needs one. The hero run control
 * therefore lists LLM configurations and hides command ones.
 *
 * This is the kind of rule that rots silently: nothing fails when the filter
 * widens, the hero control just starts offering a configuration that cannot run.
 * The test seeds one of each and checks which of them the dropdown shows.
 *
 * Deterministic on purpose — the assertion reads the dropdown's contents, not
 * anything a model does — so it costs no model calls and runs on every machine.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, createTask, uniqueName } from './helpers.ts'

const PREFIX = 'e2e-hero'
const LLM_NAME = uniqueName(`${PREFIX}-llm`)
const CMD_NAME = uniqueName(`${PREFIX}-cmd`)

test.afterEach(async ({ browser }) => {
  await cleanupByPrefix(browser, PREFIX)
})

test('the hero run control lists LLM configurations only', { session: 'dsh' }, async ({
  app,
  browser,
}) => {
  await app.open('/')

  await createTask(browser, {
    name: LLM_NAME,
    type: 'llm',
    scope: 'global',
    llmPrompt: 'e2e hero probe',
    autoSend: false,
  })
  await createTask(browser, {
    name: CMD_NAME,
    type: 'command',
    scope: 'global',
    command: 'echo e2e-hero-probe',
    notifyLlm: false,
  })

  // Stay on the hero page — that is the surface under test. Opening the
  // dropdown re-pulls the task list, so the seeded pair is already visible.
  const inHero = await browser.evaluate(() => document.body.innerText.includes('探索未至之境'))
  expect(inHero).toBe(true)

  const opened = await browser.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('选择任务运行配置'),
    )
    if (trigger instanceof HTMLElement) {
      trigger.click()
      return true
    }
    return false
  })
  expect(opened).toBe(true)

  await expect
    .poll(
      () =>
        browser.evaluate(
          (names: { llm: string; cmd: string }) => {
            const text = document.body.innerText
            return { hasLlm: text.includes(names.llm), hasCmd: text.includes(names.cmd) }
          },
          { llm: LLM_NAME, cmd: CMD_NAME },
        ),
      { timeout: 15_000, message: 'the hero dropdown never rendered its list' },
    )
    .toMatchObject({ hasLlm: true, hasCmd: false })
})
