/**
 * CDP smoke test for the dsh-task-runner web UI: loads the test profile page
 * in headless Chrome, waits for the app to boot, then reports:
 * - whether the run control (▶ / ⚙ / task picker) rendered in the DOM
 * - whether the hero composite rendered
 * - any console errors / page exceptions
 */
const CDP_HTTP = 'http://127.0.0.1:9222'

async function main() {
  // Create a new tab.
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
  const events = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method) {
      events.push(msg)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

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
          (msg.params.exceptionDetails?.text ?? '') +
          ' ' +
          (msg.params.exceptionDetails?.exception?.description ?? ''),
      )
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push('LOG: ' + msg.params.entry.text)
    }
  }

  // Navigate to the test profile.
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })
  // Wait for the app to boot (connection + render).
  await new Promise((r) => setTimeout(r, 20000))

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true })
    return res.result?.result?.value
  }

  const bodyText = await evaluate('document.body ? document.body.innerText : ""')
  const hasRun = await evaluate(
    `document.querySelector('[aria-label="运行"]') !== null || document.querySelector('[aria-label="Run"]') !== null`,
  )
  const hasConfig = await evaluate(
    `[...document.querySelectorAll('button')].some(b => b.querySelector('svg') !== null && (b.textContent.includes('选择任务') || b.textContent.includes('任务')))`,
  )
  const hasSelect = await evaluate(
    `document.body ? (document.body.innerText.includes('选择任务') || document.body.innerText.includes('Select a task')) : false`,
  )
  const hasConfigTitle = await evaluate(
    `document.body ? (document.body.innerText.includes('运行设置') || document.body.innerText.includes('Run configurations')) : false`,
  )
  const heroControl = await evaluate(`document.querySelectorAll('button').length`)

  console.log('=== PAGE TEXT (first 1500 chars) ===')
  console.log(String(bodyText ?? '').slice(0, 1500))
  console.log('=== CHECKS ===')
  console.log('run button ▶:', hasRun)
  console.log('config button ⚙:', hasConfig)
  console.log('task picker label:', hasSelect)
  console.log('config dialog title:', hasConfigTitle)
  console.log('button count:', heroControl)
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 20)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('CDP smoke failed:', error)
  process.exit(1)
})
