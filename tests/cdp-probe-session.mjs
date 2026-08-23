/** Probe: clicking a workspace in the hero menu must enter a session. */
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
      return 'EVAL_ERROR: ' + (res.result.exceptionDetails.exception?.description ?? '')
    }
    return res.result?.result?.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })

  let booted = false
  for (let i = 0; i < 45; i++) {
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
  if (!booted) process.exit(1)

  // Open the workspace menu (hero chip next to the run button).
  const opened = await evaluate(`(() => {
    const runBtn = document.querySelector('[aria-label="运行"]')
    if (!runBtn) return 'no run'
    const rr = runBtn.getBoundingClientRect()
    const chips = [...document.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect()
      return Math.abs(r.top - rr.top) < 40 && r.left < rr.left && b.textContent.trim().length > 0
    })
    if (chips.length === 0) return 'no chip'
    chips[0].click()
    return 'clicked ' + chips[0].textContent.trim().slice(0, 40)
  })()`)
  console.log('chip:', opened)
  await sleep(700)

  // List the menu items (text + id) so we can pick a real workspace.
  const items = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return null
    return [...menu.querySelectorAll('[role="menuitem"]')].map(b => ({
      text: b.textContent.trim().slice(0, 50),
      title: b.getAttribute('title') ?? null,
    }))
  })()`)
  console.log('menu items:', JSON.stringify(items, null, 1))

  // Click the item whose text exactly matches dsh-task-runner.
  const clicked = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return 'no menu'
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    const pick = items.find(b => b.textContent.trim() === 'dsh-task-runner') ?? items[0]
    pick.click()
    return pick.textContent.trim().slice(0, 60)
  })()`)
  console.log('picked:', clicked)
  await sleep(1000)
  console.log(
    'after click state:',
    await evaluate(`(() => ({
    heroText: document.body.innerText.includes('探索未至之境'),
    previewText: document.body.innerText.includes('预览版'),
    menuOpen: document.querySelectorAll('[role="menu"]').length,
    runTop: (() => { const b = document.querySelector('[aria-label="运行"]'); return b ? Math.round(b.getBoundingClientRect().top) : null })(),
    bodyHead: document.body.innerText.slice(0, 80).replace(/\\n/g, '|'),
  }))()`),
  )

  let entered = false
  for (let i = 0; i < 90; i++) {
    await sleep(1000)
    const state = await evaluate(`(() => {
      const runBtn = document.querySelector('[aria-label="运行"]')
      if (!runBtn) return { stage: 'no-run-btn' }
      const top = Math.round(runBtn.getBoundingClientRect().top)
      const tabs = document.querySelectorAll('[role="tab"]').length
      return { top, tabs, hasSessionLog: document.body.innerText.includes('Session log') }
    })()`)
    if (state.tabs > 0 || state.top < 120) {
      entered = true
      console.log('entered session after', i + 1, 's:', JSON.stringify(state))
      break
    }
    if (i === 10 || i === 30 || i === 60)
      console.log('still hero at', i + 1, 's:', JSON.stringify(state))
  }
  console.log('entered:', entered)
  console.log('console errors:', consoleErrors.length)
  for (const e of consoleErrors.slice(0, 8)) console.log(' -', e.slice(0, 250))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('probe failed:', error)
  process.exit(1)
})
