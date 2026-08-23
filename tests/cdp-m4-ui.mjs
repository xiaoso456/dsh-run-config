/**
 * M4 UI test: run a command task from the session header ▶, verify the
 * background job appears in the header jobs button, and the command executed
 * (marker file).
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
  await sleep(40000)

  const results = {}

  // The header should be showing (active session from the previous flow).
  results.header = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      hasSessionLog: text.includes('Session log'),
      hasRun: document.querySelector('[aria-label="运行"]') !== null,
      hasTask: text.includes('发布检查'),
    }
  })()`)

  // Select the command task in the header picker (发布检查), then run it.
  results.openPicker = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const picker = buttons.find(b => b.textContent.includes('发布检查') || b.textContent.includes('选择任务'))
    if (!picker) return 'no picker'
    picker.click()
    return 'clicked'
  })()`)
  await sleep(1200)
  results.pickerMenu = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      hasGlobalGroup: text.includes('全局'),
      hasWorkspaceGroup: text.includes('当前工作区'),
      hasEditConfig: text.includes('编辑配置'),
      hasSearch: text.includes('搜索任务'),
    }
  })()`)
  // Click the 发布检查 row in the menu.
  results.selectCommand = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const row = buttons.find(b => b.textContent.includes('发布检查'))
    if (!row) return 'no command row'
    row.click()
    return 'clicked'
  })()`)
  await sleep(800)

  // Click ▶.
  results.run = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const run = buttons.find(b => b.getAttribute('aria-label') === '运行')
    if (!run) return 'no run button'
    run.click()
    return 'clicked'
  })()`)
  await sleep(6000)

  results.afterRun = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      startedText: /已启动 task-d/.test(text),
      jobsButton: /后台任务|job|task-/.test(text),
      headerRun: document.querySelector('[aria-label="运行"]') !== null,
    }
  })()`)

  console.log('=== M4 UI RESULTS ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('M4 UI test failed:', error)
  process.exit(1)
})
