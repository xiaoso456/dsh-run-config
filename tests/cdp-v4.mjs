/** Verify searchable pickers (hero workspace + header task) and switch colors. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const OUT_DIR = 'tests/screenshots'
const fs = await import('node:fs')

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
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
  const screenshot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    const b64 = res.result?.data
    if (!b64) return false
    fs.writeFileSync(`${OUT_DIR}/${name}`, Buffer.from(b64, 'base64'))
    return true
  }

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

  // ---- 1. Hero workspace picker: search box + filter. ----
  results.wsOpen = await evaluate(`(() => {
    const runBtn = document.querySelector('[aria-label="运行"]')
    if (!runBtn) return 'no run'
    const rr = runBtn.getBoundingClientRect()
    const chip = [...document.querySelectorAll('button')].find(b => {
      const r = b.getBoundingClientRect()
      return Math.abs(r.top - rr.top) < 40 && r.left < rr.left && b.textContent.trim().length > 0
    })
    if (!chip) return 'no chip'
    chip.click()
    return chip.textContent.trim().slice(0, 40)
  })()`)
  await sleep(600)
  results.wsMenu = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return { noMenu: true }
    const search = menu.querySelector('input')
    const rows = [...menu.querySelectorAll('[role="menuitem"]')]
    return {
      hasSearch: search !== null,
      searchPlaceholder: search?.placeholder ?? null,
      rowCount: rows.length,
      firstRow: rows[0]?.textContent.trim().slice(0, 40) ?? null,
    }
  })()`)
  // Type a query to filter.
  results.wsFilter = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const search = menu.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(search, 'task')
    search.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)
  await sleep(400)
  results.wsFiltered = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const rows = [...menu.querySelectorAll('[role="menuitem"]')]
    return { rowCount: rows.length, rows: rows.map(b => b.textContent.trim().slice(0, 40)) }
  })()`)
  await screenshot('v4-workspace-search.png')
  // Close via Escape.
  await evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return true
  })()`)
  await sleep(400)

  // ---- 2. Dialog: switch checked color + hint color. ----
  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    if (gear) gear.click()
    return true
  })()`)
  await sleep(1500)
  results.switch = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')]
    const sw = boxes[boxes.length - 1]
    const track = sw.nextElementSibling
    const trackBg = getComputedStyle(track).backgroundColor
    const hint = track.parentElement.querySelector('span span:last-child')
    return {
      checked: sw.checked,
      trackBg: trackBg,
      hintColor: hint ? getComputedStyle(hint).color : null,
    }
  })()`)
  await screenshot('v4-dialog-switch.png')
  // Toggle off to see the off state.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')]
    boxes[boxes.length - 1].click()
    return true
  })()`)
  await sleep(800)
  results.switchOff = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')]
    const sw = boxes[boxes.length - 1]
    return { checked: sw.checked, trackBg: getComputedStyle(sw.nextElementSibling).backgroundColor }
  })()`)
  // Restore on.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')]
    boxes[boxes.length - 1].click()
    return true
  })()`)
  await sleep(600)

  console.log('=== V4 SEARCHABLE PICKER ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v4 failed:', error)
  process.exit(1)
})
