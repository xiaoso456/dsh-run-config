/** Restore the UI test task name back to 发布检查/UI测试任务 baseline state. */
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
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
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
  let booted = false
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const cancel = await evaluate(
      `[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '运行')`,
    )
    if (cancel) {
      booted = true
      break
    }
  }
  console.log('booted:', booted)
  if (!booted) {
    process.exit(1)
  }

  // Open dialog, select the v2 row, rename back, save, close.
  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    gear.click()
    return true
  })()`)
  await sleep(1500)
  const clicked = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    const row = rows.find(b => b.textContent.includes('UI测试任务'))
    if (!row) return 'no row'
    row.click()
    return 'clicked'
  })()`)
  await sleep(600)
  const edited = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const input = dialog.querySelector('input[value="UI测试任务v2"]')
    if (!input) return 'no input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'UI测试任务')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'edited'
  })()`)
  console.log('row:', clicked, 'edit:', edited)
  await sleep(400)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const save = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')
    if (save) save.click()
    return true
  })()`)
  await sleep(1500)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const cancel = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')
    if (cancel) cancel.click()
    return true
  })()`)
  await sleep(800)
  console.log('done')
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('restore failed:', error)
  process.exit(1)
})
