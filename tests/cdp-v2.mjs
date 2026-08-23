/**
 * v2 UI verification:
 * 1. Hero workspace dropdown = official dense Menu (labels, footer, check).
 * 2. Session-header task dropdown = official Menu (group labels + check).
 * 3. Run-config dialog: fixed height (identical with/without selection),
 *    wider card (880), delete confirm bar reachable + clickable, CRUD.
 * Captures screenshots for human review.
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
  const screenshot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    const b64 = res.result?.data
    if (!b64) return false
    fs.writeFileSync(`${OUT_DIR}/${name}`, Buffer.from(b64, 'base64'))
    return true
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })

  const results = {}
  let booted = false
  for (let i = 0; i < 45; i++) {
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

  // ---- 1. Hero workspace dropdown (official Menu, dense). ----
  results.heroMenu = await evaluate(`(() => {
    // The workspace chip is the button whose text contains the workspace title.
    const chips = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().length > 0 && b.textContent.trim().length < 80)
    // Prefer the one in the hero row: chip has no aria-label and sits near the run control.
    const runBtn = document.querySelector('[aria-label="运行"]')
    const chip = chips.find(b => {
      const r = b.getBoundingClientRect()
      const rr = runBtn ? runBtn.getBoundingClientRect() : null
      return rr !== null && Math.abs(r.top - rr.top) < 40 && b !== runBtn
    }) ?? null
    if (!chip) return { noChip: true, buttons: chips.length }
    chip.click()
    return { clicked: chip.textContent.trim().slice(0, 60) }
  })()`)
  await sleep(700)
  results.heroMenuOpen = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return { noMenu: true }
    const rect = menu.getBoundingClientRect()
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    const labels = [...menu.querySelectorAll('[class*="label"]')].map(e => e.textContent).filter(Boolean)
    const footer = [...menu.querySelectorAll('button')].filter(b => b.textContent.includes('添加工作区'))
    return {
      width: Math.round(rect.width),
      items: items.length,
      itemHeight: items[0] ? Math.round(items[0].getBoundingClientRect().height) : null,
      labels,
      hasFooter: footer.length > 0,
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth,
    }
  })()`)
  await screenshot('v2-hero-workspace-menu.png')
  // Pick the first workspace to enter a session.
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const item = menu ? menu.querySelector('[role="menuitem"]') : null
    if (item) item.click()
    return item !== null
  })()`)
  // Wait until the session page (header with tabs / Session log) appears.
  results.enteredSession = false
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    const inSession = await evaluate(
      `document.body.innerText.includes('Session log') || [...document.querySelectorAll('[role="tab"]')].length > 0`,
    )
    if (inSession) {
      results.enteredSession = true
      break
    }
  }
  await sleep(1200)

  // ---- 2. Session-header task dropdown (official Menu). ----
  results.headerMenu = await evaluate(`(() => {
    // The header picker trigger sits at the very top of the page (hero
    // trigger lives mid-page) next to the run button.
    const runBtn = document.querySelector('[aria-label="运行"]')
    if (!runBtn) return { noRunBtn: true }
    const rr = runBtn.getBoundingClientRect()
    if (rr.top > 120) return { notInHeader: Math.round(rr.top) }
    const buttons = [...document.querySelectorAll('button')]
    const trigger = buttons.find(b => {
      const r = b.getBoundingClientRect()
      const near = Math.abs(r.top - rr.top) < 30 && r.left > rr.left
      return near && (b.textContent.includes('选择任务') || b.textContent.includes('任务') || b.textContent.includes('UI测试') || b.textContent.includes('发布'))
    })
    if (!trigger) return { noTrigger: true }
    trigger.click()
    return { clicked: trigger.textContent.trim().slice(0, 40) }
  })()`)
  await sleep(700)
  results.headerMenuOpen = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return { noMenu: true }
    const labels = [...menu.querySelectorAll('[class*="label"]')].map(e => e.textContent).filter(Boolean)
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    const selected = items.find(b => b.getAttribute('aria-checked') === 'true' || b.querySelector('svg') !== null && b.textContent.trim().length > 0 && items.indexOf(b) > -1)
    const footer = [...menu.querySelectorAll('button')].find(b => b.textContent.includes('编辑配置'))
    return {
      labels,
      items: items.length,
      hasFooter: footer !== undefined,
      itemText: items.slice(0, 4).map(b => b.textContent.trim().slice(0, 30)),
    }
  })()`)
  await screenshot('v2-header-task-menu.png')
  // Close the menu (Escape via click outside is harder; click footer item? pick a task row).
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const items = menu ? [...menu.querySelectorAll('[role="menuitem"]')] : []
    if (items.length > 0) items[0].click()
    return items.length
  })()`)

  // ---- 3. Run-config dialog: stable height, wider card, delete confirm. ----
  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    if (gear) gear.click()
    return true
  })()`)
  await sleep(1500)

  const layoutReport = `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    if (!dialog) return { noDialog: true }
    const layout = [...dialog.querySelectorAll('div')].find(x => (x.className || '').includes('layout'))
    const right = [...dialog.querySelectorAll('div')].find(x => (x.className || '').includes('right'))
    const d = dialog.getBoundingClientRect()
    const lr = layout ? layout.getBoundingClientRect() : null
    return {
      dialogW: Math.round(d.width),
      layoutH: lr ? Math.round(lr.height) : null,
      rightText: right ? right.innerText.slice(0, 40) : null,
      fits: d.top >= 0 && d.bottom <= window.innerHeight,
    }
  })()`

  results.dialogEmpty = await evaluate(layoutReport)
  await screenshot('v2-dialog-empty.png')

  // Select the first task row.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    if (rows.length > 0) rows[0].click()
    return rows.length
  })()`)
  await sleep(700)
  results.dialogSelected = await evaluate(layoutReport)
  await screenshot('v2-dialog-selected.png')

  // Delete-confirm flow: create a temp task, select it, delete with confirm.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const add = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '新增')
    if (add) add.click()
    return true
  })()`)
  await sleep(1200)
  results.confirm = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const trash = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '删除')
    if (!trash) return { noTrash: true }
    trash.click()
    return 'clicked'
  })()`)
  await sleep(500)
  results.confirmBar = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const bar = dialog.querySelector('[role="alertdialog"]')
    if (!bar) return { noBar: true }
    const buttons = [...bar.querySelectorAll('button')]
    const rects = buttons.map(b => {
      const r = b.getBoundingClientRect()
      return { text: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight }
    })
    return { barVisible: bar.getBoundingClientRect().height > 0, buttons: rects }
  })()`)
  await screenshot('v2-dialog-confirm.png')
  // Click the danger confirm button ("删除").
  results.confirmClick = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const bar = dialog.querySelector('[role="alertdialog"]')
    const btn = [...bar.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')
    if (!btn) return 'no confirm button'
    btn.click()
    return 'clicked'
  })()`)
  await sleep(1500)
  results.afterDelete = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    return {
      rows: rows.length,
      hasTempTask: rows.some(b => b.textContent.includes('新任务')),
      barGone: dialog.querySelector('[role="alertdialog"]') === null,
      rowsText: rows.slice(0, 6).map(b => b.textContent.trim().slice(0, 24)),
    }
  })()`)

  console.log('=== V2 UI VERIFICATION ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v2 test failed:', error)
  process.exit(1)
})
