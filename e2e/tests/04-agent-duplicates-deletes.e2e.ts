/**
 * The agent duplicates and deletes a configuration.
 *
 * Covers the two destructive/derivative actions on an existing configuration:
 * Duplicate makes a same-name copy with a fresh id (IDEA semantics — the user
 * renames it), and Delete removes it after a confirmation step.
 *
 * Delete is the interesting one: it is guarded by a confirmation bar, so the
 * test proves both that the guard exists (the configuration survives the first
 * click) and that confirming it actually removes the row.
 *
 * The checks read the host's stored list, not the dialog's rendering: a model
 * reporting success is not evidence, the store is.
 *
 * Needs a model; skips itself without one.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, createTask, listTasks, uniqueName } from './helpers.ts'

const PREFIX = 'e2e-crud2'
const NAME = uniqueName(PREFIX)

const hasModel =
  process.env.E2E_LLM_BASE_URL !== undefined &&
  process.env.E2E_LLM_API_KEY !== undefined &&
  process.env.E2E_LLM_MODEL !== undefined

test.afterEach(async ({ browser }) => {
  if (hasModel) await cleanupByPrefix(browser, PREFIX)
})

test('the agent duplicates then deletes a configuration', { session: 'dsh' }, async ({
  app,
  agent,
  browser,
  screen,
}) => {
  test.skip(!hasModel, 'set E2E_LLM_* in e2e/.env (copy e2e/.env.example) to run agent steps')

  await app.open('/')

  // Seed one configuration to act on. Duplicating is what this test measures,
  // not authoring.
  const seeded = await createTask(browser, {
    name: NAME,
    type: 'command',
    scope: 'global',
    command: 'echo e2e-crud2-ok',
    notifyLlm: false,
  })

  await agent.act('open the run configuration dialog')
  await expect(screen.getByRole('dialog')).toBeVisible()

  await agent.act(`select the configuration named "${NAME}" in the list`, {
    params: { name: NAME },
  })

  await agent.act('duplicate the selected configuration')
  await expect
    .poll(async () => (await listTasks(browser)).filter((task) => task.name === NAME).length, {
      timeout: 20_000,
      message: 'duplicating did not add a second configuration with the same name',
    })
    .toBe(2)

  // Delete the duplicate: the confirmation bar must come first.
  await agent.act('delete the selected configuration, confirming when asked')
  await expect
    .poll(async () => (await listTasks(browser)).filter((task) => task.name === NAME).length, {
      timeout: 20_000,
      message: 'the confirmed delete did not remove the configuration',
    })
    .toBe(1)

  // The survivor is the original, untouched.
  const remaining = (await listTasks(browser)).find((task) => task.name === NAME)
  expect(remaining?.id).toBe(seeded.id)
  expect(remaining?.command).toBe('echo e2e-crud2-ok')
})
