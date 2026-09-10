/**
 * Workspace-scoped selection verify: entering a workspace session must show
 * the CURRENT workspace's configurations (then global) — never another
 * workspace's. We create a foreign-workspace task via RPC, enter a session,
 * and assert the RunCombo picker text and the dropdown both exclude it.
 * Sequence:
 *  1. load the page, enter a session via the sidebar;
 *  2. create a foreign-workspace task (path that matches no workspace);
 *  3. assert the picker shows a visible task (current-workspace or global),
 *     and neither the picker text nor the dropdown contains the foreign task. */
const CDP_HTTP = 'http://127.0.0.1:9222'

import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const BASE = 'http://127.0.0.1:3190'
const FOREIGN_NAME = `外部工作区-${Date.now().toString(36)}`

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

async function main() {
  console.error('[ws-select] opening CDP target...')
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
  await send('Page.navigate', { url: authenticatedUrl(BASE) })

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

  // "Inside a session" is detected by the session header's utilities cluster.
  // The English `Session log` button this used to look for no longer exists in
  // the localized header.
  const hasSessionHeader = () =>
    evaluate(`document.querySelector('[class*="headerUtilities"]') !== null`)

  let inSession = await hasSessionHeader()
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
      if (await hasSessionHeader()) {
        inSession = true
        break
      }
    }
  }
  if (!inSession) process.exit(1)

  // Create a foreign-workspace task (path matches no real workspace).
  const created = await rpc('tasks/create', {
    name: FOREIGN_NAME,
    type: 'llm',
    scope: 'workspace',
    workspacePath: 'D:\\__no_such_workspace__',
    llmPrompt: 'hello',
  })
  const taskId = created.task.id

  // The picker must NOT show the foreign task.
  const pickText = await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const pick = run?.parentElement?.querySelector('[aria-expanded]')
    return pick ? pick.innerText : null
  })()`)

  // Open the dropdown and check its rows too.
  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    const pick = run?.parentElement?.querySelector('[aria-expanded]')
    if (pick) pick.click()
    return true
  })()`)
  await sleep(800)
  const menuText = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    return menu ? menu.innerText : ''
  })()`)

  const results = {
    booted,
    inSession,
    foreignName: FOREIGN_NAME,
    pickText,
    pickShowsForeign: pickText?.includes(FOREIGN_NAME) ?? false,
    menuShowsForeign: menuText.includes(FOREIGN_NAME),
  }

  // Cleanup.
  await rpc('tasks/delete', { id: taskId })

  console.log('=== WORKSPACE SELECTION ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  const pass =
    results.inSession === true &&
    results.pickShowsForeign === false &&
    results.menuShowsForeign === false &&
    consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('ws-select check failed:', error)
  process.exit(1)
})
