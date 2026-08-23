/**
 * Slot-origin probe: walk the DOM to find which container (and thus which
 * official slot) owns the "Session log" button, the RunCombo, the workspace
 * chip, and the "标准模式" preset selector — plus the ancestor chain
 * classes of each, so we can reason about official ordering support.
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

  const ancestry = (selector, label) =>
    evaluate(`(() => {
      const el = ${selector}
      if (!el) return null
      const chain = []
      let cur = el
      for (let i = 0; i < 8 && cur; i++) {
        const r = cur.getBoundingClientRect()
        chain.push({
          tag: cur.tagName,
          cls: String(cur.className ?? '').slice(0, 80),
          x: Math.round(r.left),
          y: Math.round(r.top),
        })
        cur = cur.parentElement
      }
      return { label: '${label}', chain }
    })()`)

  const sessionLog = await ancestry(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Session log')`,
    'session-log',
  )
  const runCombo = await ancestry(`document.querySelector('[aria-label="运行"]')`, 'run-combo')
  const workspaceChip = await ancestry(
    `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('选择工作区') || b.textContent.trim() === 'pi_agent_rust')`,
    'workspace-chip',
  )
  const closeDetail = await ancestry(
    `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '关闭详情')`,
    'close-detail',
  )

  console.log('=== SESSION PAGE ANCESTRY ===')
  console.log(JSON.stringify({ sessionLog, runCombo, workspaceChip, closeDetail }, null, 1))

  // Now open a NEW session to inspect the hero row.
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      x => x.getAttribute('aria-label') === '新建会话',
    )
    if (b) b.click()
    return true
  })()`)
  await sleep(1500)

  // The hero workspace row: dump its direct children (order + classes).
  const heroRow = await evaluate(`(() => {
    const runBtn = document.querySelector('[aria-label="运行"]')
    if (!runBtn) return null
    const row = runBtn.closest('div')
    const kids = [...row.children].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName,
        cls: String(el.className ?? '').slice(0, 70),
        text: (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 16),
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
      }
    })
    return { rowClass: String(row.className ?? '').slice(0, 80), kids }
  })()`)
  const presetAncestry = await ancestry(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '标准模式')`,
    'preset-mode',
  )
  console.log('=== HERO ROW ===')
  console.log(JSON.stringify({ heroRow, presetAncestry }, null, 1))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exit(1)
})
