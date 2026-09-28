/**
 * The session run button must start at most one run per click burst.
 *
 * Regression guard: `runTask` guarded itself with `busy` STATE only
 * (`if (task === undefined || busy) return`). Every click in the same tick reads
 * the same pre-flush state, so three clicks in one tick issued three
 * `tasks/run` calls — three background processes for one command
 * configuration. `tests/runs/20260927-174748/repro-enter-gate.mjs` is the same
 * finding one component over (HeroRunControl's Enter), fixed with a synchronous
 * ref gate.
 *
 * The probe aborts every `tasks/run` request, so nothing is started on the host;
 * the assertion is the request COUNT.
 *
 * Self-cleaning: the probe configuration is deleted in `finally`.
 */
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'
const NAME = `cdp-double-run-${Date.now().toString(36)}`
const CLICKS = 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function main() {
  const before = await rpc('tasks/list', {})
  const made = await rpc('tasks/create', {
    name: NAME,
    type: 'command',
    scope: 'global',
    command: 'echo hi',
    notifyLlm: false,
  })
  const id = made.task.id

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
  const runRequests = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params
      if (request.method !== 'OPTIONS' && request.url.includes('/api/task-runner/tasks/run')) {
        runRequests.push({ method: request.method, url: request.url })
        // Aborted, not continued: the count is the assertion, and no process
        // may actually start.
        ws.send(
          JSON.stringify({
            id: ++seq,
            method: 'Fetch.failRequest',
            params: { requestId, errorReason: 'Aborted' },
          }),
        )
      } else {
        ws.send(
          JSON.stringify({ id: ++seq, method: 'Fetch.continueRequest', params: { requestId } }),
        )
      }
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id2 = ++seq
      pending.set(id2, resolve)
      ws.send(JSON.stringify({ id: id2, method, params }))
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

  const facts = { clicks: CLICKS }
  try {
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/task-runner/tasks/run*' }] })
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
    facts.booted = true

    // Inside a session is detected by the session header's utilities cluster; a
    // fresh profile lands on the hero, so enter through the sidebar (the same
    // steps `tests/cdp-pwsh.mjs` uses, retried: the row list streams in, and a
    // click that lands before the rows exist goes nowhere).
    const hasSessionHeader = () =>
      evaluate(`document.querySelector('[class*="headerUtilities"]') !== null`)
    const openSidebar = () =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => ['打开侧边栏','Open sidebar'].includes(x.getAttribute('aria-label')))
        if (b) b.click()
        return true
      })()`)
    const clickSessionRow = () =>
      evaluate(`(() => {
        const rows = [...document.querySelectorAll('[role="treeitem"]')]
        const pick = rows.find(r => r.className.includes('sessionRow') && !r.textContent.includes('新会话'))
        if (pick === undefined) return { ok: false }
        const text = pick.textContent.trim()
        pick.click()
        return { ok: true, text }
      })()`)
    let inSession = await hasSessionHeader()
    for (let attempt = 0; attempt < 5 && !inSession; attempt += 1) {
      await openSidebar()
      let clicked = { ok: false }
      for (let i = 0; i < 10 && clicked.ok !== true; i += 1) {
        await sleep(400)
        clicked = await clickSessionRow()
      }
      facts.sessionRow = clicked
      for (let i = 0; i < 20 && !inSession; i += 1) {
        await sleep(1000)
        inSession = await hasSessionHeader()
      }
    }
    if (!inSession) throw new Error('never entered a session')
    facts.inSession = true

    // Pick the probe configuration in the header RunCombo.
    await evaluate(`(() => {
      const run = document.querySelector('[aria-label="运行"]') ?? document.querySelector('[aria-label="Run"]')
      const pick = run?.parentElement?.querySelector('[aria-expanded]')
      if (pick) pick.click()
      return true
    })()`)
    await sleep(800)
    facts.picked = await evaluate(`(() => {
      const menu = [...document.querySelectorAll('[role="menu"]')].pop()
      if (menu === undefined) return { ok: false, reason: 'no menu' }
      const row = [...menu.querySelectorAll('button[role="menuitem"]')]
        .find(r => r.textContent.trim() === ${JSON.stringify(NAME)})
      if (row === undefined) return { ok: false, reason: 'no entry', entries: [...menu.querySelectorAll('button[role="menuitem"]')].map(r => r.textContent.trim()).slice(0, 8) }
      row.click()
      return { ok: true }
    })()`)
    await sleep(500)

    // The burst: all three clicks land in ONE JS task, before React can flush
    // `busy`, so the state-only door is open for all of them.
    facts.burst = await evaluate(`(() => {
      const run = document.querySelector('[aria-label="运行"]') ?? document.querySelector('[aria-label="Run"]')
      if (run === null) return { ok: false, reason: 'no run button' }
      const disabledBefore = run.disabled
      for (let i = 0; i < ${CLICKS}; i += 1) run.click()
      return { ok: true, disabledBefore, disabledAfter: run.disabled }
    })()`)
    await sleep(1500)
    facts.runRequests = runRequests.length
  } finally {
    const removed = await rpc('tasks/delete', { id }).catch((error) => ({ error: String(error) }))
    facts.deleted = removed?.deleted ?? removed?.error
    const after = await rpc('tasks/list', {})
    facts.countRestored = after.tasks.length === before.tasks.length
    ws.close()
  }

  facts.ok = facts.picked?.ok === true && facts.runRequests === 1
  console.log('=== CDP DOUBLE RUN ===')
  console.log(JSON.stringify(facts, null, 2))
  if (!facts.ok) {
    console.error(
      `FAILED: ${CLICKS} clicks in one tick must issue exactly 1 tasks/run request (see facts above)`,
    )
    process.exitCode = 1
    return
  }
  console.log('OK')
}

await main()
