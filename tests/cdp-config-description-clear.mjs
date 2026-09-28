/**
 * Config-dialog acceptance check: clearing the 描述 (description) field must
 * reach the Host.
 *
 * Regression guard for the contract between the dialog and `TaskStore.update`:
 * the Host reads `patch.description === undefined` as "keep the current value",
 * so the form must forward the empty string verbatim — folding `''` into
 * `undefined` made the field impossible to clear (the same reason `llmPrompt`
 * and `command` are forwarded as they are).
 *
 * Sequence: create a global task with a description over RPC → open the
 * run-config dialog from the hero picker → select that task → clear the
 * description → save → read the stored value back over RPC. The task this
 * script creates is deleted again in `finally`, so the run is self-cleaning.
 */
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'
const NAME = `cdp-desc-clear-${Date.now().toString(36)}`
const OLD_DESC = 'old description that must be clearable'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await fetch(`${CDP_HTTP}/json`).then((r) => r.json())
const target = list.find((t) => t.type === 'page')
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
  if (res.result?.exceptionDetails !== undefined) {
    console.error('[eval error]', JSON.stringify(res.result.exceptionDetails).slice(0, 200))
  }
  return res.result?.result?.value
}
/** Set a React-controlled input's value through the native setter. */
const setInput = (valueExpr) =>
  evaluate(`(() => {
    const label = [...document.querySelectorAll('[role="dialog"] label')]
      .find(l => l.textContent.includes('描述') || l.textContent.includes('Description'))
    if (!label) return { ok: false, reason: 'no description label' }
    const input = label.querySelector('input')
    if (!input) return { ok: false, reason: 'no input in description label' }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${valueExpr})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true, value: input.value }
  })()`)
const clickByText = (text) =>
  evaluate(`(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')]
      .find(b => b.innerText.trim() === ${JSON.stringify(text)})
    if (!btn) return { ok: false, candidates: [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 12) }
    if (btn.disabled) return { ok: false, reason: 'disabled' }
    btn.click()
    return { ok: true }
  })()`)

let created = null
try {
  created = await rpc('tasks/create', {
    name: NAME,
    description: OLD_DESC,
    type: 'llm',
    scope: 'global',
    llmPrompt: 'noop',
    notifyLlm: false,
  })
  console.log(
    `[0] 建测试任务 id=${created.task.id} description=${JSON.stringify(created.task.description)}`,
  )

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url: authenticatedUrl(BASE) })

  let ready = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    ready = await evaluate(
      `(() => { const row = document.querySelector('[class*="heroWorkspaceRow"]'); return !!(row && row.querySelector('button[aria-expanded]')) })()`,
    )
    if (ready) break
  }
  if (!ready) throw new Error('hero 未就绪')

  // hero 的任务配置 picker（行内第二个 aria-expanded 按钮）→ footer「编辑任务配置…」
  await evaluate(`(() => {
    const row = document.querySelector('[class*="heroWorkspaceRow"]')
    const chips = [...row.querySelectorAll('button[aria-expanded]')]
    chips[1].click()
    return true
  })()`)
  let menu = false
  for (let i = 0; i < 12; i += 1) {
    await sleep(250)
    menu = await evaluate(`document.querySelectorAll('[role="menu"]').length > 0`)
    if (menu) break
  }
  const openedDialog = await evaluate(`(() => {
    const card = [...document.querySelectorAll('[role="menu"]')].pop()
    if (!card) return { ok: false, reason: 'no card' }
    const entry = [...card.querySelectorAll('button[role="menuitem"]')].find(b => /编辑任务配置|Edit configurations/.test(b.innerText))
    if (!entry) return { ok: false, reason: 'no edit entry' }
    entry.click()
    return { ok: true }
  })()`)
  let dialog = false
  for (let i = 0; i < 16; i += 1) {
    await sleep(300)
    dialog = await evaluate(`document.querySelectorAll('[role="dialog"]').length > 0`)
    if (dialog) break
  }
  console.log(`[1] 打开对话框 = ${openedDialog.ok} / dialog=${dialog}`)
  if (!dialog) throw new Error('对话框未打开')

  // 在左栏里选中测试任务
  const selectedRow = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.includes(${JSON.stringify(NAME)}))
    if (!row) return { ok: false }
    row.click()
    return { ok: true, text: row.innerText.trim().slice(0, 40) }
  })()`)
  await sleep(600)
  console.log(`[2] 选中测试任务 = ${JSON.stringify(selectedRow)}`)

  const shown = await evaluate(`(() => {
    const label = [...document.querySelectorAll('[role="dialog"] label')].find(l => l.textContent.includes('描述') || l.textContent.includes('Description'))
    const input = label ? label.querySelector('input') : null
    return input === null || input === undefined ? null : input.value
  })()`)
  console.log(`[3] 表单里的描述 = ${JSON.stringify(shown)}`)

  // 清空描述并保存
  const cleared = await setInput(`''`)
  await sleep(400)
  const saved = await clickByText('保存')
  console.log(
    `[4] 清空 = ${JSON.stringify(cleared)}；点保存 = ${JSON.stringify(saved.ok === undefined ? saved : saved.ok)}`,
  )
  await sleep(1200)

  const afterAll = await rpc('tasks/list', {})
  const stored = afterAll.tasks.find((t) => t.id === created.task.id)
  console.log(`[5] 存储里的 description = ${JSON.stringify(stored?.description ?? null)}`)
  console.log(`=== 控制台错误（${consoleErrors.length}）===`)
  for (const e of consoleErrors.slice(0, 4)) console.log(` - ${e.slice(0, 160)}`)

  const pass =
    stored !== undefined && (stored.description === '' || stored.description === undefined)
  console.log(`=== 结果 === 描述已清空 = ${pass}`)
  console.log(pass ? 'OK' : 'FAILED')
  process.exitCode = pass && consoleErrors.length === 0 ? 0 : 1
} catch (error) {
  console.error('探针异常：', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (created !== null) {
    await rpc('tasks/delete', { id: created.task.id }).catch(() => {})
    console.log('[6] 已自清理测试任务')
  }
  ws.close()
}
