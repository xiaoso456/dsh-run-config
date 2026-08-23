/** Verify dialog layout: switch card spacing + switch on the right. */
const CDP_HTTP = 'http://127.0.0.1:9222'

async function main() {
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
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })

  const results = {}
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
  results.booted = booted
  if (!booted) process.exit(1)

  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    gear.click()
    return true
  })()`)
  await sleep(1500)

  results.layout = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    // The layout pane: the bordered container with the task list.
    const layout = [...dialog.querySelectorAll('div')].find(x => (x.className || '').includes('layout'))
    // The switch card: the label whose text includes 暴露任务管理工具.
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('暴露任务管理工具'))
    const card = label ? label.closest('div[class]') : null
    // The layout's parent sibling chain: switch card is the next sibling of layout inside body.
    if (!layout || !label || !card) return { noLayout: layout === null, noLabel: label === null }
    const lr = layout.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    const track = label.querySelector('[class*="switchTrack"]')
    const text = label.querySelector('[class*="switchText"]')
    const trackRect = track ? track.getBoundingClientRect() : null
    const textRect = text ? text.getBoundingClientRect() : null
    return {
      gapBetween: Math.round(cr.top - lr.bottom),
      switchOnRight: trackRect !== null && textRect !== null ? trackRect.left > textRect.right : null,
      cardW: Math.round(cr.width),
      trackW: trackRect ? Math.round(trackRect.width) : null,
    }
  })()`)

  console.log('=== V8 LAYOUT ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v8 failed:', error)
  process.exit(1)
})
