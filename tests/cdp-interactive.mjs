/**
 * Interactive CDP test for the dsh-task-runner web UI:
 * 1. opens the run-config dialog via ⚙ and checks the IDEA-style form
 * 2. creates a task via the dialog's ＋ button
 * 3. selects an llm task in the header picker and clicks ▶, then checks the
 *    composer draft was filled (standard send flow)
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
    if (res.result?.exceptionDetails) {
      return {
        error:
          res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text,
      }
    }
    return res.result?.result?.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })
  await sleep(20000)

  const results = {}

  // 1. Open the config dialog via ⚙.
  results.openDialog = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const gear = buttons.find(b => b.getAttribute('aria-label') === '运行')
    if (!gear) return 'no gear button'
    gear.click()
    return 'clicked'
  })()`)
  await sleep(1500)
  results.dialogText = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      hasTitle: text.includes('运行设置'),
      hasName: text.includes('名称'),
      hasType: text.includes('类型'),
      hasScope: text.includes('作用域'),
      hasExpose: text.includes('暴露任务管理工具给 LLM'),
      hasAdd: text.includes('新增'),
      hasDuplicate: text.includes('复制'),
      hasDelete: text.includes('删除'),
      hasSave: text.includes('保存'),
      hasCancel: text.includes('取消'),
    }
  })()`)

  // 2. Create a task via ＋.
  results.createTask = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const add = buttons.find(b => b.getAttribute('aria-label') === '新增')
    if (!add) return 'no add button'
    add.click()
    return 'clicked'
  })()`)
  await sleep(1500)
  results.afterCreate = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      hasNewTask: text.includes('新任务'),
      nameInput: (document.querySelector('input[value="新任务"]') !== null),
    }
  })()`)

  // Fill the new task: name + prompt, then Apply.
  results.fillForm = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input')]
    const nameInput = inputs.find(i => i.value === '新任务')
    if (!nameInput) return 'no name input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(nameInput, 'UI测试任务')
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    const textareas = [...document.querySelectorAll('textarea')]
    if (textareas.length === 0) return 'no textarea'
    const tsetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    tsetter.call(textareas[0], '请回复：UI 测试通过')
    textareas[0].dispatchEvent(new Event('input', { bubbles: true }))
    return 'filled'
  })()`)
  await sleep(500)
  results.save = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const save = buttons.find(b => b.textContent.trim() === '保存')
    if (!save) return 'no save button'
    save.click()
    return 'clicked'
  })()`)
  await sleep(1500)
  results.afterApply = await evaluate(`(() => {
    const text = document.body.innerText
    return { hasUiTest: text.includes('UI测试任务') }
  })()`)

  // Close the dialog (OK).
  results.cancel = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const cancel = buttons.find(b => b.textContent.trim() === '取消')
    if (!cancel) return 'no cancel button'
    cancel.click()
    return 'clicked'
  })()`)
  await sleep(1000)

  // 3. Open the header picker and select the llm task.
  results.openPicker = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const picker = buttons.find(b => b.textContent.includes('选择任务') || b.textContent.includes('发布检查') || b.textContent.includes('UI测试任务'))
    if (!picker) return 'no picker'
    picker.click()
    return 'clicked'
  })()`)
  await sleep(1000)
  results.pickerMenu = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      hasGlobal: text.includes('全局'),
      hasWorkspace: text.includes('当前工作区'),
      hasUiTest: text.includes('UI测试任务'),
      hasEditConfig: text.includes('编辑配置'),
    }
  })()`)
  results.selectTask = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const row = buttons.find(b => b.textContent.includes('UI测试任务'))
    if (!row) return 'no task row'
    row.click()
    return 'clicked'
  })()`)
  await sleep(800)

  // 4. Click ▶ and check the composer draft.
  results.run = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const run = buttons.find(b => b.getAttribute('aria-label') === '运行')
    if (!run) return 'no run button'
    run.click()
    return 'clicked'
  })()`)
  await sleep(2000)
  results.draft = await evaluate(`(() => {
    const textarea = document.querySelector('textarea')
    return textarea ? textarea.value : 'no textarea'
  })()`)

  console.log('=== INTERACTIVE RESULTS ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('interactive test failed:', error)
  process.exit(1)
})
