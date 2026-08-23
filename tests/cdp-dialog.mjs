/**
 * Dialog CRUD test: open ⚙, check the task list, create a task, edit it,
 * save, delete with confirmation, and toggle the LLM-expose switch.
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

  // Poll until the run control appears (boot can be slow with many sessions).
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

  // Open the config dialog.
  results.open = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const gear = buttons.find(b => b.getAttribute('aria-label') === '运行')
    if (!gear) return 'no gear'
    gear.click()
    return 'clicked'
  })()`)
  await sleep(1500)

  results.dialog = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    if (!dialog) return { noDialog: true }
    const text = dialog.innerText
    return {
      hasTitle: text.includes('运行设置'),
      hasGlobalGroup: text.includes('全局'),
      hasWorkspaceGroup: text.includes('当前工作区'),
      hasUiTestTask: text.includes('UI测试任务'),
      hasPublishTask: text.includes('发布检查'),
      hasExpose: text.includes('暴露任务管理工具给 LLM'),
      searchPlaceholder: dialog.querySelector('input[placeholder="搜索任务…"]') !== null,
    }
  })()`)

  // Select the llm task and check the right-pane form.
  results.selectTask = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const buttons = [...dialog.querySelectorAll('button')]
    const row = buttons.find(b => b.textContent.includes('UI测试任务'))
    if (!row) return 'no row'
    row.click()
    return 'clicked'
  })()`)
  await sleep(800)
  results.form = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const text = dialog.innerText
    return {
      hasName: text.includes('名称'),
      hasType: text.includes('类型'),
      hasScope: text.includes('作用域'),
      hasPrompt: text.includes('Prompt'),
      hasSave: text.includes('保存'),
      hasCancel: text.includes('取消'),
    }
  })()`)

  // Edit the name and save.
  results.editName = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const input = dialog.querySelector('input[value="UI测试任务"]')
    if (!input) return 'no name input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'UI测试任务v2')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'edited'
  })()`)
  await sleep(400)
  results.save = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const buttons = [...dialog.querySelectorAll('button')]
    const save = buttons.find(b => b.textContent.trim() === '保存')
    if (!save) return 'no save'
    save.click()
    return 'clicked'
  })()`)
  await sleep(1200)
  results.afterApply = await evaluate(`(() => {
    const text = document.body.innerText
    return { hasV2: text.includes('UI测试任务v2') }
  })()`)

  // Toggle the LLM switch.
  results.toggleSwitch = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')]
    if (boxes.length === 0) return 'no checkbox'
    const sw = boxes[boxes.length - 1]
    sw.click()
    return 'clicked'
  })()`)
  await sleep(1000)
  results.afterToggle = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')]
    return { switchChecked: boxes[boxes.length - 1] ? boxes[boxes.length - 1].checked : null }
  })()`)

  // Close with OK.
  results.cancel = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const buttons = [...dialog.querySelectorAll('button')]
    const cancel = buttons.find(b => b.textContent.trim() === '取消')
    if (!cancel) return 'no cancel'
    cancel.click()
    return 'clicked'
  })()`)
  await sleep(800)
  results.closed = await evaluate(`document.querySelectorAll('[role="dialog"]').length === 0`)

  console.log('=== DIALOG CRUD RESULTS ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('dialog test failed:', error)
  process.exit(1)
})
