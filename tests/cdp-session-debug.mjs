/**
 * Debug: click a sidebar session row and watch what happens (URL, header,
 * tabs) so we can find a reliable way into the session page.
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

  const state = () =>
    evaluate(`(() => ({
      url: location.href,
      hasLog: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Session log'),
      tabs: document.querySelectorAll('[role="tab"]').length,
      head: document.body.innerText.slice(0, 60).replace(/\\n/g, '|'),
    }))()`)

  console.log('initial:', JSON.stringify(await state()))

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      x => x.getAttribute('aria-label') === '打开侧边栏',
    )
    if (b) b.click()
    return true
  })()`)
  await sleep(800)
  console.log('after expand:', JSON.stringify(await state()))

  const rows = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')]
    return rows.map(r => ({ text: r.textContent.trim().slice(0, 30), cls: String(r.className).slice(0, 40) }))
  })()`)
  console.log('rows:', JSON.stringify(rows))

  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')]
    const pick = rows.find(r => r.textContent.includes('pi_agent_rust')) ?? rows[0]
    if (!pick) return false
    const btn = pick.querySelector('button') ?? pick
    btn.click()
    return true
  })()`)
  for (let i = 0; i < 10; i++) {
    await sleep(2000)
    console.log(`t+${(i + 1) * 2}s:`, JSON.stringify(await state()))
  }

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('debug failed:', error)
  process.exit(1)
})
