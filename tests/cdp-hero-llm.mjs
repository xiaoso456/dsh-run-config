/**
 * Hero LLM-only verify:
 *  1. the hero task picker lists LLM tasks of the GLOBAL scope AND the
 *     CURRENT workspace (grouped), hiding command tasks and other
 *     workspaces' tasks;
 *  2. running an LLM task with an EMPTY prompt shows the failure toast
 *     instead of silently doing nothing.
 * Sequence: boot the hero page → create probe tasks via RPC (empty-prompt
 * global LLM, current-workspace LLM, foreign-workspace LLM, global command)
 * → open the picker and assert grouping/visibility → select the empty task
 * → click run → assert the "empty prompt" toast appears. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:3190'
const TASK_NAME = `空prompt验证-${Date.now().toString(36)}`
const CURRENT_WS_PATH = 'D:\\code\\pi-gateway-project\\dsh-plugin\\dsh-task-runner'
const FOREIGN_WS_PATH = 'D:\\__no_such_workspace__'

async function closeAllTabs() {
  try {
    const list = await fetch(`${CDP_HTTP}/json`).then((r) => r.json())
    for (const tab of list) {
      if (tab.type === 'page') await fetch(`${CDP_HTTP}/json/close/${tab.id}`).catch(() => {})
    }
  } catch {
    /* browser may not be reachable yet */
  }
}

async function rpc(method, payload) {
  const res = await fetch(`${BASE}/task-runner/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `hero-llm-${Date.now()}`,
      method,
      payload,
    }),
  })
  const body = await res.json()
  if (body.result?.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(body)}`)
  return body.result.value
}

async function main() {
  console.error('[hero-llm] opening CDP target...')
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
  const consoleLogs = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'log') {
      consoleLogs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
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
  if (!booted) process.exit(1)

  // Make sure we are on the hero (new-session) page.
  const onHero = await evaluate(
    `!!document.querySelector('[aria-label="选择工作区"]') && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Session log')`,
  )
  if (!onHero) {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        x => x.getAttribute('aria-label') === '新建会话',
      )
      if (b) b.click()
      return true
    })()`)
    await sleep(1500)
  }

  // Create probe tasks through the host RPC.
  const created = await rpc('tasks/create', {
    name: TASK_NAME,
    type: 'llm',
    scope: 'global',
    llmPrompt: '',
  })
  const taskId = created.task.id
  const wsTask = await rpc('tasks/create', {
    name: `当前工作区-${TASK_NAME}`,
    type: 'llm',
    scope: 'workspace',
    workspacePath: CURRENT_WS_PATH,
    llmPrompt: 'hello',
  })
  const foreignTask = await rpc('tasks/create', {
    name: `外部工作区-${TASK_NAME}`,
    type: 'llm',
    scope: 'workspace',
    workspacePath: FOREIGN_WS_PATH,
    llmPrompt: 'hello',
  })
  const cmdTask = await rpc('tasks/create', {
    name: `命令任务-${TASK_NAME}`,
    type: 'command',
    scope: 'global',
    command: 'echo x',
  })

  const results = { booted: true, taskName: TASK_NAME }

  // 1. Open the task picker and inspect grouping + visibility.
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const pick = run.parentElement.querySelector('[aria-expanded]')
    pick.click()
    return true
  })()`)
  await sleep(900)
  results.picker = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return null
    const text = menu.innerText
    const rows = [...menu.querySelectorAll('button[role="menuitem"]')]
    const taskRows = rows.filter(r => !r.textContent.includes('编辑任务配置'))
    return {
      hasWorkspaceGroup: text.includes('当前工作区'),
      hasGlobalGroup: text.includes('全局'),
      showsCurrentWsTask: text.includes('当前工作区-'),
      hidesForeignWsTask: !text.includes('外部工作区-'),
      hidesCommandTask: !text.includes('命令任务-'),
      taskRows: taskRows.length,
      texts: taskRows.map(r => r.textContent.trim().slice(0, 24)),
    }
  })()`)
  // Close the menu.
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

  const all = await rpc('tasks/list', {})
  const expected = all.tasks.filter(
    (t) =>
      t.type === 'llm' &&
      (t.scope === 'global' || (t.scope === 'workspace' && t.workspacePath === CURRENT_WS_PATH)),
  ).length
  results.expectedLlmVisible = expected
  results.rowsMatchLlmOnly = results.picker?.taskRows === expected

  // 2. Select the empty-prompt task and click run → failure toast.
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const pick = run.parentElement.querySelector('[aria-expanded]')
    pick.click()
    return true
  })()`)
  await sleep(700)
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const row = [...menu.querySelectorAll('button[role="menuitem"]')].find(
      r => r.textContent.trim() === '${TASK_NAME}',
    )
    if (row) row.click()
    return true
  })()`)
  await sleep(500)
  results.afterSelect = await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const pick = run?.parentElement?.querySelector('[aria-expanded]')
    return {
      pickText: pick ? pick.innerText : null,
      menuCount: document.querySelectorAll('[role="menu"]').length,
    }
  })()`)
  await sleep(500)
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    run.click()
    return true
  })()`)
  await sleep(1200)
  results.toast = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      showsEmptyPrompt: text.includes('empty prompt'),
      snippet: text.split('\\n').find(l => l.includes('empty prompt')) ?? '',
      bodyTail: text.slice(-200).replace(/\\n/g, '|'),
      runDisabled: (() => {
        const run = document.querySelector('[aria-label="运行"]')
        return run ? run.disabled : null
      })(),
      pickText: (() => {
        const run = document.querySelector('[aria-label="运行"]')
        const pick = run?.parentElement?.querySelector('[aria-expanded]')
        return pick ? pick.innerText : null
      })(),
    }
  })()`)

  // Cleanup: delete the probe tasks.
  await rpc('tasks/delete', { id: taskId })
  await rpc('tasks/delete', { id: wsTask.task.id })
  await rpc('tasks/delete', { id: foreignTask.task.id })
  await rpc('tasks/delete', { id: cmdTask.task.id })

  console.log('=== HERO LLM-ONLY ===')
  console.log(JSON.stringify(results, null, 2))
  console.log(`=== CONSOLE ERRORS (${consoleErrors.length}) ===`)
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))
  console.log(`=== CONSOLE LOGS (${consoleLogs.length}) ===`)
  for (const l of consoleLogs.slice(0, 10)) console.log(' -', l.slice(0, 200))

  ws.close()
  const pass =
    results.rowsMatchLlmOnly === true &&
    results.picker?.hasWorkspaceGroup === true &&
    results.picker?.hasGlobalGroup === true &&
    results.picker?.showsCurrentWsTask === true &&
    results.picker?.hidesForeignWsTask === true &&
    results.picker?.hidesCommandTask === true &&
    results.toast?.showsEmptyPrompt === true &&
    consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('hero-llm check failed:', error)
  process.exit(1)
})
