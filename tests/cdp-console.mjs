/**
 * Capture console output + early page text (based on the working smoke test).
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
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })
  await new Promise((r) => setTimeout(r, 8000))
  const early = await evaluate('document.body ? document.body.innerText : ""')
  console.log('=== EARLY TEXT (8s) ===')
  console.log(String(early ?? '').slice(0, 1200))
  await new Promise((r) => setTimeout(r, 12000))
  console.log('=== CONSOLE LOGS ===')
  for (const l of logs.slice(0, 40)) console.log(l.slice(0, 300))
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('failed:', error)
  process.exit(1)
})
