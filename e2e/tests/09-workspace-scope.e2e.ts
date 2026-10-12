/**
 * A session's header offers the current workspace's configurations and the
 * global ones — never another workspace's.
 *
 * The rule is the point of the `scope` field: a workspace-scoped configuration
 * belongs to one workspace, and a session running in another must not be able to
 * run it (a command task would execute in the wrong directory). The dropdown
 * therefore filters by the session's own working directory.
 *
 * The test seeds one configuration bound to a path that matches no registered
 * workspace, so it can never be the session's own, and asserts the dropdown
 * excludes it while still offering the global one. Without that second half the
 * assertion would pass on an empty dropdown, which is the shape of a vacuous
 * green.
 *
 * Deterministic — no model, no tokens.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, createTask, enterSession, uniqueName } from './helpers.ts'

const PREFIX = 'e2e-scope'
const GLOBAL_NAME = uniqueName(`${PREFIX}-global`)
const FOREIGN_NAME = uniqueName(`${PREFIX}-foreign`)

/** A path no registered workspace can have, so its group is always "other". */
const FOREIGN_WORKSPACE = 'C:\\e2e-nonexistent-workspace'

test.afterEach(async ({ browser }) => {
  await cleanupByPrefix(browser, PREFIX)
})

test("the session header hides another workspace's configurations", { session: 'dsh' }, async ({
  app,
  browser,
}) => {
  await app.open('/')
  await enterSession(browser)

  await createTask(browser, {
    name: GLOBAL_NAME,
    type: 'command',
    scope: 'global',
    command: 'echo scope-global',
    notifyLlm: false,
  })
  await createTask(browser, {
    name: FOREIGN_NAME,
    type: 'command',
    scope: 'workspace',
    workspacePath: FOREIGN_WORKSPACE,
    command: 'echo scope-foreign',
    notifyLlm: false,
  })

  // Open the header dropdown. Opening it re-pulls the task list, so both
  // seeded configurations are already known to the control.
  await browser.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('选择任务运行配置'),
    )
    if (trigger instanceof HTMLElement) trigger.click()
    return true
  })

  await expect
    .poll(
      () =>
        browser.evaluate(
          (names: { global: string; foreign: string }) => {
            const text = document.body.innerText
            return {
              hasGlobal: text.includes(names.global),
              hasForeign: text.includes(names.foreign),
            }
          },
          { global: GLOBAL_NAME, foreign: FOREIGN_NAME },
        ),
      { timeout: 15_000, message: 'the header dropdown never rendered its list' },
    )
    // The global one is offered, the foreign-workspace one is not. Asserting
    // both is what keeps this from passing on an empty list.
    .toEqual({ hasGlobal: true, hasForeign: false })
})
