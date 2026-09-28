/**
 * The dialog's "saved" hint must get its own 2s window per save.
 *
 * Regression guard: the hint was driven by a boolean flag, and a save sets it to
 * `true` — a value it already had whenever the previous save's window was still
 * open. React then saw no state change, the timer effect did not re-run, and the
 * second save's hint expired on the FIRST save's clock (measured: ~1.1s left of
 * the first window). The check below saves twice ~0.9s apart and asserts the hint
 * is still up 1.4s after the second save.
 *
 * Self-cleaning: the probe configuration is deleted in `finally`.
 */
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'
const NAME = `cdp-saved-hint-${Date.now().toString(36)}`
const NAME_2 = `${NAME}-2`
const NAME_3 = `${NAME}-3`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const made = await rpc('tasks/create', {
    name: NAME,
    type: 'llm',
    scope: 'global',
    llmPrompt: 'noop',
    notifyLlm: false,
  })
  const id = made.task.id

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
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id2 = ++seq
      pending.set(id2, resolve)
      ws.send(JSON.stringify({ id: id2, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.result?.exceptionDetails !== undefined) {
      throw new Error(
        `evaluate failed: ${JSON.stringify(res.result.exceptionDetails).slice(0, 300)}`,
      )
    }
    return res.result?.result?.value
  }
  /** The footer "saved" hint (a `role="status"` span outside the search notice). */
  const savedShown = () =>
    evaluate(`document.querySelector('[role="dialog"] [class*="footerSaved"]') !== null`)
  /** Set the name field through the native setter so React sees the change. */
  const setName = (value) =>
    evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog === null) return { ok: false, reason: 'no dialog' }
      const label = [...dialog.querySelectorAll('label')]
        .find(l => /名称|Name/.test(l.textContent))
      if (label === undefined) return { ok: false, reason: 'no name label' }
      const input = label.querySelector('input')
      if (input === null) return { ok: false, reason: 'no name input' }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return { ok: true, value: input.value }
    })()`)
  const clickSave = () =>
    evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog === null) return { ok: false, reason: 'no dialog' }
      const btn = [...dialog.querySelectorAll('button')]
        .find(b => ['保存','Save'].includes(b.innerText.trim()))
      if (btn === undefined) return { ok: false, reason: 'no save button' }
      if (btn.disabled) return { ok: false, reason: 'save disabled' }
      btn.click()
      return { ok: true }
    })()`)
  const storedName = async () => {
    const { tasks } = await rpc('tasks/list', {})
    return tasks.find((task) => task.id === id)?.name
  }

  const facts = {}
  try {
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send('Page.navigate', { url: authenticatedUrl(BASE) })

    let booted = false
    for (let i = 0; i < 40; i += 1) {
      await sleep(500)
      booted = await evaluate(
        `[...document.querySelectorAll('button')].some(b => ['运行','Run'].includes(b.getAttribute('aria-label')))`,
      )
      if (booted) break
    }
    if (!booted) throw new Error('the page never booted')

    let pickerReady = false
    for (let attempt = 0; attempt < 6 && !pickerReady; attempt += 1) {
      await evaluate(`(() => {
        const row = document.querySelector('[class*="heroWorkspaceRow"]')
        if (row !== null) return true
        const button = [...document.querySelectorAll('button')].find(b => /新会话|New session/.test(b.innerText))
        if (button) button.click()
        return true
      })()`)
      for (let i = 0; i < 8 && !pickerReady; i += 1) {
        await sleep(500)
        pickerReady = await evaluate(`(() => {
          const row = document.querySelector('[class*="heroWorkspaceRow"]')
          if (row === null) return false
          const picker = [...row.querySelectorAll('button[aria-expanded]')][1]
          return picker !== undefined && picker.innerText.trim().length > 0
        })()`)
      }
    }
    if (!pickerReady) throw new Error('the hero task picker never appeared')
    await sleep(1500)

    await evaluate(`(() => {
      const row = document.querySelector('[class*="heroWorkspaceRow"]')
      row.querySelectorAll('button[aria-expanded]')[1].click()
      return true
    })()`)
    for (let i = 0; i < 16; i += 1) {
      await sleep(250)
      if (await evaluate(`document.querySelectorAll('[role="menu"]').length > 0`)) break
    }
    const opened = await evaluate(`(() => {
      const card = [...document.querySelectorAll('[role="menu"]')].pop()
      if (card === undefined) return { ok: false, reason: 'no card' }
      const entry = [...card.querySelectorAll('button[role="menuitem"]')]
        .find(b => /编辑任务配置|Edit configurations/.test(b.innerText))
      if (entry === undefined) return { ok: false, reason: 'no edit entry' }
      entry.click()
      return { ok: true }
    })()`)
    let dialogOpen = false
    for (let i = 0; i < 16; i += 1) {
      await sleep(300)
      dialogOpen = await evaluate(`document.querySelectorAll('[role="dialog"]').length > 0`)
      if (dialogOpen) break
    }
    if (!dialogOpen) throw new Error(`the dialog never opened: ${JSON.stringify(opened)}`)

    // Select the probe row: the draft follows the selection.
    const selected = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] button')]
      const row = rows.find(b => {
        const label = b.querySelector('[class*="rowName"]')
        return label !== null && label.textContent.trim() === ${JSON.stringify(NAME)}
      })
      if (row === undefined) return { ok: false, reason: 'no row' }
      row.click()
      return { ok: true }
    })()`)
    if (selected.ok !== true)
      throw new Error(`the probe row was not selectable: ${JSON.stringify(selected)}`)
    await sleep(300)

    // 1st save.
    facts.setName1 = await setName(NAME_2)
    await sleep(200)
    facts.save1 = await clickSave()
    let hintAfterFirst = false
    for (let i = 0; i < 20; i += 1) {
      await sleep(100)
      hintAfterFirst = await savedShown()
      if (hintAfterFirst) break
    }
    facts.hintAfterFirstSave = hintAfterFirst
    facts.storedAfterFirst = await storedName()

    // 0.9s later the first window still has ~1.1s left: that is the window the
    // second save used to inherit.
    await sleep(900)
    facts.setName2 = await setName(NAME_3)
    await sleep(200)
    facts.hintBeforeSecondSave = await savedShown()
    const clickedAt = Date.now()
    facts.save2 = await clickSave()
    for (let i = 0; i < 20; i += 1) {
      await sleep(100)
      if ((await storedName()) === NAME_3) break
    }
    facts.storedAfterSecond = await storedName()

    // Follow the hint from the click: it has to stay up for its own 2s window
    // (measured with the CDP round trip in the loop, hence the 1.8s bound).
    let shownAfterSecond = false
    let clearedAt = null
    for (let i = 0; i < 80; i += 1) {
      const shown = await savedShown()
      if (shown) shownAfterSecond = true
      else if (shownAfterSecond) {
        clearedAt = Date.now() - clickedAt
        break
      }
      await sleep(50)
    }
    facts.hintShownAfterSecondSave = shownAfterSecond
    facts.clearedAtMs = clearedAt
  } finally {
    const removed = await rpc('tasks/delete', { id }).catch((error) => ({ error: String(error) }))
    facts.deleted = removed?.deleted ?? removed?.error
    const after = await rpc('tasks/list', {})
    facts.countRestored = after.tasks.length === before.tasks.length
    ws.close()
  }

  facts.ok =
    facts.hintAfterFirstSave === true &&
    facts.hintBeforeSecondSave === true &&
    facts.storedAfterSecond === NAME_3 &&
    facts.hintShownAfterSecondSave === true &&
    facts.clearedAtMs !== null &&
    facts.clearedAtMs >= 1800
  console.log('=== CDP SAVED HINT ===')
  console.log(JSON.stringify(facts, null, 2))
  if (!facts.ok) {
    console.error(
      'FAILED: the "saved" hint of the second save must keep its own 2s window (>=1.8s measured) and still clear by itself (see facts above)',
    )
    process.exitCode = 1
    return
  }
  console.log('OK')
}

await main()
