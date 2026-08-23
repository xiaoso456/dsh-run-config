/**
 * Sidebar-expand probe: open the sidebar, dump session entries, click the
 * first one, and check whether the session header (Session log) appears.
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

  // Expand the sidebar.
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      x => x.getAttribute('aria-label') === '打开侧边栏',
    )
    if (b) b.click()
    return true
  })()`)
  await sleep(800)

  const dump = await evaluate(`(() => {
    const out = []
    for (const el of document.querySelectorAll('div,li,span,a,button')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.left > 260) continue
      const text = (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 30)
      if (text.length === 0) continue
      const role = el.getAttribute('role') ?? ''
      const cls = String(el.className ?? '')
      if (role.includes('button') || role.includes('menuitem') || el.tagName === 'A' || /session|item|entry|list/i.test(cls)) {
        out.push({ tag: el.tagName, role, cls: cls.slice(0, 50), text, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
      }
    }
    out.sort((a, b) => a.y - b.y)
    return out.slice(0, 30)
  })()`)
  console.log('=== SIDEBAR (expanded) ===')
  console.log(JSON.stringify(dump, null, 1))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exit(1)
})
