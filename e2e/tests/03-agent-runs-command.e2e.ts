/**
 * Running a command configuration actually executes it.
 *
 * This is the plugin's most important behaviour and the one an assertion on the
 * DOM alone cannot prove: pressing Run must reach the host's job runner and run
 * the shell command for real.
 *
 * The proof is a file the command writes. The check therefore reads the
 * filesystem, not the page — a UI that merely says "started" cannot fake it.
 * The marker lives under `e2e/.e2e/`, which is gitignored, so the run leaves
 * the checkout clean.
 *
 * The session's working directory is this repository (the lane pins its
 * workspace to the checkout), so the command's relative path resolves here.
 *
 * Needs a model; skips itself without one.
 */

import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, createTask, enterSession, uniqueName } from './helpers.ts'

/** The lane root, so the marker path matches what the command writes. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const PREFIX = 'e2e-run'
const NAME = uniqueName(PREFIX)
const MARKER = `e2e/.e2e/${NAME}.txt`
const MARKER_ABS = join(ROOT, '.e2e', `${NAME}.txt`)

const hasModel =
  process.env.E2E_LLM_BASE_URL !== undefined &&
  process.env.E2E_LLM_API_KEY !== undefined &&
  process.env.E2E_LLM_MODEL !== undefined

test.afterEach(async ({ browser }) => {
  rmSync(MARKER_ABS, { force: true })
  if (hasModel) await cleanupByPrefix(browser, PREFIX)
})

test('running a command configuration executes it', { session: 'dsh' }, async ({
  app,
  agent,
  browser,
}) => {
  test.skip(!hasModel, 'set E2E_LLM_* in e2e/.env (copy e2e/.env.example) to run agent steps')

  await app.open('/')

  // Seed over RPC: this test is about RUNNING, not about authoring, and
  // `02-agent-creates-config` already covers the authoring flow.
  await createTask(browser, {
    name: NAME,
    type: 'command',
    scope: 'global',
    command: `echo e2e-ok > ${MARKER}`,
    notifyLlm: false,
  })

  // The header run control only exists inside a session, and the hero page's
  // own control lists LLM configurations only — a command configuration needs a
  // session's working directory. Entering the session is therefore a
  // prerequisite, not part of what this test measures.
  //
  // No reload after seeding: the control re-pulls the task list whenever its
  // dropdown opens (`taskRunnerStore.bumpRevision()` in RunControl), and
  // `app.open('/')` here would return to the hero page and drop the session.
  await enterSession(browser)

  await agent.act(`run the run configuration named "${NAME}" from the session header`, {
    params: { name: NAME },
  })

  // The real evidence: the shell command ran and wrote its marker. The plugin's
  // "started" toast is transient (it clears after ~3s) and would be racy to
  // assert on, and a toast alone would only prove the click reached the UI —
  // the marker proves it reached the host's job runner and the shell.
  await expect
    .poll(() => existsSync(MARKER_ABS), {
      timeout: 30_000,
      message: `the command never wrote ${MARKER}; the run did not reach the shell`,
    })
    .toBe(true)
})
