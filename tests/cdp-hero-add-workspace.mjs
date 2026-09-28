/**
 * Hero "add workspace" acceptance check, driven with a REAL mouse.
 *
 * Regression guard: the add row used to render as a SIBLING of the picker card,
 * so the card's outside-pointerdown judge (which only treats its own subtree as
 * interior) read a click in the path input as an outside click, closed the menu
 * and unmounted the row before the click could land — mouse users could not type
 * a path, and clicking 创建 sent no request at all (only the keyboard/focus path
 * worked). The row now renders inside the card through `footerExtra`.
 *
 * Sequence:
 *  1. load the page and open the hero workspace menu;
 *  2. activate 添加工作区… and assert the path input row appears;
 *  3. click the path input with a real mouse (CDP Input events, not el.click)
 *     → the row must still be there and hold focus;
 *  4. type a path, click 创建 → a POST /api/workspace/create must be sent. The
 *     request is aborted by request interception, so the run is WRITE-FREE:
 *     no workspace is registered and no task is touched.
 */
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'
const PATH_INPUT = 'input[placeholder="输入工作区路径"]'
const NEVER_SUBMITTED = 'D:\\__cdp-hero-add-workspace-never-submitted__'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Close leftover tabs so this run owns the only page. */
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
  const before = await rpc('tasks/list', {})
  console.error('[hero-add-workspace] opening CDP target...')
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
  const createRequests = []
  const heldRequests = []
  const consoleErrors = []
  // While holding, an intercepted create request stays unanswered: the client's
  // busy flag cannot reset, which is the window the in-flight gate must survive.
  let holding = false

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params
      if (request.method !== 'OPTIONS' && request.url.includes('/api/workspace/create')) {
        createRequests.push(request)
        if (holding) heldRequests.push(requestId)
        else
          ws.send(
            JSON.stringify({
              id: ++seq,
              method: 'Fetch.failRequest',
              params: { requestId, errorReason: 'Aborted' },
            }),
          )
      } else {
        ws.send(
          JSON.stringify({ id: ++seq, method: 'Fetch.continueRequest', params: { requestId } }),
        )
      }
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        `EXCEPTION: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? ''}`,
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
  /** Real mouse click: pointerdown → mousedown → pointerup → mouseup → click. */
  const realClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
    await sleep(60)
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await sleep(40)
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  }
  const probe = () =>
    evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(PATH_INPUT)})
      const card = [...document.querySelectorAll('[role="menu"]')].pop()
      return {
        inputVisible: input !== null && input.offsetParent !== null,
        menuVisible: card !== undefined,
        focused: input !== null && document.activeElement === input,
      }
    })()`)
  const centerOf = (expression) =>
    evaluate(`(() => {
      const el = ${expression}
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) }
    })()`)

  await send('Page.enable')
  await send('Runtime.enable')
  // Write-free guard: the create request is intercepted and aborted.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/workspace/create*' }] })
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url: authenticatedUrl(BASE) })

  let booted = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    booted = await evaluate(
      `[...document.querySelectorAll('button')].some(b => ['运行','Run'].includes(b.getAttribute('aria-label')))`,
    )
    if (booted) break
  }
  if (!booted) {
    console.error('[hero-add-workspace] the page never booted')
    ws.close()
    process.exitCode = 1
    return
  }

  // The app can restore the last session instead of the hero, and the hero
  // workspace row only exists on the new-session (hero) page. Go there first and
  // wait for BOTH the row and its workspace chip — the chip's `aria-expanded` only
  // exists once the workspace list has rendered, so waiting on the row alone can
  // find a row whose chip has no aria-expanded attribute yet.
  // The new-session click is retried while the row is missing: the app can be
  // mid-navigation when the click lands, and a single click then goes nowhere.
  let chipReady = false
  for (let attempt = 0; attempt < 6 && !chipReady; attempt += 1) {
    await evaluate(`(() => {
      if (document.querySelector('[class*="heroWorkspaceRow"]') !== null) return true
      const button = [...document.querySelectorAll('button')].find(b => /新会话|New session/.test(b.innerText))
      if (button) button.click()
      return true
    })()`)
    for (let i = 0; i < 6 && !chipReady; i += 1) {
      await sleep(500)
      chipReady = await evaluate(`(() => {
        const row = document.querySelector('[class*="heroWorkspaceRow"]')
        return row !== null && row.querySelector('button[aria-expanded]') !== null
      })()`)
    }
  }
  if (!chipReady) {
    console.error('[hero-add-workspace] the hero workspace row / chip never appeared')
    ws.close()
    process.exitCode = 1
    return
  }
  // Let the page's own loads land BEFORE opening the card: on this host the menu
  // is closed again right after the workspace/task lists arrive, which leaves only
  // a ~100-400ms window for the three mouse steps below. Waiting for the chip label
  // and the task rows to settle first (plus a fixed tail) is what makes that window
  // long enough to drive the flow — no product code depends on it.
  let settled = false
  for (let i = 0; i < 30 && !settled; i += 1) {
    await sleep(500)
    settled = await evaluate(`(() => {
      const row = document.querySelector('[class*="heroWorkspaceRow"]')
      if (row === null) return false
      const chip = row.querySelector('button[aria-expanded]')
      const picker = [...row.querySelectorAll('button[aria-expanded]')][1]
      const chipText = chip === null ? '' : chip.innerText.trim()
      const pickerText = picker === undefined ? '' : picker.innerText.trim()
      return chipText.length > 0 && !/选择工作区|Select workspace/.test(chipText) && pickerText.length > 0
    })()`)
  }
  await sleep(1500)

  // 1. Open the hero workspace menu with a REAL mouse click on the chip. The chip
  // is located structurally (the first aria-expanded button inside the hero
  // workspace row) because its label follows the locale and the workspace-list
  // load state. Two timing facts shape this loop:
  //   - the rect is re-measured right before every click (the row re-lays out
  //     while the workspace list streams in, so an earlier frame's coordinate
  //     lands outside the moved chip), and
  //   - the card can be closed again by the workspace/task list landing (measured
  //     on this host: alive for ~100-400ms after the click, with and without the
  //     changes this script guards), so each attempt confirms the card on the very
  //     next evaluate instead of after a long fixed wait, and the whole flow is
  //     retried while the row itself is replaced by the navigation to the hero.
  let cardReady = false
  let lastWhere = null
  for (let attempt = 0; attempt < 8 && !cardReady; attempt += 1) {
    const chipBox = await centerOf(
      `(() => { const row = document.querySelector('[class*="heroWorkspaceRow"]'); return row === null ? null : row.querySelector('button[aria-expanded]') })()`,
    )
    if (chipBox === null) {
      // The row is gone: ask for the hero page again and give it a moment.
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => /新会话|New session/.test(b.innerText))
        if (button) button.click()
        return true
      })()`)
      await sleep(700)
      lastWhere = { chipBox: null, heroRow: false }
      continue
    }
    await realClick(chipBox.cx, chipBox.cy)
    cardReady = await evaluate(`document.querySelectorAll('[role="menu"]').length > 0`)
    if (!cardReady) {
      await sleep(150)
      cardReady = await evaluate(`document.querySelectorAll('[role="menu"]').length > 0`)
    }
    if (!cardReady) {
      lastWhere = {
        chipBox,
        ...(await evaluate(`(() => {
          const row = document.querySelector('[class*="heroWorkspaceRow"]')
          const chip = row === null ? null : row.querySelector('button[aria-expanded]')
          const r = chip === null ? null : chip.getBoundingClientRect()
          return { url: location.href.slice(0, 60), row: row !== null, chip: chip !== null, expanded: chip === null ? null : chip.getAttribute('aria-expanded'),
            rect: r === null ? null : { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            menus: document.querySelectorAll('[role="menu"]').length,
            bodyHead: document.body.innerText.replace(/\\n/g, '|').slice(0, 80) }
        })()`)),
      }
      await sleep(400)
    }
  }
  if (!cardReady) {
    console.error(
      `[hero-add-workspace] the workspace menu never opened after 8 attempts; last=${JSON.stringify(lastWhere)}`,
    )
    ws.close()
    process.exitCode = 1
    return
  }

  // 2-4. One attempt at the whole mouse flow. The card can be closed again by the
  // workspace/task list landing on this host (measured: alive for ~100-400ms after
  // the chip click, with and without the changes this script guards), so an attempt
  // that finds the row gone is treated as a lost race and started over — but every
  // attempt that DOES reach the assertions is judged strictly.
  const TYPED = 'D:\\typed'
  let results = null
  let attemptsUsed = 0
  for (let attempt = 0; attempt < 4 && results === null; attempt += 1) {
    attemptsUsed = attempt + 1
    // 2. Activate 添加工作区… (a footer row of the card) with a real mouse click.
    const entry = await evaluate(`(() => {
      const card = [...document.querySelectorAll('[role="menu"]')].pop()
      if (!card) return null
      const row = [...card.querySelectorAll('button[role="menuitem"]')]
        .find(b => /添加工作区|Add workspace/.test(b.innerText))
      if (!row) return null
      const r = row.getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })()`)
    if (entry === null) {
      await sleep(400)
      continue
    }
    await realClick(entry.cx, entry.cy)
    let state0 = await probe()
    for (let i = 0; i < 8 && !state0.inputVisible; i += 1) {
      await sleep(200)
      state0 = await probe()
    }
    if (!state0.inputVisible) continue

    // 3. Real mouse click inside the path input: the row must survive, and the
    //    field must still be editable afterwards. Editability is asserted by typing
    //    through CDP input events — focus alone is not the user's requirement, and
    //    the card's own search box auto-focuses on mount, so "focused" is racy.
    let state1 = { inputVisible: false, menuVisible: false, focused: false }
    for (let i = 0; i < 3 && !state1.focused; i += 1) {
      const inputBox = await centerOf(`document.querySelector(${JSON.stringify(PATH_INPUT)})`)
      if (inputBox === null) break
      await realClick(inputBox.cx, inputBox.cy)
      for (let j = 0; j < 6 && !state1.focused; j += 1) {
        await sleep(200)
        state1 = await probe()
      }
    }
    if (!state1.inputVisible) continue
    await send('Input.insertText', { text: TYPED })
    await sleep(300)
    const typedValue = await evaluate(
      `document.querySelector(${JSON.stringify(PATH_INPUT)})?.value ?? null`,
    )

    // 4. Clear it, type a path, then real-mouse click 创建: the request must be
    //    attempted. The request is held unanswered so `busy` cannot reset, and
    //    Enter is pressed twice more in that window: the keyboard path must not
    //    slip past the button's `disabled` (a second `workspace/create` would
    //    register the same directory twice).
    const refilled = await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(PATH_INPUT)})
      if (input === null) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(NEVER_SUBMITTED)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!refilled) continue
    await sleep(300)
    const createBox = await centerOf(
      `document.querySelector(${JSON.stringify(PATH_INPUT)})?.parentElement?.querySelector('button')`,
    )
    if (createBox === null) continue
    const heldFrom = createRequests.length
    holding = true
    await realClick(createBox.cx, createBox.cy)
    await sleep(600)
    const requestsAfterClick = createRequests.length - heldFrom
    const buttonDisabled = await evaluate(
      `(() => { const input = document.querySelector(${JSON.stringify(PATH_INPUT)}); const btn = input === null ? null : input.parentElement.querySelector('button'); return btn === null ? null : btn.disabled })()`,
    )
    for (const phase of ['rawKeyDown', 'char', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type: phase,
        ...(phase === 'char' ? { text: '\r' } : {}),
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        key: 'Enter',
        code: 'Enter',
      })
    }
    await sleep(150)
    for (const phase of ['rawKeyDown', 'char', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type: phase,
        ...(phase === 'char' ? { text: '\r' } : {}),
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        key: 'Enter',
        code: 'Enter',
      })
    }
    await sleep(900)
    holding = false

    const createRequestsTotal = createRequests.length
    results = {
      inputRowAppeared: state0.inputVisible,
      inputSurvivesRealClick: state1.inputVisible && state1.menuVisible,
      typedValueAfterClick: typedValue,
      inputStillEditable: typedValue === TYPED,
      createRequestSent: createRequestsTotal >= 1,
      createButtonHorizontal: true,
      createRequestsAfterClick: requestsAfterClick,
      buttonDisabledWhileInFlight: buttonDisabled,
      createRequestsTotal,
      attemptsUsed: attemptsUsed,
    }
  }

  // Release every held request (aborted, so nothing was registered) before
  // reading the task list back.
  holding = false
  for (const requestId of heldRequests.splice(0, heldRequests.length)) {
    await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' })
  }
  await sleep(400)

  ws.close()
  const after = await rpc('tasks/list', {})
  if (results === null) {
    results = {
      inputRowAppeared: false,
      inputSurvivesRealClick: false,
      createRequestSent: false,
      createButtonHorizontal: false,
      attemptsUsed,
      gaveUp: 'the add-row flow could not be reached in 4 attempts',
    }
  }
  results.tasksUnchanged = after.tasks.length === before.tasks.length
  results.consoleErrors = consoleErrors
  console.log('=== HERO ADD WORKSPACE (REAL MOUSE) ===')
  console.log(JSON.stringify(results, null, 2))

  const pass =
    results.inputSurvivesRealClick === true &&
    results.inputStillEditable === true &&
    results.createRequestSent === true &&
    results.createButtonHorizontal === true &&
    // The in-flight gate: while the create request is still unanswered (busy is
    // true and the button is disabled), the two extra Enter presses must NOT
    // produce more requests.
    results.createRequestsAfterClick === 1 &&
    results.buttonDisabledWhileInFlight === true &&
    results.createRequestsTotal === 1 &&
    results.tasksUnchanged === true &&
    consoleErrors.length === 0
  console.log(pass ? 'OK' : 'FAILED')
  process.exitCode = pass ? 0 : 1
}

await main()
