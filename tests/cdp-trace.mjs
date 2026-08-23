/** Trace the /task-runner RPC calls from the browser. */
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
  const requests = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Network.requestWillBeSent') {
      const url = msg.params.request.url
      if (url.includes('task-runner') || url.includes('/api/')) {
        requests.push({ phase: 'sent', url, postData: msg.params.request.postData })
      }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url
      if (url.includes('task-runner')) {
        requests.push({ phase: 'response', url, status: msg.params.response.status })
      }
    } else if (msg.method === 'Network.loadingFinished') {
      // no-op
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })
  await sleep(25000)

  console.log('=== RPC REQUESTS ===')
  for (const r of requests) {
    console.log(JSON.stringify(r).slice(0, 400))
  }
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('trace failed:', error)
  process.exit(1)
})
