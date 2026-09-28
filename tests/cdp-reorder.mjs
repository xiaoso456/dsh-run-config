/**
 * Run-config dialog reorder acceptance check, driven with REAL drag events.
 *
 * Regression guard: the dialog renders its rows GROUPED (global configurations
 * first, then the current workspace's, then every other workspace) and the group
 * order is derived from scope/workspace — only the order INSIDE a group is free.
 * `onDrop` used to compute the move from the persisted order for any drop, so a
 * drop that crossed a group boundary wrote an order computed from a different
 * sequence: the row stayed where it was, while `taskOrder` changed.
 *
 * Sequence:
 *  1. create four configurations over RPC (2 global, 2 in another workspace) so
 *     the persisted order interleaves the two groups;
 *  2. open the dialog from the hero picker and read the rendered row order;
 *  3. drag a row onto a row of the SAME group (this must keep reordering);
 *  4. drag a row onto a row of ANOTHER group (this must leave the order alone).
 *
 * The four configurations this script creates are deleted again in `finally`, so
 * the run is self-cleaning.
 */
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'
const TAG = Date.now().toString(36)
const G1 = `cdp-reorder-g1-${TAG}`
const G2 = `cdp-reorder-g2-${TAG}`
const W1 = `cdp-reorder-w1-${TAG}`
const W2 = `cdp-reorder-w2-${TAG}`
// A workspace that is never the session's own: its two rows render as one
// "other workspace" group, whichever cwd the session has.
const OTHER_WS = `${process.env.TEMP ?? 'C:\\Windows\\Temp'}\\cdp-reorder-${TAG}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Resolve a dialog row by its configuration name (rows are `<button draggable>`). */
const ROW_BY_NAME = `(name) => {
  const rows = [...document.querySelectorAll('[role="dialog"] button')]
  return rows.find((b) => {
    const label = b.querySelector('[class*="rowName"]')
    return label !== null && label.textContent.trim() === name
  }) ?? null
}`

/** Close leftover tabs so this run owns the only page. */
async function closeAllTabs() {
  try {
    const list = await fetch(`${CDP_HTTP}/json`).then((r) => r.json())
    for (const tab of list) {
      if (tab.type === 'page') await fetch(`${CDP_HTTP}/json/close/${tab.id}`).catch(() => {})
    }
  } catch {
    /* the browser may not be reachable yet */
  }
}

/** Names of the four probe configurations, in persisted order. */
async function probeOrder() {
  const { tasks } = await rpc('tasks/list', {})
  const names = new Set([G1, G2, W1, W2])
  return tasks.filter((task) => names.has(task.name)).map((task) => task.name)
}

async function main() {
  const before = await rpc('tasks/list', {})
  const created = []
  for (const task of [
    { name: W1, scope: 'workspace', workspacePath: OTHER_WS, command: 'echo w1' },
    { name: G1, scope: 'global', command: 'echo g1' },
    { name: W2, scope: 'workspace', workspacePath: OTHER_WS, command: 'echo w2' },
    { name: G2, scope: 'global', command: 'echo g2' },
  ]) {
    const made = await rpc('tasks/create', {
      type: 'command',
      notifyLlm: false,
      description: 'cdp-reorder probe',
      ...task,
    })
    created.push(made.task.id)
  }
  const seeded = await probeOrder()

  await closeAllTabs()
  const target = await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' }).then((r) =>
    r.json(),
  )
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let seq = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.result?.exceptionDetails !== undefined) {
      throw new Error(
        `evaluate failed: ${JSON.stringify(res.result.exceptionDetails).slice(0, 300)}`,
      )
    }
    return res.result?.result?.value
  }
  /** The rendered row order — what the user sees, which is what a drag acts on. */
  const renderedOrder = () =>
    evaluate(`(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] button')]
      return rows
        .map((b) => b.querySelector('[class*="rowName"]'))
        .filter((label) => label !== null)
        .map((label) => label.textContent.trim())
    })()`)
  const dragStart = (name) =>
    evaluate(`(() => {
      const row = (${ROW_BY_NAME})(${JSON.stringify(name)})
      if (row === null) return { ok: false, reason: 'no row for ' + ${JSON.stringify(name)} }
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))
      return { ok: true }
    })()`)
  const dropOn = (name) =>
    evaluate(`(() => {
      const row = (${ROW_BY_NAME})(${JSON.stringify(name)})
      if (row === null) return { ok: false, reason: 'no row for ' + ${JSON.stringify(name)} }
      row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }))
      row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }))
      return { ok: true }
    })()`)

  const facts = { seeded }
  try {
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send('Page.navigate', { url: authenticatedUrl(BASE) })

    let booted = false
    for (let i = 0; i < 40; i += 1) {
      await sleep(500)
      booted = await evaluate(
        `[...document.querySelectorAll('button')].some(b => ['运行','Run'].includes(b.getAttribute('aria-label')))`,
      )
      if (booted) break
    }
    if (!booted) throw new Error('the page never booted')

    // The dialog is opened from the hero's task picker; the app can restore a
    // session instead, so ask for the hero again while its row is missing.
    let pickerReady = false
    for (let attempt = 0; attempt < 6 && !pickerReady; attempt += 1) {
      await evaluate(`(() => {
        const row = document.querySelector('[class*="heroWorkspaceRow"]')
        if (row !== null) return true
        const button = [...document.querySelectorAll('button')].find(b => /新会话|New session/.test(b.innerText))
        if (button) button.click()
        return true
      })()`)
      for (let i = 0; i < 8 && !pickerReady; i += 1) {
        await sleep(500)
        pickerReady = await evaluate(`(() => {
          const row = document.querySelector('[class*="heroWorkspaceRow"]')
          if (row === null) return false
          const picker = [...row.querySelectorAll('button[aria-expanded]')][1]
          return picker !== undefined && picker.innerText.trim().length > 0
        })()`)
      }
    }
    if (!pickerReady) throw new Error('the hero task picker never appeared')
    await sleep(1500)

    await evaluate(`(() => {
      const row = document.querySelector('[class*="heroWorkspaceRow"]')
      row.querySelectorAll('button[aria-expanded]')[1].click()
      return true
    })()`)
    for (let i = 0; i < 16; i += 1) {
      await sleep(250)
      if (await evaluate(`document.querySelectorAll('[role="menu"]').length > 0`)) break
    }
    const opened = await evaluate(`(() => {
      const card = [...document.querySelectorAll('[role="menu"]')].pop()
      if (card === undefined) return { ok: false, reason: 'no card' }
      const entry = [...card.querySelectorAll('button[role="menuitem"]')]
        .find(b => /编辑任务配置|Edit configurations/.test(b.innerText))
      if (entry === undefined) return { ok: false, reason: 'no edit entry' }
      entry.click()
      return { ok: true }
    })()`)
    let dialogOpen = false
    for (let i = 0; i < 16; i += 1) {
      await sleep(300)
      dialogOpen = await evaluate(`document.querySelectorAll('[role="dialog"]').length > 0`)
      if (dialogOpen) break
    }
    if (!dialogOpen) throw new Error(`the dialog never opened: ${JSON.stringify(opened)}`)
    for (let i = 0; i < 10; i += 1) {
      await sleep(300)
      const rows = await renderedOrder()
      if ([G1, G2, W1, W2].every((name) => rows.includes(name))) break
    }

    facts.rendered = await renderedOrder()

    // 3. Same group: the order inside a group IS free, so this must reorder.
    facts.dragStartSame = await dragStart(G2)
    await sleep(200)
    facts.dropSame = await dropOn(G1)
    await sleep(700)
    facts.afterSameGroup = await probeOrder()

    // 4. Across groups: the group order is derived, so this must not write.
    facts.orderBeforeCross = await probeOrder()
    facts.dragStartCross = await dragStart(G2)
    await sleep(200)
    facts.dropCross = await dropOn(W1)
    await sleep(700)
    facts.afterCrossGroup = await probeOrder()

    facts.sameGroupReordered =
      facts.afterSameGroup.indexOf(G2) !== -1 &&
      facts.afterSameGroup.indexOf(G2) < facts.afterSameGroup.indexOf(G1)
    facts.crossGroupKeptOrder =
      JSON.stringify(facts.orderBeforeCross) === JSON.stringify(facts.afterCrossGroup)
    facts.cleanup = []
  } finally {
    for (const id of created) {
      const res = await rpc('tasks/delete', { id }).catch((error) => ({ error: String(error) }))
      facts.cleanup.push(res?.deleted ?? res?.error ?? 'unknown')
    }
    const after = await rpc('tasks/list', {})
    facts.countRestored = after.tasks.length === before.tasks.length
    ws.close()
  }

  facts.ok = facts.sameGroupReordered === true && facts.crossGroupKeptOrder === true
  console.log('=== CDP REORDER ===')
  console.log(JSON.stringify(facts, null, 2))
  if (!facts.ok) {
    console.error(
      'FAILED: the same-group drag must reorder, the cross-group drag must not (see facts above)',
    )
    process.exitCode = 1
    return
  }
  console.log('OK')
}

await main()
