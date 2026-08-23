/**
 * M5 verification: send a prompt through the UI asking the model to use the
 * task_runner_config tool, and check the transcript shows the tool call with
 * the task list.
 */
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
  for (let i = 0; i < 40; i++) {
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

  // Type the tool prompt into the composer textarea and submit.
  results.typePrompt = await evaluate(`(() => {
    const textarea = document.querySelector('textarea')
    if (!textarea) return 'no textarea'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, '用 task_runner_config 工具列出所有任务，只报告任务名，不要做别的。')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)
  await sleep(800)
  results.submit = await evaluate(`(() => {
    // The send button is typically the last button in the composer tool row.
    const buttons = [...document.querySelectorAll('button')]
    const send = buttons.filter(b => b.disabled === false).pop()
    if (!send) return 'no send button'
    send.click()
    return 'clicked'
  })()`)
  // Wait for the model turn (tool call + answer).
  await sleep(90000)
  results.transcript = await evaluate(`document.body.innerText.slice(0, 2000)`)

  console.log('=== M5 TOOL RESULTS ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('M5 test failed:', error)
  process.exit(1)
})
