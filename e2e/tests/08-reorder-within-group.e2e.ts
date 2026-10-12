/**
 * Dragging a row reorders it inside its group, and only inside its group.
 *
 * The dialog renders its rows GROUPED — global, then the current workspace,
 * then every other workspace — and the group order follows from each row's
 * scope, so only the order *within* a group is free. A drop that crosses a
 * group boundary has no position to express.
 *
 * That asymmetry is the bug this pins. `onDrop` used to compute the move from
 * the persisted order for any drop, so a cross-group drop wrote an order
 * computed from a different sequence: the row stayed where it was on screen
 * while `taskOrder` changed underneath. The test drives real `DragEvent`s
 * (React listens for them; a synthetic click would not exercise this path) and
 * reads the persisted order back over RPC.
 *
 * Deterministic — no model, no tokens.
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { cleanupByPrefix, createTask, enterSession, listTasks, uniqueName } from './helpers.ts'

/** The lane root, used as a real workspace path for the cross-group case. */
const REPO = dirname(dirname(fileURLToPath(import.meta.url)))

const PREFIX = 'e2e-order'
const FIRST = uniqueName(`${PREFIX}-a`)
const SECOND = uniqueName(`${PREFIX}-b`)
const THIRD = uniqueName(`${PREFIX}-c`)

test.afterEach(async ({ browser }) => {
  await cleanupByPrefix(browser, PREFIX)
})

/**
 * Open the dialog and return the row names it renders, in order.
 *
 * The dialog has no direct trigger: it opens from the run control's dropdown,
 * whose last entry is "编辑任务配置…". Both steps are plumbing — the drag is
 * what this test measures.
 */
async function openDialogRows(browser: Parameters<typeof createTask>[0]): Promise<string[]> {
  await browser.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('选择任务运行配置'),
    )
    if (trigger instanceof HTMLElement) trigger.click()
    return true
  })

  await expect
    .poll(() => browser.evaluate(() => document.querySelectorAll('[role="menuitem"]').length), {
      timeout: 15_000,
      message: 'the run-config dropdown never opened',
    })
    .toBeGreaterThan(0)

  await browser.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) =>
      (node.textContent ?? '').includes('编辑任务配置'),
    )
    if (item instanceof HTMLElement) item.click()
    return true
  })

  await expect
    .poll(() => browser.evaluate(() => document.querySelector('[role="dialog"]') !== null), {
      timeout: 15_000,
      message: 'the run-config dialog never opened',
    })
    .toBe(true)

  return browser.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) return []
    return [...dialog.querySelectorAll('button')]
      .map((button) => button.querySelector('[class*="rowName"]'))
      .filter((label): label is Element => label !== null)
      .map((label) => (label.textContent ?? '').trim())
  })
}

/**
 * Drag one row onto another with real DragEvents, the way a user would.
 *
 * `dragstart` and `drop` go in SEPARATE evaluations, with a wait between them.
 * The dialog records the dragged row in React state (`setDragId` in
 * `onDragStart`), and `onDrop` reads it: dispatching both events in one
 * synchronous call leaves the state update unflushed, so the drop sees
 * `dragId === null` and correctly does nothing. A real drag has that gap
 * naturally; this reproduces it.
 */
async function dragRowOnto(
  browser: Parameters<typeof createTask>[0],
  fromName: string,
  toName: string,
): Promise<void> {
  await browser.evaluate((name: string) => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) throw new Error('the dialog is not open')
    const row = [...dialog.querySelectorAll('button')].find((button) => {
      const label = button.querySelector('[class*="rowName"]')
      return label !== null && (label.textContent ?? '').trim() === name
    })
    if (row === undefined) throw new Error(`no row named ${name}`)
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))
    return true
  }, fromName)

  // Let React flush `setDragId` before the drop reads it.
  await new Promise((resolve) => setTimeout(resolve, 300))

  await browser.evaluate((name: string) => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) throw new Error('the dialog is not open')
    const row = [...dialog.querySelectorAll('button')].find((button) => {
      const label = button.querySelector('[class*="rowName"]')
      return label !== null && (label.textContent ?? '').trim() === name
    })
    if (row === undefined) throw new Error(`no row named ${name}`)
    row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }))
    row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }))
    return true
  }, toName)
}

/** The persisted order, as the host holds it. */
async function persistedNames(browser: Parameters<typeof createTask>[0]): Promise<string[]> {
  const tasks = await listTasks(browser)
  return tasks.filter((task) => task.name.startsWith(PREFIX)).map((task) => task.name)
}

test('a drag reorders within a group and is ignored across groups', { session: 'dsh' }, async ({
  app,
  browser,
}) => {
  await app.open('/')
  await enterSession(browser)

  // Seed every row BEFORE opening the dialog: the dialog's list is fetched when
  // it opens, so a configuration created while it is up would not be rendered —
  // and the workspace-scoped row is needed for the cross-group case.
  //
  // FIRST and SECOND are both global: that group's internal order is free.
  // THIRD is workspace-scoped, which puts it in a different group whatever its
  // path is (the groups are global → current workspace → other workspaces).
  for (const [name, cmd, scope] of [
    [FIRST, 'echo order-a', 'global'],
    [SECOND, 'echo order-b', 'global'],
    [THIRD, 'echo order-c', 'workspace'],
  ] as const) {
    await createTask(browser, {
      name,
      type: 'command',
      scope,
      ...(scope === 'workspace' ? { workspacePath: REPO } : {}),
      command: cmd,
      notifyLlm: false,
    })
  }

  const rows = await openDialogRows(browser)
  expect(rows).toContain(FIRST)
  expect(rows).toContain(SECOND)
  expect(rows).toContain(THIRD)

  const before = await persistedNames(browser)
  expect(before).toContain(FIRST)
  expect(before).toContain(SECOND)

  // In-group drag: the first row lands on the second, so the pair swaps.
  await dragRowOnto(browser, FIRST, SECOND)
  await expect
    .poll(async () => (await persistedNames(browser)).indexOf(FIRST), {
      timeout: 15_000,
      message: 'an in-group drag did not change the persisted order',
    })
    .toBeGreaterThan(before.indexOf(FIRST))

  // Cross-group drag: a global row onto a workspace-scoped one. The drop has no
  // position to express, so it must be ignored outright — the regression this
  // half pins is an implementation that computes a permutation anyway, leaving
  // the row where it looks while the stored order changes underneath.
  const orderBeforeCross = await persistedNames(browser)
  await dragRowOnto(browser, FIRST, THIRD)
  // Give the drop time to be handled before asserting nothing moved.
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  expect(await persistedNames(browser)).toEqual(orderBeforeCross)
})
