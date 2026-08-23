/**
 * Skill verify: the `run-configuration` skill must appear in the session's
 * skill catalog (context injection) after the plugin boots. Sequence:
 *  1. load the page; enter a session through the sidebar session list;
 *  2. assert the page text contains the skill name and its catalog summary. */
const CDP_HTTP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:3190'

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

  const results = { booted, inSession }
  if (inSession) {
    // The skill catalog is injected into the session context; the UI renders
    // it in the context-injection panel. Search the whole page text.
    results.catalog = await evaluate(`(() => {
      const text = document.body.innerText
      return {
        hasSkillName: text.includes('run-configuration'),
        hasSummary: text.includes('How to use dsh-task-runner run configurations'),
        snippet: text.split('\\n').find(l => l.includes('run-configuration')) ?? '',
      }
    })()`)
  }

  console.log('=== SKILL CATALOG ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  const pass =
    results.inSession === true &&
    results.catalog?.hasSkillName === true &&
    results.catalog?.hasSummary === true &&
    consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('skill check failed:', error)
  process.exit(1)
})
