/**
 * The agent edits an existing configuration.
 *
 * Covers the update path: pick a stored configuration, change a field, save,
 * and have the host record the change. This is the flow a user follows far more
 * often than creating one from scratch, and it exercises `tasks/update` — which
 * patches only the fields it is given, so a bug there could silently drop the
 * untouched ones.
 *
 * The test therefore changes one field and asserts that a field it did NOT
 * touch survived, which is what a partial update is supposed to guarantee.
 *
 * Needs a model; skips itself without one.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, createTask, listTasks, uniqueName } from './helpers.ts'

const PREFIX = 'e2e-edit'
const NAME = uniqueName(PREFIX)
const NEW_NAME = `${NAME}-renamed`
const ORIGINAL_COMMAND = 'echo e2e-edit-original'

const hasModel =
  process.env.E2E_LLM_BASE_URL !== undefined &&
  process.env.E2E_LLM_API_KEY !== undefined &&
  process.env.E2E_LLM_MODEL !== undefined

test.afterEach(async ({ browser }) => {
  if (hasModel) await cleanupByPrefix(browser, PREFIX)
})

test('the agent renames an existing configuration', { session: 'dsh' }, async ({
  app,
  agent,
  browser,
  screen,
}) => {
  test.skip(!hasModel, 'set E2E_LLM_* in e2e/.env (copy e2e/.env.example) to run agent steps')

  await app.open('/')

  const seeded = await createTask(browser, {
    name: NAME,
    type: 'command',
    scope: 'global',
    command: ORIGINAL_COMMAND,
    notifyLlm: false,
  })

  await agent.act('open the run configuration dialog')
  await expect(screen.getByRole('dialog')).toBeVisible()

  await agent.act(
    `select the configuration named "${NAME}" in the list, change its name to "${NEW_NAME}", and save`,
    { params: { oldName: NAME, newName: NEW_NAME } },
  )

  await expect
    .poll(async () => (await listTasks(browser)).find((task) => task.id === seeded.id)?.name, {
      timeout: 20_000,
      message: 'the rename was never persisted',
    })
    .toBe(NEW_NAME)

  // A partial update must not disturb the fields it was not given. The command
  // was never touched by this flow, so it has to still be there — and the id
  // must be unchanged, i.e. the row was edited rather than replaced.
  const updated = (await listTasks(browser)).find((task) => task.id === seeded.id)
  expect(updated?.command).toBe(ORIGINAL_COMMAND)
  expect(updated?.type).toBe('command')
})
