/**
 * Full M3 flow test: on the hero page, click ▶ with a global llm task
 * selected → the hero connects the workspace, hands the run to the session
 * header, which fills the composer draft and submits → the model answers.
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
  await sleep(45000)

  const results = {}

  // The hero picker should show the global task.
  results.heroShowsTask = await evaluate(`document.body.innerText.includes('UI测试任务')`)

  // Click ▶ (hero run).
  results.clickRun = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const run = buttons.find(b => b.getAttribute('aria-label') === '运行')
    if (!run) return 'no run button'
    run.click()
    return 'clicked'
  })()`)
  await sleep(6000)

  // After the handoff: the composer draft should contain the prompt.
  results.draft = await evaluate(`(() => {
    const textarea = document.querySelector('textarea')
    return textarea ? textarea.value : 'no textarea'
  })()`)
  results.pageText = await evaluate(`document.body.innerText.slice(0, 800)`)

  // Wait for the model to answer.
  await sleep(30000)
  results.afterAnswer = await evaluate(`document.body.innerText.slice(0, 1200)`)

  console.log('=== M3 FLOW RESULTS ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('M3 flow failed:', error)
  process.exit(1)
})
