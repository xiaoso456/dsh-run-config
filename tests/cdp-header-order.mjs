/**
 * Header-order verify: the RunCombo must sit LEFT of the official "Session
 * log" button in the session header (registered into the header ACTIONS
 * cluster, before the utilities cluster). Sequence:
 *  1. load the page; if it restores a session, verify directly;
 *  2. otherwise enter a session through the hero workspace menu;
 *  3. compare x coordinates of the run segment vs the Session log button. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:3190'

async function closeAllTabs() {
  try {
    const list = await fetch(`${CDP_HTTP}/json`).then((r) => r.json())
    for (const tab of list) {
      if (tab.type === 'page') await fetch(`${CDP_HTTP}/json/close/${tab.id}`).catch(() => {})
    }
  } catch {
    /* browser may not be reachable yet */
  }
}

async function main() {
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
  const consoleErrors = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        'EXCEPTION: ' +
          (msg.params.exceptionDetails?.exception?.description ??
            msg.params.exceptionDetails?.text ??
            ''),
      )
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
    return res.result?.result?.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: `${BASE}/` })

  let booted = false
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const ok = await evaluate(
      `[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '运行')`,
    )
    if (ok) {
      booted = true
      break
    }
  }
  if (!booted) process.exit(1)

  const hasSessionLog = () =>
    evaluate(
      `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Session log')`,
    )

  let inSession = await hasSessionLog()
  if (!inSession) {
    // Hero page: open a session through the sidebar session list (avoids
    // the connectWorkspace stall in this environment).
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        x => x.getAttribute('aria-label') === '打开侧边栏',
      )
      if (b) b.click()
      return true
    })()`)
    await sleep(800)
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[role="treeitem"]')]
      const pick =
        rows.find(r => r.className.includes('sessionRow') && !r.textContent.includes('新会话')) ??
        rows.find(r => r.textContent.includes('pi_agent_rust')) ??
        rows[0]
      if (pick) pick.click()
      return true
    })()`)
    for (let i = 0; i < 30; i++) {
      await sleep(1000)
      if (await hasSessionLog()) {
        inSession = true
        break
      }
    }
  }

  const results = { booted, inSession }
  if (inSession) {
    results.positions = await evaluate(`(() => {
      const run = document.querySelector('[aria-label="运行"]')
      const log = [...document.querySelectorAll('button')].find(
        b => b.textContent.trim() === 'Session log',
      )
      if (!run || !log) return null
      const rr = run.getBoundingClientRect()
      const lr = log.getBoundingClientRect()
      const pick = run.parentElement.querySelector('[aria-expanded]')
      const pr = pick ? pick.getBoundingClientRect() : null
      return {
        runX: Math.round(rr.left),
        logX: Math.round(lr.left),
        pickX: pr ? Math.round(pr.left) : null,
        runLeftOfLog: rr.left < lr.left,
        sameRow: Math.abs(rr.top - lr.top) < 20,
        inUtilitiesCluster: !!run.closest('[class*="headerUtilities"]'),
        gapToLog: Math.round(lr.left - (rr.left + rr.width)),
      }
    })()`)
  }

  console.log('=== HEADER ORDER ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  const pass =
    results.inSession === true &&
    results.positions?.runLeftOfLog === true &&
    results.positions?.sameRow === true &&
    consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('header order check failed:', error)
  process.exit(1)
})
