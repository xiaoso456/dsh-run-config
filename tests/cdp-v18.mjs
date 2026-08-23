/** Verify the notify-LLM checkbox visibility (border + checked fill). */
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
  // Select a command task (发布检查) so the notify checkbox renders.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    const cmd = rows.find(b => b.textContent.includes('发布检查')) ?? rows[0]
    cmd.click()
    return true
  })()`)
  await sleep(800)

  results.checkbox = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('完成后通知'))
    if (!label) return { noCheckbox: true }
    const input = label.querySelector('input[type="checkbox"]')
    const box = label.querySelector('[class*="checkbox"]')
    const cs = getComputedStyle(box)
    return {
      checked: input.checked,
      size: Math.round(box.getBoundingClientRect().width) + 'x' + Math.round(box.getBoundingClientRect().height),
      borderColor: cs.borderColor,
      borderWidth: cs.borderWidth,
      background: cs.backgroundColor,
    }
  })()`)
  // Toggle on and re-read.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('完成后通知'))
    label.querySelector('input[type="checkbox"]').click()
    return true
  })()`)
  await sleep(600)
  results.checkedState = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('完成后通知'))
    const box = label.querySelector('[class*="checkbox"]')
    const cs = getComputedStyle(box)
    return {
      checked: label.querySelector('input[type="checkbox"]').checked,
      borderColor: cs.borderColor,
      background: cs.backgroundColor,
    }
  })()`)
  // Restore the original state (was on by default).
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('完成后通知'))
    const input = label.querySelector('input[type="checkbox"]')
    if (!input.checked) input.click()
    return true
  })()`)
  await sleep(400)

  console.log('=== V18 CHECKBOX DARK ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v18 failed:', error)
  process.exit(1)
})
