/** Verify the dialog's workspace picker (scope=workspace) is searchable. */
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
    return res.result?.result?.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3190/' })

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

  // Open dialog, select first task, switch scope to workspace.
  await evaluate(`(() => {
    const gear = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '运行')
    gear.click()
    return true
  })()`)
  await sleep(1500)
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const rows = [...dialog.querySelectorAll('button')].filter(b => b.getAttribute('draggable') === 'true')
    if (rows.length > 0) rows[0].click()
    return true
  })()`)
  await sleep(600)
  // Click the "工作区" scope segment (the second radio in the scope group).
  results.scopeSwitch = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const groups = [...dialog.querySelectorAll('[role="radiogroup"]')]
    const scopeGroup = groups[1]
    const ws = scopeGroup ? [...scopeGroup.querySelectorAll('[role="radio"]')].find(b => b.textContent.includes('工作区')) : null
    if (!ws) return 'no scope segment'
    ws.click()
    return 'clicked'
  })()`)
  await sleep(500)
  // The workspace picker trigger should now be visible.
  results.trigger = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const trigger = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null)
    return {
      hasTrigger: trigger !== null,
      triggerText: trigger?.textContent.trim().slice(0, 40) ?? null,
      nativeSelect: dialog.querySelector('select') !== null,
    }
  })()`)
  // Open it.
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const trigger = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null)
    if (trigger) trigger.click()
    return true
  })()`)
  await sleep(600)
  results.menu = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return { noMenu: true }
    const search = menu.querySelector('input')
    const rows = [...menu.querySelectorAll('[role="menuitem"]')]
    return { hasSearch: search !== null, placeholder: search?.placeholder ?? null, rowCount: rows.length, first: rows[0]?.textContent.trim().slice(0, 50) ?? null }
  })()`)
  // Filter.
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const search = menu.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(search, 'task-runner')
    search.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(400)
  results.filtered = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const rows = [...menu.querySelectorAll('[role="menuitem"]')]
    return rows.map(b => b.textContent.trim().slice(0, 60))
  })()`)
  // Pick the filtered row.
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    const rows = [...menu.querySelectorAll('[role="menuitem"]')]
    if (rows.length > 0) rows[0].click()
    return true
  })()`)
  await sleep(600)
  results.selected = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop()
    const trigger = [...dialog.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null)
    return trigger?.textContent.trim().slice(0, 60) ?? null
  })()`)

  console.log('=== V5 DIALOG WORKSPACE PICKER ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
  for (const e of consoleErrors.slice(0, 10)) console.log(' -', e.slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('v5 failed:', error)
  process.exit(1)
})
