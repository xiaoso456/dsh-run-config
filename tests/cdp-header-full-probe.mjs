/**
 * Session-header full DOM probe: dump every element in the header bar
 * (y < 60) with tag/class/text, to find the AgentPresetLabel ("标准模式")
 * and confirm the actions/utilities slot contents and order.
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

  // If we landed on the hero page, enter a session first (open the workspace
  // chip menu and pick the first workspace).
  const onHero = await evaluate(
    `document.querySelectorAll('[role="tab"]').length === 0 && !!document.querySelector('[aria-label="选择工作区"]')`,
  )
  if (onHero) {
    await evaluate(`(() => {
      const chip = document.querySelector('[aria-label="选择工作区"]')
      if (chip) chip.click()
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
  }

  // Wait until the session header (Session log) is present.
  let headerReady = false
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const ok = await evaluate(
      `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Session log')`,
    )
    if (ok) {
      headerReady = true
      break
    }
  }
  console.log('header ready:', headerReady)

  // Dump every element intersecting the header band (y in [0, 60)), with
  // class + text, x-sorted, plus the direct children of the title row.
  const dump = await evaluate(`(() => {
    const out = []
    const seen = new Set()
    const walk = (el, depth) => {
      if (depth > 10) return
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.top < 60 && r.bottom > 0) {
        const cls = String(el.className ?? '')
        const text = (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 24)
        if (el.children.length === 0 || text.length > 0 || /header|title|action|util|crumb|preset|seat/i.test(cls)) {
          const key = cls + '|' + text + '|' + Math.round(r.left)
          if (!seen.has(key)) {
            seen.add(key)
            out.push({
              tag: el.tagName,
              cls: cls.slice(0, 60),
              text,
              x: Math.round(r.left),
              y: Math.round(r.top),
              w: Math.round(r.width),
            })
          }
        }
      }
      for (const c of el.children) walk(c, depth + 1)
    }
    walk(document.body, 0)
    out.sort((a, b) => a.x - b.x)
    return out
  })()`)
  console.log('=== SESSION HEADER ELEMENTS ===')
  console.log(JSON.stringify(dump, null, 1))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exit(1)
})
