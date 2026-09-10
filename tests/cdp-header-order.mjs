/**
 * Header-order verify: the RunCombo must sit inside the official session-header
 * utilities cluster, on the same row as that cluster's other controls (it is
 * registered there with an order below the official entries). Sequence:
 *  1. load the page; if it restores a session, verify directly;
 *  2. otherwise enter a session through the sidebar session list;
 *  3. assert the run control's box lies within the utilities cluster's box and
 *     that its vertical centre matches a neighbouring header control. */
const CDP_HTTP = 'http://127.0.0.1:9222'

import { authenticatedUrl } from './lib/web-session.mjs'

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
  const target = await fetch(`${CDP_HTTP}/json/new?about:blank`, {
    method: 'PUT',
  }).then((r) => r.json())
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
  await send('Page.navigate', { url: authenticatedUrl(BASE) })

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

  // "Inside a session" is detected by the session header's utilities cluster.
  // The English `Session log` button this used to look for no longer exists in
  // the localized header.
  const hasSessionHeader = () =>
    evaluate(`document.querySelector('[class*="headerUtilities"]') !== null`)

  let inSession = await hasSessionHeader()
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
      if (await hasSessionHeader()) {
        inSession = true
        break
      }
    }
  }

  const results = { booted, inSession }
  if (inSession) {
    // Structural check (the header is localized, so no button label is a
    // stable reference): the run control must live inside the official
    // header-utilities cluster and share its row with that cluster's other
    // controls.
    results.positions = await evaluate(`(() => {
      const run = document.querySelector('[aria-label="运行"]')
      const utilities = run?.closest('[class*="headerUtilities"]')
      if (!run || !utilities) return null
      const rr = run.getBoundingClientRect()
      const ur = utilities.getBoundingClientRect()
      const others = [...utilities.querySelectorAll('button')].filter(
        b => !b.contains(run) && b.getBoundingClientRect().width > 0,
      )
      const firstOther = others[0] ? others[0].getBoundingClientRect() : null
      const pick = run.parentElement.querySelector('[aria-expanded]')
      const pr = pick ? pick.getBoundingClientRect() : null
      return {
        runX: Math.round(rr.left),
        utilitiesX: Math.round(ur.left),
        pickX: pr ? Math.round(pr.left) : null,
        inUtilitiesCluster: true,
        withinUtilities: rr.left >= ur.left - 1 && rr.right <= ur.right + 1,
        sameRow:
          firstOther === null ||
          Math.abs(rr.top + rr.height / 2 - (firstOther.top + firstOther.height / 2)) < 20,
        neighborCount: others.length,
      }
    })()`)
  }

  console.log('=== HEADER ORDER ===')
  console.log(JSON.stringify(results, null, 2))
  console.log(`=== CONSOLE ERRORS (${consoleErrors.length}) ===`)
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  const pass =
    results.inSession === true &&
    results.positions?.withinUtilities === true &&
    results.positions?.sameRow === true &&
    consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('header order check failed:', error)
  process.exit(1)
})
