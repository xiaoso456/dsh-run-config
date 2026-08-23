/** Debug boot hang: capture console from the very start. */
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
  const logs = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(
        `[${msg.params.type}] ` +
          msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      )
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(
        '[EXCEPTION] ' +
          (msg.params.exceptionDetails?.exception?.description ??
            msg.params.exceptionDetails?.text ??
            ''),
      )
    } else if (msg.method === 'Log.entryAdded') {
      logs.push(`[LOG:${msg.params.entry.level}] ` + msg.params.entry.text)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true })
    return res.result?.result?.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })
  await new Promise((r) => setTimeout(r, 5000))
  const t5 = await evaluate('document.body ? document.body.innerText : ""')
  console.log('T5:', String(t5 ?? '').slice(0, 200))
  await new Promise((r) => setTimeout(r, 15000))
  const t20 = await evaluate('document.body ? document.body.innerText : ""')
  console.log('T20:', String(t20 ?? '').slice(0, 400))
  console.log('=== LOGS (' + logs.length + ') ===')
  for (const l of logs.slice(0, 30)) console.log(l.slice(0, 400))
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('debug failed:', error)
  process.exit(1)
})
