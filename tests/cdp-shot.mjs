/**
 * Capture the hero-page RunCombo for visual review: one shot of the control
 * as-is, one with the run-segment tooltip visible. Writes
 * tests/screenshots/combo-{static,tooltip}.png.
 */
import { writeFileSync } from 'node:fs'
import { authenticatedUrl } from './lib/web-session.mjs'

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
    })
    return res.result?.result?.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url: authenticatedUrl(BASE) })

  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const ok = await evaluate(
      `[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '运行')`,
    )
    if (ok) break
  }

  const shot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    if (!res.result?.data)
      throw new Error(`screenshot failed: ${JSON.stringify(res).slice(0, 200)}`)
    writeFileSync(`tests/screenshots/${name}`, Buffer.from(res.result.data, 'base64'))
    console.log(`saved tests/screenshots/${name}`)
  }

  await shot('combo-static.png')

  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    run.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    return true
  })()`)
  await sleep(800)
  await shot('combo-tooltip.png')

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('shot failed:', error)
  process.exit(1)
})
