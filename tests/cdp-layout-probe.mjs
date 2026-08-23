/**
 * Layout probe: dump header-area buttons (text + coordinates) on the hero
 * page and inside a session page, so we can see where the RunCombo sits
 * relative to the session log entry and the preset-mode selector.
 */
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

  const dumpButtons = (label) =>
    evaluate(`(() => {
      const out = []
      for (const b of document.querySelectorAll('button')) {
        const r = b.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        out.push({
          text: (b.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 24),
          aria: b.getAttribute('aria-label') ?? null,
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
        })
      }
      out.sort((a, b) => a.y - b.y || a.x - b.x)
      return { label: '${label}', buttons: out }
    })()`)

  console.log('=== HERO PAGE (top 25 buttons) ===')
  const hero = await dumpButtons('hero')
  console.log(JSON.stringify(hero.buttons.slice(0, 25), null, 1))

  // Enter the session page: open the workspace chip menu and pick the first workspace.
  await evaluate(`(() => {
    const runBtn = document.querySelector('[aria-label="运行"]')
    const rr = runBtn.getBoundingClientRect()
    const chips = [...document.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect()
      return Math.abs(r.top - rr.top) < 40 && r.left < rr.left && b.textContent.trim().length > 0
    })
    if (chips.length === 0) return false
    chips[0].click()
    return true
  })()`)
  await sleep(700)
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return false
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    ;(items.find(b => b.textContent.trim() === 'dsh-task-runner') ?? items[0]).click()
    return true
  })()`)
  await sleep(1500)

  let entered = false
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const state = await evaluate(`(() => {
      const runBtn = document.querySelector('[aria-label="运行"]')
      if (!runBtn) return { stage: 'no-run-btn' }
      return { top: Math.round(runBtn.getBoundingClientRect().top), tabs: document.querySelectorAll('[role="tab"]').length }
    })()`)
    if (state.tabs > 0 || state.top < 120) {
      entered = true
      break
    }
  }
  console.log('entered session:', entered)

  if (entered) {
    console.log('=== SESSION HEADER (top 30 buttons) ===')
    const session = await dumpButtons('session')
    console.log(JSON.stringify(session.buttons.slice(0, 30), null, 1))
  }

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exit(1)
})
