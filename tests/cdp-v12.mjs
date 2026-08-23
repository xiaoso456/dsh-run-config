/** Verify animation wiring: rise-in, sliding indicator, menu-in, pill-pop. */
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
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    if (rows.length > 0) rows[0].click()
    return true
  })()`)
  await sleep(800)

  results.animations = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const layout = [...dialog.querySelectorAll('div')].find(x => (x.className || '').includes('layout'))
    const indicator = dialog.querySelector('[class*="segmentIndicator"]')
    const row = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('draggable') === 'true')
    const cs = (el) => el ? getComputedStyle(el).animationName : null
    const indTransform = indicator ? getComputedStyle(indicator).transform : null
    return {
      layoutAnim: cs(layout),
      rowAnim: cs(row),
      indicatorExists: indicator !== null,
      indicatorTransform: indTransform,
      indicatorAnim: indicator ? getComputedStyle(indicator).transitionProperty : null,
    }
  })()`)

  // Switch the type segment (llm -> command) and watch the indicator move.
  results.switchType = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const group = [...dialog.querySelectorAll('[role="radiogroup"]')][0]
    const cmd = [...group.querySelectorAll('[role="radio"]')].find(b => b.textContent.includes('命令任务'))
    cmd.click()
    return 'clicked'
  })()`)
  await sleep(600)
  results.indicatorAfter = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const indicator = dialog.querySelector('[class*="segmentIndicator"]')
    return indicator ? getComputedStyle(indicator).transform : null
  })()`)

  // Open the workspace picker and check its menu animation.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const groups = [...dialog.querySelectorAll('[role="radiogroup"]')]
    const ws = groups[1] ? [...groups[1].querySelectorAll('[role="radio"]')].find(b => b.textContent.includes('工作区')) : null
    if (ws) ws.click()
    return true
  })()`)
  await sleep(400)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const trigger = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null)
    if (trigger) trigger.click()
    return true
  })()`)
  await sleep(500)
  results.menuAnim = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return null
    return { animationName: getComputedStyle(menu).animationName, animationDuration: getComputedStyle(menu).animationDuration }
  })()`)

  console.log('=== V12 ANIMATIONS ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v12 failed:', error)
  process.exit(1)
})
