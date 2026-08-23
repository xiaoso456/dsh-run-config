/** Verify save (keeps dialog open + saved hint) and cancel (closes). */
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

  // Open dialog, select first task.
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
  await sleep(600)

  // Footer buttons: should be exactly 保存 + 取消 (no OK / 应用).
  results.footer = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const texts = [...dialog.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t === '保存' || t === '取消' || t === 'OK' || t === '应用')
    const hasSave = texts.includes('保存')
    const hasCancel = texts.includes('取消')
    return { texts, hasSave, hasCancel, noOld: !texts.includes('OK') && !texts.includes('应用') }
  })()`)

  // Edit the name, then click 保存.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const input = dialog.querySelector('input[value="UI测试任务"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'UI测试任务-临时')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(400)
  results.saveClick = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const save = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')
    if (!save) return 'no save button'
    const disabled = save.disabled
    save.click()
    return { clicked: true, wasDisabled: disabled }
  })()`)
  await sleep(1200)

  // After save: dialog must STAY open, "已保存" hint visible, save disabled.
  results.afterSave = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const stillOpen = dialog !== undefined
    const hint = dialog ? dialog.innerText.includes('已保存') : false
    const save = dialog ? [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '保存') : null
    return { stillOpen, hint, saveDisabled: save ? save.disabled : null, nameValue: dialog ? dialog.querySelector('input')?.value : null }
  })()`)

  // Rename back and save.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const input = dialog.querySelector('input[value="UI测试任务-临时"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'UI测试任务')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(400)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const save = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')
    if (save) save.click()
    return true
  })()`)
  await sleep(1200)
  // Cancel closes.
  results.cancelClick = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const cancel = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')
    if (!cancel) return 'no cancel'
    cancel.click()
    return 'clicked'
  })()`)
  await sleep(800)
  results.closed = await evaluate(`document.querySelectorAll('[role="dialog"]').length === 0`)

  console.log('=== V7 SAVE / CANCEL ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v7 failed:', error)
  process.exit(1)
})
