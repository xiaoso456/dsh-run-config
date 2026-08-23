/** Compare workspace-session entry on the web profile (3080). */
const CDP_HTTP = 'http://127.0.0.1:9222'
const URL = process.argv[2] ?? 'http://127.0.0.1:3080/'

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
  await send('Page.navigate', { url: URL })

  // Wait for boot: look for any workspace chip (hero page has no task-runner
  // on 3080 if the plugin is not installed there; look for text).
  let booted = false
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const ok = await evaluate(
      `document.body.innerText.includes('探索未至之境') || document.body.innerText.includes('预览版') || document.body.innerText.includes('选择工作区')`,
    )
    if (ok) {
      booted = true
      break
    }
  }
  console.log(URL, 'booted:', booted)
  if (!booted) process.exit(1)

  // Dump the visible buttons near the top to find the workspace chip.
  const buttons = await evaluate(`(() => {
    const list = [...document.querySelectorAll('button')]
      .map(b => ({ text: b.textContent.trim().slice(0, 40), title: b.getAttribute('title') ?? null, aria: b.getAttribute('aria-label'), top: Math.round(b.getBoundingClientRect().top) }))
      .filter(b => b.text.length > 0 || b.title || b.aria)
      .slice(0, 25)
    return list
  })()`)
  console.log('buttons:', JSON.stringify(buttons, null, 1))

  // Click the workspace chip: the button whose text is a workspace title and
  // is not a menu row. Try text match against known workspace titles.
  const chipClicked = await evaluate(`(() => {
    const candidates = [...document.querySelectorAll('button')].filter(b => {
      const t = b.textContent.trim()
      return t.length > 0 && t.length < 50 && !t.includes('运行') && !t.includes('配置') && !t.includes('设置')
    })
    const chip = candidates.find(b => /dsh-task-runner|pi-gateway-project/.test(b.textContent)) ?? candidates[0]
    chip.click()
    return chip.textContent.trim().slice(0, 50)
  })()`)
  console.log('chip clicked:', chipClicked)
  await sleep(800)

  const menuState = await evaluate(`(() => ({
    menus: [...document.querySelectorAll('[role="menu"]')].map(m => ({
      items: m.querySelectorAll('[role="menuitem"]').length,
      first: m.querySelector('[role="menuitem"]')?.textContent.trim().slice(0, 40) ?? null,
    })),
  }))()`)
  console.log('menu state:', JSON.stringify(menuState))

  // Click the first real menu item.
  const picked = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!menu) return 'no menu'
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    const pick = items.find(b => /dsh-task-runner/.test(b.textContent)) ?? items[0]
    if (!pick) return 'no items'
    pick.click()
    return pick.textContent.trim().slice(0, 50)
  })()`)
  console.log('picked:', picked)

  let entered = false
  for (let i = 0; i < 45; i++) {
    await sleep(1000)
    const state = await evaluate(`(() => {
      const tabs = document.querySelectorAll('[role="tab"]').length
      const text = document.body.innerText
      return { tabs, inSession: text.includes('Session log') || tabs > 0, head: text.slice(0, 60).replace(/\\n/g, '|') }
    })()`)
    if (state.inSession) {
      entered = true
      console.log('entered after', i + 1, 's')
      break
    }
    if (i === 10 || i === 30) console.log('still waiting at', i + 1, 's:', state.head)
  }
  console.log('entered:', entered)
  console.log('console errors:', consoleErrors.length)
  for (const e of consoleErrors.slice(0, 8)) console.log(' -', e.slice(0, 250))

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('compare failed:', error)
  process.exit(1)
})
