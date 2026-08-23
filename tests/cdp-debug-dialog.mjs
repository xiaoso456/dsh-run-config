/** Debug the run-config dialog DOM state. */
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
  await sleep(20000)

  // Open the dialog.
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const gear = buttons.find(b => b.getAttribute('aria-label') === '运行')
    if (gear) gear.click()
  })()`)
  await sleep(1500)

  const state = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    if (!dialog) return { noDialog: true }
    const text = dialog.innerText
    const buttons = [...dialog.querySelectorAll('button')].map(b => b.textContent.trim())
    const inputs = [...dialog.querySelectorAll('input')].map(i => ({ type: i.type, value: i.value, placeholder: i.placeholder }))
    const selects = [...dialog.querySelectorAll('select')].map(s => s.value)
    const textareas = [...dialog.querySelectorAll('textarea')].map(t => t.value)
    return { text, buttons, inputs, selects, textareas }
  })()`)
  console.log(JSON.stringify(state, null, 2))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('debug failed:', error)
  process.exit(1)
})
