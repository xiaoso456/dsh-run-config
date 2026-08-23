/** D21 verify: host-side task mutations (LLM tool path) become visible when
 *  the picker/dialog is (re)opened — the open action bumps the store
 *  revision so useTaskLoader re-pulls. Sequence:
 *   1. load the page, wait for the hero run control to boot;
 *   2. create a task through the host RPC (simulating the LLM tool writing
 *      to the store while the page sits open);
 *   3. click the hero trigger (opens the run-config dialog, which bumps);
 *   4. assert the dialog lists the freshly created task. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:3190'
const TASK_NAME = `刷新验证-${Date.now().toString(36)}`

async function createTaskViaRpc() {
  const res = await fetch(`${BASE}/task-runner/tasks/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'refresh-verify',
      method: 'tasks/create',
      payload: {
        name: TASK_NAME,
        type: 'command',
        scope: 'global',
        command: 'echo refresh-ok',
        notifyLlm: true,
      },
    }),
  })
  const body = await res.json()
  const result = body.result
  if (result?.ok !== true) throw new Error(`create failed: ${JSON.stringify(body)}`)
  return result.value.task.id
}

async function closeAllTabs() {
  try {
    const list = await fetch(`${CDP_HTTP}/json`).then((r) => r.json())
    for (const tab of list) {
      if (tab.type === 'page') await fetch(`${CDP_HTTP}/json/close/${tab.id}`).catch(() => {})
    }
  } catch {
    /* the browser may not be reachable yet */
  }
}

async function main() {
  console.error('[refresh] opening CDP target...')
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

  // Page loaded its task list BEFORE the mutation; open the dialog once so
  // the store caches the pre-mutation list, then mutate on the host side.
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const trig = [...document.querySelectorAll('button')].find(b => {
      if (b === run || !b.querySelector('svg')) return false
      const r = b.getBoundingClientRect()
      const rr = run.getBoundingClientRect()
      return Math.abs(r.top - rr.top) < 40 && r.left > rr.left
    })
    if (trig) trig.click()
    return true
  })()`)
  await sleep(900)
  results.dialogOpenedBefore = await evaluate(
    `document.querySelectorAll('[role="dialog"]').length > 0`,
  )
  await evaluate(`(() => {
    const close = [...document.querySelectorAll('[role="dialog"] button')].find(
      b => b.getAttribute('aria-label') === '关闭' || b.title === '关闭',
    )
    if (close) close.click()
    return true
  })()`)
  await sleep(400)

  // Host-side mutation (the LLM tool would do the same through the store).
  const taskId = await createTaskViaRpc()
  results.taskName = TASK_NAME

  // Reopen the picker/dialog — the open action must re-pull and show it.
  const clickResult = await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const trig = [...document.querySelectorAll('button')].find(b => {
      if (b === run || !b.querySelector('svg')) return false
      const r = b.getBoundingClientRect()
      const rr = run.getBoundingClientRect()
      return Math.abs(r.top - rr.top) < 40 && r.left > rr.left
    })
    if (!trig) return { found: false }
    trig.click()
    return { found: true }
  })()`)
  results.reopenClick = clickResult
  await sleep(1200)
  results.dialogCountAfter = await evaluate(`document.querySelectorAll('[role="dialog"]').length`)
  results.bodyTextHead = String(
    (await evaluate(`document.body ? document.body.innerText : ''`)) ?? '',
  ).slice(0, 300)
  const bodyText = String((await evaluate(`document.body ? document.body.innerText : ''`)) ?? '')
  // The host Modal shell has role=dialog but renders its content in nested
  // nodes, so assert against the page body text (contains the dialog list).
  results.dialogShowsNewTask = bodyText.includes(TASK_NAME)

  console.log('=== V21 REFRESH-ON-OPEN ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  // Cleanup: delete the probe task through the RPC.
  await fetch(`${BASE}/task-runner/tasks/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'refresh-2',
      method: 'tasks/delete',
      payload: { id: taskId },
    }),
  })

  ws.close()
  process.exit(results.dialogShowsNewTask === true ? 0 : 1)
}

main().catch((error) => {
  console.error('refresh check failed:', error)
  process.exit(1)
})
