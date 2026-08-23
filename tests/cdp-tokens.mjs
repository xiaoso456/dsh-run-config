/** Read live theme token values (dark mode) from the running app. */
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
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const ok = await evaluate(
      `[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '运行')`,
    )
    if (ok) {
      booted = true
      break
    }
  }
  console.log('booted:', booted)

  const tokens = await evaluate(`(() => {
    const names = [
      '--dsw-alias-state-error-secondary', '--dsw-alias-state-error-primary',
      '--dsw-alias-state-success-secondary', '--dsw-alias-state-success-primary',
      '--dsw-alias-state-warn-secondary', '--dsw-alias-state-warn-primary',
      '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l4',
      '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-dimmed',
      '--dsw-alias-fill-l1', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-base',
      '--dsw-alias-accent', '--dsw-alias-accent-soft',
      '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active',
      '--dsw-alias-button-primary-fill', '--dsw-alias-label-primary-foreground',
      '--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-tool-bar-hover',
      '--dsw-alias-interactive-bg-hover-danger',
    ]
    const probe = (el) => {
      const cs = getComputedStyle(el)
      const out = {}
      for (const n of names) {
        const v = cs.getPropertyValue(n).trim()
        if (v) out[n] = v
      }
      return out
    }
    return {
      root: probe(document.documentElement),
      body: probe(document.body),
      rootId: document.getElementById('root') ? probe(document.getElementById('root')) : null,
      rootAttrs: document.documentElement.getAttribute('data-theme') ?? document.documentElement.getAttribute('class') ?? '',
      styleTags: [...document.querySelectorAll('style')].filter(s => (s.textContent || '').includes('--dsw-alias')).length,
    }
  })()`)
  console.log(JSON.stringify(tokens, null, 1))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('tokens failed:', error)
  process.exit(1)
})
