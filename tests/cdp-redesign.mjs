/**
 * Redesign verification: the dialog must fully fit the viewport at small
 * laptop sizes (the previous bug: host Modal is overflow:hidden + centered,
 * so oversized dialogs clip top/bottom with no scroll). Measures geometry,
 * checks footer/switch visibility, captures screenshots for review.
 */
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
    if (res.result?.exceptionDetails) {
      return 'EVAL_ERROR: ' + (res.result.exceptionDetails.exception?.description ?? '')
    }
    return res.result?.result?.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')

  const setViewport = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }

  const screenshot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    const b64 = res.result?.data
    if (!b64) return false
    fs.writeFileSync(`${OUT_DIR}/${name}`, Buffer.from(b64, 'base64'))
    return true
  }

  const dialogReport = `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    if (!dialog) return { noDialog: true }
    const d = dialog.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const buttons = [...dialog.querySelectorAll('button')]
    const ok = buttons.find(b => b.textContent.trim() === '取消' || b.textContent.trim() === '确认')
    const okRect = ok ? ok.getBoundingClientRect() : null
    const switchRow = [...dialog.querySelectorAll('input[type="checkbox"]')].pop()
    const swRect = switchRow ? switchRow.closest('label')?.getBoundingClientRect() ?? switchRow.getBoundingClientRect() : null
    const right = [...dialog.querySelectorAll('div')].find(x => (x.className || '').includes('right'))
    const rightScrollable = right ? right.scrollHeight > right.clientHeight : null
    return {
      viewport: [vw, vh],
      dialog: { top: Math.round(d.top), bottom: Math.round(d.bottom), left: Math.round(d.left), right: Math.round(d.right), width: Math.round(d.width), height: Math.round(d.height) },
      fitsVertically: d.top >= 0 && d.bottom <= vh,
      fitsHorizontally: d.left >= 0 && d.right <= vw,
      okButtonVisible: okRect ? okRect.bottom <= vh && okRect.top >= 0 : null,
      okButtonBottom: okRect ? Math.round(okRect.bottom) : null,
      switchVisible: swRect ? swRect.bottom <= vh && swRect.top >= 0 : null,
      switchBottom: swRect ? Math.round(swRect.bottom) : null,
      rightPaneScrollable: rightScrollable,
      hasSegmented: dialog.querySelector('[role="radiogroup"]') !== null,
      hasTextarea: dialog.querySelector('textarea') !== null,
      hasSwitch: switchRow !== null,
    }
  })()`

  // 1. Navigate + boot at desktop size.
  await setViewport(1440, 900)
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })

  const results = {}
  let booted = false
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const hasGear = await evaluate(
      `[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '运行')`,
    )
    if (hasGear) {
      booted = true
      break
    }
  }
  results.booted = booted

  // 2. Open the dialog at desktop size and select the first task row so the
  // form (segmented controls, textarea) renders.
  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    if (gear) gear.click()
    return true
  })()`)
  await sleep(1500)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    if (!dialog) return false
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    if (rows.length > 0) rows[0].click()
    return rows.length
  })()`)
  await sleep(700)
  results.large = await evaluate(dialogReport)
  await screenshot('dialog-1440x900.png')

  // 3. Small laptop viewport: the reported bug (clipped run settings).
  await setViewport(1280, 700)
  await sleep(600)
  results.small = await evaluate(dialogReport)
  await screenshot('dialog-1280x700.png')

  // 4. Even smaller: 1152x640 (common Windows laptop after browser chrome).
  await setViewport(1152, 640)
  await sleep(600)
  results.tiny = await evaluate(dialogReport)
  await screenshot('dialog-1152x640.png')

  // 5. Header control + picker menu screenshot at desktop size.
  await setViewport(1440, 900)
  await sleep(600)
  await evaluate(`(() => {
    // close dialog if open
    const close = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.getAttribute('aria-label') === '取消')
    if (close) close.click()
    return true
  })()`)
  await sleep(600)
  // Open the header task picker.
  const pickerOpened = await evaluate(`(() => {
    const picker = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null)
    if (!picker) return false
    picker.click()
    return true
  })()`)
  results.pickerOpened = pickerOpened
  await sleep(700)
  await screenshot('header-picker-1440x900.png')

  // Sanity: run button visible with icon, task picker trigger present.
  results.controls = await evaluate(`(() => ({
    runButton: document.querySelector('[aria-label="运行"]') !== null,
    pickerTrigger: [...document.querySelectorAll('button')].some(b => b.querySelector('svg') !== null && (b.textContent.includes('选择任务') || b.textContent.includes('任务'))),
    playIcon: document.querySelector('[aria-label="运行"] svg') !== null,
  }))()`)

  console.log('=== REDESIGN VERIFICATION ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('redesign test failed:', error)
  process.exit(1)
})
