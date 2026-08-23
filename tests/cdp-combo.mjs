/**
 * RunCombo verify: the combined run control renders as ONE connected pill
 * with a picker segment (type icon + task name + chevron) and an icon-only
 * run segment; clicking the picker segment opens the task dropdown; hovering
 * the run segment shows the official Tooltip ("run task X in the current
 * workspace"). Sequence:
 *  1. load the page, wait for the run segment (aria-label="运行") to boot;
 *  2. assert the combo structure: picker segment (aria-expanded) sits in the
 *     same container as the run segment;
 *  3. click the picker segment → the task menu appears (role=menu, footer
 *     "编辑配置…");
 *  4. hover the run segment → the tooltip bubble appears with the run hint;
 *  5. close the menu; report console errors. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:3190'
const TASK_NAME = `combo-verify-${Date.now().toString(36)}`

/** Create a global command task through the host RPC proxy so the run
 *  control has a visible configuration regardless of the current
 *  workspace's task state. */
async function createTaskViaRpc() {
  const res = await fetch(`${BASE}/task-runner/tasks/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'combo-verify',
      method: 'tasks/create',
      payload: {
        name: TASK_NAME,
        type: 'command',
        scope: 'global',
        command: 'echo combo-ok',
        notifyLlm: true,
      },
    }),
  })
  const body = await res.json()
  const result = body.result
  if (result?.ok !== true) throw new Error(`create failed: ${JSON.stringify(body)}`)
  return result.value.task.id
}

async function deleteTaskViaRpc(id) {
  await fetch(`${BASE}/task-runner/tasks/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'combo-verify',
      method: 'tasks/delete',
      payload: { id },
    }),
  }).catch(() => {})
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
  console.error('[combo] opening CDP target...')
  const taskId = await createTaskViaRpc()
  await closeAllTabs()
  const target = await fetch(`${CDP_HTTP}/json/new?about:blank`, {
    method: 'PUT',
  }).then((r) => r.json())
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
      `[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '运行' || b.getAttribute('aria-label') === 'Run')`,
    )
    if (ok) {
      booted = true
      break
    }
  }
  results.booted = booted
  if (!booted) process.exit(1)

  // 1. Structure: the run segment and the picker segment share one container.
  results.structure = await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"], [aria-label="Run"]')
    if (!run) return { found: false }
    const combo = run.parentElement
    if (!combo) return { found: false }
    const pick = combo.querySelector('[aria-expanded]')
    if (!pick) return { found: false }
    const comboBox = combo.getBoundingClientRect()
    const runBox = run.getBoundingClientRect()
    const pickBox = pick.getBoundingClientRect()
    return {
      found: true,
      sameHeight: Math.abs(comboBox.height - 28) <= 2,
      runRightOfPick: runBox.left > pickBox.left,
      pickText: pick.innerText,
      runHasIconOnly: run.querySelectorAll('svg').length === 1 && run.innerText.trim() === '',
      borderShared: getComputedStyle(combo).borderRadius !== '0px',
    }
  })()`)

  // 2. Click the picker segment → task menu with the edit-config footer.
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"], [aria-label="Run"]')
    const pick = run.parentElement.querySelector('[aria-expanded]')
    pick.click()
    return true
  })()`)
  await sleep(900)
  results.menu = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return { found: false }
    const text = menu.innerText
    return {
      found: true,
      hasFooter: text.includes('编辑配置') || text.includes('Edit configurations'),
      rows: menu.querySelectorAll('button[role="menuitem"]').length,
    }
  })()`)

  // Close the menu (Escape).
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
  })
  await sleep(400)

  // 3. Hover the run segment → tooltip bubble with the run hint. The official
  // Tooltip listens to React onMouseEnter; the first CDP mouseMoved only parks
  // the pointer, so move to a neutral spot first, then onto the button center.
  const runRect = await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"], [aria-label="Run"]')
    const r = run.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
  await sleep(150)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: runRect.x, y: runRect.y })
  await sleep(700)
  results.tooltip = await evaluate(`(() => {
    const bubbles = [...document.querySelectorAll('span')].filter(
      (el) =>
        (el.textContent.includes('在当前工作区运行任务配置') ||
          el.textContent.includes('in the current workspace')) &&
        el.children.length === 0,
    )
    return { found: bubbles.length > 0, text: bubbles[0]?.textContent ?? '' }
  })()`)

  console.log('=== RUNCOMBO UI ===')
  console.log(JSON.stringify(results, null, 2))
  console.log(`=== CONSOLE ERRORS (${consoleErrors.length}) ===`)
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  await deleteTaskViaRpc(taskId)
  const pass =
    results.structure?.found === true &&
    results.structure?.sameHeight === true &&
    results.structure?.runRightOfPick === true &&
    results.structure?.runHasIconOnly === true &&
    results.menu?.found === true &&
    results.menu?.hasFooter === true &&
    results.tooltip?.found === true &&
    consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('combo check failed:', error)
  process.exit(1)
})
