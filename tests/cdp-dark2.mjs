/** Restore the UI test task (global llm) via the dialog, then verify the
 * delete-confirm strip colors (dark-mode readability). */
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

  // ---- Restore: open dialog, create task, rename + prompt, apply. ----
  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    if (gear) gear.click()
    return true
  })()`)
  await sleep(1500)
  results.add = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const add = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '新增')
    if (!add) return 'no add'
    add.click()
    return 'clicked'
  })()`)
  await sleep(1200)
  results.rename = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const input = dialog.querySelector('input[value="新任务"]')
    if (!input) return 'no input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'UI测试任务')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'edited'
  })()`)
  await sleep(400)
  results.prompt = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const ta = dialog.querySelector('textarea')
    if (!ta) return 'no textarea'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '请只回复四个字：测试通过')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 'edited'
  })()`)
  await sleep(400)
  results.apply = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const apply = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')
    if (!apply) return 'no apply'
    apply.click()
    return 'clicked'
  })()`)
  await sleep(1500)

  // ---- Delete-confirm: select the first row, open confirm strip. ----
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    if (rows.length > 0) rows[0].click()
    return true
  })()`)
  await sleep(600)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const trash = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '删除')
    if (trash) trash.click()
    return true
  })()`)
  await sleep(500)

  results.confirm = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const bar = dialog.querySelector('[role="alertdialog"]')
    if (!bar) return { noBar: true }
    const parse = (c) => {
      const m = c.match(/rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?\\)/)
      if (!m) return null
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
    }
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const contrast = (fg, bgc) => (Math.max(lum(fg), lum(bgc)) + 0.05) / (Math.min(lum(fg), lum(bgc)) + 0.05)
    const danger = [...bar.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')
    const cancel = [...bar.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')
    const barBg = parse(getComputedStyle(bar).backgroundColor)
    const dFg = parse(getComputedStyle(danger).color)
    const dBg = getComputedStyle(danger).backgroundColor
    const dBgParsed = parse(dBg)
    const dBorder = getComputedStyle(danger).borderColor
    const cBorder = getComputedStyle(cancel).borderColor
    return {
      barBg: getComputedStyle(bar).backgroundColor,
      barText: getComputedStyle(bar.querySelector('[class*="confirmText"]') || bar).color,
      dangerText: getComputedStyle(danger).color,
      dangerBorder: dBorder,
      dangerBg: dBg,
      cancelBorder: cBorder,
      dangerVsBar: barBg && dFg ? +contrast(dFg, barBg).toFixed(2) : null,
      // if the danger button bg is not transparent, its own text must contrast
      dangerSelf: dBgParsed && dBgParsed.a > 0 ? +contrast(dFg, dBgParsed).toFixed(2) : null,
      barVsDialog: (() => {
        const dialogEl = [...document.querySelectorAll('[role="dialog"]')].pop()
        const db = parse(getComputedStyle(dialogEl).backgroundColor)
        return barBg && db ? +contrast(barBg, db).toFixed(2) : null
      })(),
    }
  })()`)
  await screenshot('v3-confirm-dark.png')

  // Close the dialog (cancel) so we don't delete the restored task.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const cancel = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')
    if (cancel) cancel.click()
    return true
  })()`)
  await sleep(500)

  console.log('=== DARK READABILITY (restored data) ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('dark2 failed:', error)
  process.exit(1)
})
