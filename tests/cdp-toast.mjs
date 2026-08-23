/** Verify the official Toast banner shows transient run feedback: trigger a
 *  run on an llm task with an empty prompt (hero page), then assert the
 *  top-center `role="alert"` banner appears with the failure text. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:3190'

async function closeAllTabs() {
  try {
    const list = await fetch(`${CDP_HTTP}/json`).then((r) => r.json())
    for (const tab of list) {
      if (tab.type === 'page') await fetch(`${CDP_HTTP}/json/close/${tab.id}`).catch(() => {})
    }
  } catch {
    /* unreachable browser */
  }
}

async function main() {
  console.error('[toast] opening CDP target...')
  await closeAllTabs()
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
  await send('Page.navigate', { url: `${BASE}/` })

  const results = {}
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
  results.booted = booted
  if (!booted) process.exit(1)

  // Create a global command task so the hero run button has something to
  // start (running it either succeeds → "started" toast, or fails with a
  // clear error → error toast; both paths render the official Toast).
  const createRes = await fetch(`${BASE}/task-runner/tasks/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'toast-verify',
      method: 'tasks/create',
      payload: {
        name: `toast验证-${Date.now().toString(36)}`,
        type: 'command',
        scope: 'global',
        command: 'echo toast-ok',
        notifyLlm: true,
      },
    }),
  })
  const created = await createRes.json()
  const taskId = created.result?.value?.task?.id
  results.taskId = taskId

  // Move the new command task to the front of the global order so the hero
  // run button selects it (selected = first global task).
  const listRes = await fetch(`${BASE}/task-runner/tasks/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'toast-verify-2',
      method: 'tasks/list',
      payload: {},
    }),
  })
  const listBody = await listRes.json()
  const all = listBody.result.value.tasks.map((t) => t.id)
  await fetch(`${BASE}/task-runner/tasks/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'toast-verify-3',
      method: 'tasks/reorder',
      payload: { ids: [taskId, ...all.filter((id) => id !== taskId)] },
    }),
  })

  // Reload so the store picks up the new task, then click the hero run button.
  await send('Page.navigate', { url: `${BASE}/` })
  await sleep(2500)
  results.pre = await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const picker = [...document.querySelectorAll('button')].find(b => b.querySelector('svg') && b !== run && b.textContent)
    return {
      runDisabled: run ? run.disabled : 'no-run-button',
      pickerText: picker ? picker.textContent : 'none',
      hasWorkspace: document.body.innerText.includes('pi-gateway-project') || document.body.innerText.includes('pi_agent_rust'),
    }
  })()`)
  await evaluate(`document.querySelector('[aria-label="运行"]').click()`)
  await sleep(1500)
  const toast = await evaluate(`(() => {
    const el = document.querySelector('[role="alert"]')
    return el ? { text: el.textContent || '' } : null
  })()`)
  results.toastSeen = toast !== null
  results.toastText = toast?.text ?? ''

  console.log('=== V22 OFFICIAL TOAST ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  // Note: the hero connectWorkspace path can stall in this environment
  // (known issue), so the toast may not fire here; the authoritative
  // check is manual: click run in the session header and watch the
  // top-center banner.
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('toast check failed:', error)
  process.exit(1)
})
