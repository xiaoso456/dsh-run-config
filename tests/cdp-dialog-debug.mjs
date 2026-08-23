/** Debug dialog edit: trace RPC + button state. */
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
  const rpcCalls = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Network.requestWillBeSent') {
      const url = msg.params.request.url
      if (url.includes('/task-runner/')) {
        rpcCalls.push({ url, postData: msg.params.request.postData })
      }
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
  await send('Network.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })
  await sleep(40000)

  // Open dialog, select UI测试任务, edit name.
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const gear = buttons.find(b => b.getAttribute('aria-label') === '运行')
    if (gear) gear.click()
  })()`)
  await sleep(1500)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const buttons = [...dialog.querySelectorAll('button')]
    const row = buttons.find(b => b.textContent.includes('UI测试任务'))
    if (row) row.click()
  })()`)
  await sleep(800)

  const before = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const buttons = [...dialog.querySelectorAll('button')]
    const apply = buttons.find(b => b.textContent.trim() === '保存')
    const nameInput = dialog.querySelector('input')  // first input in the form?
    return {
      applyDisabledBefore: apply ? apply.disabled : 'no apply',
      inputs: [...dialog.querySelectorAll('input')].map(i => i.value).slice(0, 3),
    }
  })()`)
  console.log('BEFORE:', JSON.stringify(before))

  const edit = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const input = dialog.querySelector('input[value="UI测试任务"]')
    if (!input) return 'no name input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'UI测试任务v2')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'edited'
  })()`)
  console.log('EDIT:', edit)
  await sleep(600)
  const after = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const buttons = [...dialog.querySelectorAll('button')]
    const apply = buttons.find(b => b.textContent.trim() === '保存')
    return {
      applyDisabledAfter: apply ? apply.disabled : null,
      nameInputValue: dialog.querySelector('input') ? dialog.querySelector('input').value : null,
    }
  })()`)
  console.log('AFTER:', JSON.stringify(after))

  console.log('=== RPC CALLS ===')
  for (const c of rpcCalls) console.log(c.url, '|', String(c.postData ?? '').slice(0, 200))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('debug failed:', error)
  process.exit(1)
})
