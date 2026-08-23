/** Diagnose why the hero workspace dropdown doesn't show after animations. */
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

  // Open the hero workspace chip.
  results.chip = await evaluate(`(() => {
    const runBtn = document.querySelector('[aria-label="运行"]')
    if (!runBtn) return 'no run'
    const rr = runBtn.getBoundingClientRect()
    const chip = [...document.querySelectorAll('button')].find(b => {
      const r = b.getBoundingClientRect()
      return Math.abs(r.top - rr.top) < 40 && r.left < rr.left && b.textContent.trim().length > 0
    })
    if (!chip) return 'no chip'
    chip.click()
    return 'clicked: ' + chip.textContent.trim().slice(0, 30)
  })()`)
  await sleep(800)

  results.menuState = await evaluate(`(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')]
    if (menus.length === 0) return { noMenu: true, buttons: document.querySelectorAll('button').length }
    const menu = menus.pop()
    const cs = getComputedStyle(menu)
    const rect = menu.getBoundingClientRect()
    const st = menu.getAttribute('style') ?? ''
    return {
      menuCount: menus.length + 1,
      rect: { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) },
      visibility: cs.visibility,
      opacity: cs.opacity,
      display: cs.display,
      animationName: cs.animationName,
      transform: cs.transform,
      inlineStyle: st.slice(0, 120),
      itemCount: menu.querySelectorAll('[role="menuitem"]').length,
    }
  })()`)

  // Wait a bit more and re-check (animation may have settled).
  await sleep(500)
  results.menuState2 = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return { noMenu: true }
    const cs = getComputedStyle(menu)
    const rect = menu.getBoundingClientRect()
    return {
      visibility: cs.visibility,
      opacity: cs.opacity,
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      top: Math.round(rect.top),
    }
  })()`)

  console.log('=== V13 HERO DROPDOWN DIAG ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v13 failed:', error)
  process.exit(1)
})
