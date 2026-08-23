/** Edge-case verification: long prompt scrolls inside textarea (modal height
 * stable); dropdown option area has a bounded height with internal scroll. */
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

  // Open dialog, select the llm task (UI测试任务), measure modal height.
  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    gear.click()
    return true
  })()`)
  await sleep(1500)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    const llm = rows.find(b => b.textContent.includes('UI测试任务')) ?? rows[0]
    if (llm) llm.click()
    return true
  })()`)
  await sleep(600)

  const modalH = `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    return Math.round(dialog.getBoundingClientRect().height)
  })()`

  results.modalBefore = await evaluate(modalH)
  // Inject a very long prompt into the textarea.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const ta = dialog.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '超长'.repeat(20000))
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value.length
  })()`)
  await sleep(800)
  results.modalAfter = await evaluate(modalH)
  results.textarea = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const ta = dialog.querySelector('textarea')
    return {
      scrollable: ta.scrollHeight > ta.clientHeight,
      scrollHeight: ta.scrollHeight,
      clientHeight: ta.clientHeight,
    }
  })()`)

  // Switch scope to workspace, open the picker: bounded height + scroll.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const groups = [...dialog.querySelectorAll('[role="radiogroup"]')]
    const ws = groups[1] ? [...groups[1].querySelectorAll('[role="radio"]')].find(b => b.textContent.includes('工作区')) : null
    if (ws) ws.click()
    return true
  })()`)
  await sleep(500)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const trigger = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null)
    if (trigger) trigger.click()
    return true
  })()`)
  await sleep(600)
  results.picker = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return { noMenu: true }
    const body = menu.querySelector('[class*="body"]')
    const m = menu.getBoundingClientRect()
    return {
      menuH: Math.round(m.height),
      bodyScrollable: body ? body.scrollHeight > body.clientHeight : null,
      fitsViewport: m.bottom <= window.innerHeight,
      vh: window.innerHeight,
    }
  })()`)

  console.log('=== V10 EDGE CASES ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v10 failed:', error)
  process.exit(1)
})
