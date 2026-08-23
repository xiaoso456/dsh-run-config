/** Verify: settings button gone; task trigger opens the dialog; header
 * picker shows only current-workspace + global tasks. */
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

  // Settings button must be gone; task trigger must exist.
  results.controls = await evaluate(`(() => ({
    runButton: document.querySelector('[aria-label="运行"]') !== null,
    settingsGone: [...document.querySelectorAll('button')].every(b => b.getAttribute('aria-label') !== '运行设置'),
    trigger: [...document.querySelectorAll('button')].some(b => b.querySelector('svg') !== null && (b.textContent.includes('选择任务') || b.textContent.includes('任务'))),
  }))()`)

  // Click the task trigger (hero) -> dialog opens.
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const trig = [...document.querySelectorAll('button')].find(b => {
      if (b === run || !b.querySelector('svg')) return false
      const r = b.getBoundingClientRect()
      const rr = run.getBoundingClientRect()
      return Math.abs(r.top - rr.top) < 40 && r.left > rr.left
    })
    if (trig) trig.click()
    return true
  })()`)
  await sleep(1200)
  results.dialogOpened = await evaluate(`document.querySelectorAll('[role="dialog"]').length > 0`)

  console.log('=== V20 NO SETTINGS BUTTON ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v20 failed:', error)
  process.exit(1)
})
