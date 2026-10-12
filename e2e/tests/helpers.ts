/**
 * Shared helpers for the e2e suite.
 *
 * The suite's shape: the agent does the ACTING (so a renamed control does not
 * break the test), and a deterministic locator does the CHECKING (so the result
 * is real evidence, not a model's opinion). These helpers cover the setup work
 * that is not what a test is about — seeding configurations and reading the
 * host's own record of them.
 *
 * Seeding goes through the plugin's real RPC rather than the dialog: it is the
 * same endpoint the LLM tool writes to, it is fast, and it keeps a test's
 * starting state out of the thing the test is measuring.
 */

import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'

/** One run configuration as the host returns it. */
export interface TaskView {
  id: string
  name: string
  type: 'llm' | 'command'
  scope: 'global' | 'workspace'
  workspacePath?: string
  llmPrompt?: string
  command?: string
  autoSend?: boolean
  notifyLlm?: boolean
}

/** Input for `tasks/create`. */
export interface TaskCreateInput {
  name: string
  description?: string
  type: 'llm' | 'command'
  scope: 'global' | 'workspace'
  workspacePath?: string
  llmPrompt?: string
  autoSend?: boolean
  command?: string
  notifyLlm?: boolean
}

/** A name no earlier run can collide with. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Call one task-runner endpoint on the page's own connection.
 *
 * Runs in the browser because the route is behind the browser-session fence:
 * the tab's cookie is the credential, and this helper runs where that cookie
 * already applies. `fetch` is same-origin here, so no token is handled.
 *
 * The call is passed to the page as a JSON string. `browser.evaluate` only
 * accepts JSON-safe arguments, and a payload of type `unknown` is not provably
 * one; serializing it here makes that explicit and keeps the boundary honest.
 */
export async function rpc<Result>(
  browser: Browser,
  endpoint: string,
  payload: unknown,
): Promise<Result> {
  const request = JSON.stringify({ method: `task-runner/${endpoint}`, payload })

  const result = await browser.evaluate(async (serialized: string) => {
    const { method, payload } = JSON.parse(serialized) as { method: string; payload: unknown }
    const response = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method,
        payload,
      }),
    })
    const body = await response.json()
    if (body?.result?.ok !== true) throw new Error(JSON.stringify(body))
    return body.result.value
  }, request)

  return result as Result
}

/** Create one configuration and return it. */
export async function createTask(browser: Browser, input: TaskCreateInput): Promise<TaskView> {
  const { task } = await rpc<{ task: TaskView }>(browser, 'tasks/create', input)
  return task
}

/** Delete one configuration by id, ignoring one already gone. */
export async function deleteTask(browser: Browser, id: string): Promise<void> {
  await rpc(browser, 'tasks/delete', { id }).catch(() => undefined)
}

/** Every configuration the host currently holds. */
export async function listTasks(browser: Browser): Promise<TaskView[]> {
  const { tasks } = await rpc<{ tasks: TaskView[] }>(browser, 'tasks/list', {})
  return tasks
}

/** Delete every configuration whose name starts with `prefix`. */
export async function cleanupByPrefix(browser: Browser, prefix: string): Promise<void> {
  const tasks = await listTasks(browser).catch(() => [] as TaskView[])
  for (const task of tasks) {
    if (task.name.startsWith(prefix)) await deleteTask(browser, task.id)
  }
}

/**
 * True while the app is inside a session, i.e. where the header run control
 * lives.
 *
 * The signal is the official `headerUtilities` cluster, which only renders once
 * a session is open; on the hero page the run control sits in the composer
 * instead and this is absent. The hero page carries its own `aria-label="运行"`
 * control, so the button alone cannot tell the two apart.
 */
export async function inSession(browser: Browser): Promise<boolean> {
  return browser.evaluate(
    () =>
      document.querySelector('[class*="headerUtilities"]') !== null &&
      !document.body.innerText.includes('探索未至之境'),
  )
}

/**
 * Enter a session, because the session-header run control only exists there.
 *
 * Test plumbing, not the thing under test: getting into the state a test needs
 * is not what the test measures, and spending model calls on it would only add
 * noise to the trace.
 *
 * A fresh private `DSH_HOME` has no session with content, so there is no saved
 * row to click — the app sits on the hero page. Sending one message is what
 * creates the session. The message is a plain greeting; the reply comes from the
 * instance's own configured model and is not asserted on, because this is
 * plumbing.
 *
 * All three phases run as single page-side evaluations. Polling from Node would
 * add one recorded step per attempt — hundreds of them in the trace — while the
 * waiting itself is only interesting if it times out.
 */
export async function enterSession(browser: Browser, timeoutMs = 90_000): Promise<void> {
  if (await inSession(browser)) return

  // Phase 1: an existing saved session, when there is one. Clicking the row is
  // best-effort — on this build it does not always navigate — so a failure here
  // falls through to phase 2 rather than hanging.
  const clickedRow = await browser.evaluate(() => {
    const row = document.querySelector('[role="treeitem"][class*="sessionRow"]')
    if (row instanceof HTMLElement) {
      row.click()
      return true
    }
    return false
  })
  if (clickedRow && (await waitForSession(browser, 8_000))) return

  // Phase 2: send one message, which is what reliably creates a session. The
  // composer's element type is not stable (it is a contenteditable div, not a
  // textarea), so it is addressed by role.
  await browser
    .locator('textarea, [contenteditable="true"], [role="textbox"]')
    .first()
    .fill('hello')
  await browser.evaluate(() => {
    const send = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === '发送消息',
    )
    if (send instanceof HTMLElement) send.click()
    return true
  })

  // `expect.poll` is not recorded as a report step (unlike `browser.evaluate`),
  // so waiting here costs one trace line instead of one per poll. A single
  // page-side loop would instead run into the 30s action timeout.
  await expect
    .poll(() => inSession(browser), {
      timeout: timeoutMs,
      interval: 500,
      message: `the session header never appeared within ${timeoutMs} ms`,
    })
    .toBe(true)
}

/**
 * Wait up to `budgetMs` for the session header, reporting whether it appeared.
 * Used where a miss is an expected branch rather than a failure.
 */
async function waitForSession(browser: Browser, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await inSession(browser)) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}
