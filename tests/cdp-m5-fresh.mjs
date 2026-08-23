/**
 * M5: fresh-workspace tool test — create D:/code/m5-tool-test, load the page,
 * pick that workspace, select the model, submit the tool prompt, and sample
 * the transcript for tool-call evidence.
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
  if (!booted) {
    console.log(JSON.stringify(results))
    process.exit(0)
  }

  // Open the workspace picker (the chip button).
  results.pickWs = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const chip = buttons.find(b => b.textContent.includes('m5-tool-test') || b.textContent.includes('选择工作区') || b.textContent.includes('pi-gateway-project') || b.textContent.includes('dsh-'))
    if (!chip) return 'no chip'
    chip.click()
    return 'clicked'
  })()`)
  await sleep(1200)
  results.pickerHasM5 = await evaluate(`document.body.innerText.includes('m5-tool-test')`)
  results.selectM5 = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const row = buttons.find(b => b.textContent.includes('m5-tool-test'))
    if (!row) return 'no m5 row'
    row.click()
    return 'clicked'
  })()`)
  await sleep(5000)

  // Select the model for the fresh session.
  const api = async (endpoint, payloadObj) => {
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: endpoint,
      payload: payloadObj,
    })
    const r = await fetch('http://127.0.0.1:3190/api/' + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    return r.json()
  }
  const list = await api('session.list', {})
  const sess = list.result.value.items.find((s) => s.cwd && s.cwd.includes('m5-tool-test'))
  results.session = sess ? sess.sessionId : 'not found'
  if (sess) {
    await api('session.selectModel', {
      sessionId: sess.sessionId,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    results.modelSelected = true
  }
  await sleep(2000)

  // Submit the tool prompt.
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
    const buttons = [...document.querySelectorAll('button')]
    const send = buttons.filter(b => b.disabled === false).pop()
    if (!send) return 'no send'
    send.click()
    return 'clicked'
  })()`)

  // Sample the transcript for tool evidence.
  let evidence = 'none'
  let finalText = ''
  for (let i = 0; i < 18; i++) {
    await sleep(5000)
    const text = String((await evaluate(`document.body.innerText`)) ?? '')
    finalText = text.slice(0, 2500)
    if (
      text.includes('task_runner_config') ||
      text.includes('发布检查') ||
      text.includes('UI测试任务')
    ) {
      evidence = finalText
      break
    }
  }
  results.evidence = evidence
  results.finalText = finalText
  results.consoleErrors = consoleErrors

  console.log('=== M5 FRESH WORKSPACE RESULTS ===')
  console.log(JSON.stringify(results, null, 2))
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('M5 fresh test failed:', error)
  process.exit(1)
})
