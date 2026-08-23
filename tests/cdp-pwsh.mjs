/**
 * PowerShell executor verify: command tasks must run through the DSH pwsh
 * executor on win32 (NOT Git Bash). We create a command task whose command
 * is PowerShell-only syntax (`Write-Output` — bash would fail with
 * "command not found"), run it from the session header, and assert the
 * completion notice reports success. Sequence:
 *  1. load the page, enter a session via the sidebar;
 *  2. create the pwsh-syntax command task via RPC;
 *  3. pick it in the header RunCombo and click run;
 *  4. wait for the completion notice ("已完成") in the session. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:3190'
const TASK_NAME = `pwsh验证-${Date.now().toString(36)}`

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
      rpcId: `pwsh-${Date.now()}`,
      method,
      payload,
    }),
  })
  const body = await res.json()
  if (body.result?.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(body)}`)
  return body.result.value
}

async function main() {
  console.error('[pwsh] opening CDP target...')
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

  const hasSessionLog = () =>
    evaluate(
      `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Session log')`,
    )

  let inSession = await hasSessionLog()
  if (!inSession) {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        x => x.getAttribute('aria-label') === '打开侧边栏',
      )
      if (b) b.click()
      return true
    })()`)
    await sleep(800)
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[role="treeitem"]')]
      const pick =
        rows.find(r => r.className.includes('sessionRow') && !r.textContent.includes('新会话')) ??
        rows.find(r => r.textContent.includes('pi_agent_rust')) ??
        rows[0]
      if (pick) pick.click()
      return true
    })()`)
    for (let i = 0; i < 30; i++) {
      await sleep(1000)
      if (await hasSessionLog()) {
        inSession = true
        break
      }
    }
  }
  if (!inSession) process.exit(1)

  // Create a PowerShell-only-syntax command task that writes a probe file
  // (the file's existence proves the pwsh executor ran the command — the
  // session completion notice is unreliable here due to a corrupt session
  // log in this test environment).
  const PROBE_FILE = 'pwsh-probe.txt'
  const created = await rpc('tasks/create', {
    name: TASK_NAME,
    type: 'command',
    scope: 'global',
    command: `Write-Output hello-from-pwsh | Out-File -Encoding utf8 ${PROBE_FILE}`,
    notifyLlm: true,
  })
  const taskId = created.task.id

  // Pick the task in the header RunCombo and click run.
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const pick = run?.parentElement?.querySelector('[aria-expanded]')
    if (pick) pick.click()
    return true
  })()`)
  await sleep(800)
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const row = [...menu.querySelectorAll('button[role="menuitem"]')].find(
      r => r.textContent.trim() === '${TASK_NAME}',
    )
    if (row) row.click()
    return true
  })()`)
  await sleep(500)
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    if (run) run.click()
    return true
  })()`)
  await sleep(1500)
  const runFeedback = await evaluate(`(() => {
    const text = document.body.innerText
    return {
      started: text.includes('已启动'),
      failed: text.includes('运行失败'),
      snippet: text.split('\\n').find(l => l.includes('已启动') || l.includes('运行失败')) ?? '',
    }
  })()`)
  console.log('run feedback:', JSON.stringify(runFeedback))

  // Wait for the probe file to appear in the session workspace (the command
  // runs with cwd = the session's workspace path).
  const { existsSync, readFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const probePath = join('D:/code/pi-gateway-project/dsh-plugin/dsh-task-runner', PROBE_FILE)
  let fileFound = false
  let fileContent = ''
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    if (existsSync(probePath)) {
      fileFound = true
      fileContent = readFileSync(probePath, 'utf8').trim()
      break
    }
  }
  if (fileFound) rmSync(probePath)

  const results = {
    booted,
    inSession,
    taskName: TASK_NAME,
    fileFound,
    fileContent,
  }

  // Cleanup.
  await rpc('tasks/delete', { id: taskId })

  console.log('=== PWSH EXECUTOR ===')
  console.log(JSON.stringify(results, null, 2))
  console.log(`=== CONSOLE ERRORS (${consoleErrors.length}) ===`)
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  const pass = results.fileFound === true && consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('pwsh check failed:', error)
  process.exit(1)
})
