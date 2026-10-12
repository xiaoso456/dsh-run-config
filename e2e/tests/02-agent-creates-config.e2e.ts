/**
 * The agent creates a run configuration through the dialog.
 *
 * What this covers: the plugin's primary authoring flow end to end — open the
 * dialog, create a configuration, give it a name and a command, save — plus the
 * host actually persisting it.
 *
 * The split is deliberate. The agent finds and operates the controls (so a
 * relabelled button or a moved field does not break this test), and the checks
 * are deterministic: the dialog's own "saved" status, and the host's stored
 * record read back over RPC. A model saying it saved something is not evidence;
 * the store containing it is.
 *
 * Needs a model; skips itself without one.
 */

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, listTasks, uniqueName } from './helpers.ts'

const PREFIX = 'e2e-crud'
const NAME = uniqueName(PREFIX)
const COMMAND = 'echo e2e-crud-ok'

const hasModel =
  process.env.E2E_LLM_BASE_URL !== undefined &&
  process.env.E2E_LLM_API_KEY !== undefined &&
  process.env.E2E_LLM_MODEL !== undefined

test.afterEach(async ({ browser }) => {
  if (hasModel) await cleanupByPrefix(browser, PREFIX)
})

test('the agent creates a command configuration', { session: 'dsh' }, async ({
  app,
  agent,
  browser,
  screen,
}) => {
  test.skip(!hasModel, 'set E2E_LLM_* in e2e/.env (copy e2e/.env.example) to run agent steps')

  await app.open('/')

  await agent.act('open the run configuration dialog')
  await expect(screen.getByRole('dialog')).toBeVisible()

  await agent.act(
    `in this dialog, create a new command configuration named "${NAME}" whose command is "${COMMAND}", then save it`,
    { params: { name: NAME, command: COMMAND } },
  )

  // The dialog's "saved" status is transient (it clears after ~2s), so it is
  // not a reliable thing to wait for after the fact. The store is: poll the
  // host until the configuration appears with the fields we asked for.
  await expect
    .poll(
      async () => {
        const stored = await listTasks(browser)
        return stored.find((task) => task.name === NAME)
      },
      { timeout: 20_000, message: `"${NAME}" was never persisted` },
    )
    .toBeDefined()

  const stored = await listTasks(browser)
  const created = stored.find((task) => task.name === NAME)
  expect(created?.type).toBe('command')
  expect(created?.command).toBe(COMMAND)
})
