/**
 * Header DOM probe: dump the top-bar elements with their container classes,
 * then open a NEW session (hero page) and dump its top-bar too, so we can
 * see which slot container holds what and where "标准模式" lives.
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

  // Top bar: elements whose bounding box intersects y in [0, 60).
  const topbar = await evaluate(`(() => {
    const hits = []
    const walk = (el, depth) => {
      if (depth > 6) return
      const r = el.getBoundingClientRect()
      const visible = r.width > 0 && r.height > 0 && r.top < 60 && r.bottom > 0
      if (visible && (el.tagName === 'BUTTON' || /slot|bar|header|nav|actions/i.test(el.className || ''))) {
        hits.push({
          tag: el.tagName,
          cls: String(el.className ?? '').slice(0, 70),
          text: (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 20),
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
        })
      }
      for (const c of el.children) walk(c, depth + 1)
    }
    walk(document.body, 0)
    hits.sort((a, b) => a.x - b.x)
    return hits
  })()`)
  console.log('=== SESSION TOPBAR (x-sorted) ===')
  console.log(JSON.stringify(topbar, null, 1))

  // Open the NEW-session page: click the sidebar "新建会话" button.
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      x => x.getAttribute('aria-label') === '新建会话',
    )
    if (b) b.click()
    return true
  })()`)
  await sleep(1500)

  const hero = await evaluate(`(() => {
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
    return out.slice(0, 30)
  })()`)
  console.log('=== NEW-SESSION PAGE (top 30 buttons) ===')
  console.log(JSON.stringify(hero, null, 1))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exit(1)
})
