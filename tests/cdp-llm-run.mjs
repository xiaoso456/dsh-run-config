/**
 * New-session LLM run acceptance: a brand-new session renders NO session
 * header, so the hero composite must execute the standard send flow itself
 * through the session-addressed conversation input facade. This script pins
 * both branches of the `autoSend` switch end to end:
 *
 *   send (autoSend true)  → the prompt reaches the transcript (a turn starts)
 *                           and the composer is cleared by the submission;
 *   fill (autoSend false) → the prompt only lands in the composer, and no
 *                           message reaches the transcript.
 *
 * A model reply is NOT required: the assertion is about delivery, and an
 * exhausted provider quota must not fail the plugin check (the transcript then
 * shows the failure notice instead of an answer).
 *
 * Sequence: create a global LLM task through the host RPC → boot the page →
 * click the sidebar's 新会话 row → pick the task in the hero run control →
 * click run → assert the composer/transcript state.
 *
 * usage: DSH_WEB_TOKEN=... node tests/cdp-llm-run.mjs [send|fill]
 *
 * Endpoint injection: `DSH_BASE` selects the instance to drive (default
 * http://127.0.0.1:3190, the same variable `tests/lib/web-session.mjs` reads),
 * so the external-dependency lane can point this script at an instance whose
 * provider route is a local mock. Provider choice is NOT a parameter here: the
 * assertions stay exactly as they are and must hold under whichever endpoint
 * answers.
 */
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'
const MODE = process.argv[2] === 'fill' ? 'fill' : 'send'
// A per-run marker keeps a previous run's transcript from satisfying the
// assertions (the same prompt text would otherwise match across runs).
const MARK = `rc${Date.now().toString(36)}`
const TASK_NAME = `LLM运行验收-${MARK}`
const PROMPT = `请只回复：${MARK}`

async function closeAllTabs() {
  try {
    const list = await fetch(`${CDP_HTTP}/json`).then((r) => r.json())
    for (const tab of list) {
      if (tab.type === 'page') await fetch(`${CDP_HTTP}/json/close/${tab.id}`).catch(() => {})
    }
  } catch {
    /* the browser may not be reachable */
  }
}

async function main() {
  const created = await rpc('tasks/create', {
    name: TASK_NAME,
    type: 'llm',
    scope: 'global',
    llmPrompt: PROMPT,
    autoSend: MODE === 'send',
  })
  const taskId = created.task.id
  if (created.task.autoSend !== (MODE === 'send')) {
    throw new Error(`autoSend did not survive tasks/create: ${String(created.task.autoSend)}`)
  }

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

  const results = {
    newSession: false,
    taskPicked: false,
    runClicked: false,
    draft: null,
    turnStarted: false,
  }

  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    if (await evaluate(`document.body.innerText.includes('新会话')`)) break
  }
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && el.textContent.trim() === '新会话',
    )
    if (row) (row.closest('button, [role="button"], [tabindex]') ?? row).click()
    return true
  })()`)
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    if (await evaluate(`document.querySelector('[aria-label="运行"]') !== null`)) {
      results.newSession = true
      break
    }
  }
  if (!results.newSession) throw new Error('never reached a session view with the run control')

  await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    run.parentElement.querySelector('[aria-expanded]').click()
    return true
  })()`)
  await sleep(1000)
  results.taskPicked = await evaluate(`(() => {
    const row = [...document.querySelectorAll('button[role="menuitem"]')].find((r) =>
      r.textContent.includes(${JSON.stringify(TASK_NAME)}),
    )
    if (row) row.click()
    return row !== undefined
  })()`)
  await sleep(1000)
  results.runClicked = await evaluate(`(() => {
    const run = document.querySelector('[aria-label="运行"]')
    if (!run) return false
    run.click()
    return true
  })()`)

  for (let i = 0; i < 16; i += 1) {
    await sleep(1500)
    const snap = await evaluate(`(() => {
      const comp = document.querySelector('textarea, [contenteditable="true"]')
      const body = document.body.innerText
      return {
        draft: comp ? String(comp.value ?? comp.textContent ?? '') : null,
        // The transcript renders the sent message as its own line; the hero
        // composer would carry it as the editable value instead.
        turn: body.includes('1 轮') || body.includes('1 step'),
      }
    })()`)
    results.draft = snap?.draft ?? null
    results.turnStarted = snap?.turn === true
    // send: the submission clears the composer; fill: the draft stays put.
    if (MODE === 'send' ? results.draft === '' && results.turnStarted : results.draft === PROMPT)
      break
  }

  console.log('=== LLM RUN (' + MODE + ') ===')
  console.log(JSON.stringify(results, null, 2))
  console.log(`=== CONSOLE ERRORS (${consoleErrors.length}) ===`)
  for (const e of consoleErrors.slice(0, 8)) console.log(' -', e.slice(0, 240))

  ws.close()
  await rpc('tasks/delete', { id: taskId }).catch(() => {})
  const pass =
    results.newSession &&
    results.taskPicked &&
    results.runClicked &&
    (MODE === 'send' ? results.draft === '' && results.turnStarted : results.draft === PROMPT) &&
    consoleErrors.length === 0
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('llm-run check failed:', error)
  process.exit(1)
})
