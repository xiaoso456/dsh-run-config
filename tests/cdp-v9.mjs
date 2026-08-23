/** Verify the expose-tool switch toggles visually (bg flip) and persists. */
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

  const readSwitch = `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('暴露任务管理工具'))
    const input = label.querySelector('input[type="checkbox"]')
    const track = label.querySelector('[class*="switchTrack"]')
    return {
      checked: input.checked,
      trackBg: getComputedStyle(track).backgroundColor,
      thumbX: getComputedStyle(track.querySelector('[class*="switchThumb"]') || track).transform,
    }
  })()`

  results.before = await evaluate(readSwitch)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('暴露任务管理工具'))
    label.querySelector('input[type="checkbox"]').click()
    return true
  })()`)
  await sleep(1000)
  results.after1 = await evaluate(readSwitch)
  // Toggle back.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const label = [...dialog.querySelectorAll('label')].find(l => l.textContent.includes('暴露任务管理工具'))
    label.querySelector('input[type="checkbox"]').click()
    return true
  })()`)
  await sleep(1000)
  results.after2 = await evaluate(readSwitch)

  console.log('=== V9 SWITCH TOGGLE ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v9 failed:', error)
  process.exit(1)
})
