#!/usr/bin/env node

/**
 * Local mock LLM provider for the acceptance suite's *external dependency* lane.
 *
 * Why this file exists: `tests/cdp-llm-run.mjs` and `tests/cdp-pwsh.mjs` both
 * drive a real agent turn, and until now those turns were served by the live
 * DeepSeek endpoint configured in the developer's `~/.dsh`. An exhausted balance
 * therefore failed the acceptance run with `当前请求的额度已用尽` even though the
 * plugin under test was fine. This server answers the *exact* wire protocol the
 * loaded dsh provider speaks, so the same adapter, the same streaming parser,
 * the same tool loop and the same token accounting are exercised end to end —
 * only the socket at the end of the request changes.
 *
 * Protocol surface (dsh 0.1.7-rc.2):
 *   - `POST /v1/messages`            Anthropic Messages SSE — what
 *                                    `@deepseek-ai/dsh-llm-deepseek` (provider
 *                                    route `deepseek-official`) actually calls
 *                                    (`${baseURL}/v1/messages`, `accept:
 *                                    text/event-stream`).
 *   - `POST /v1/chat/completions`    OpenAI-compatible subset (JSON and SSE) so
 *                                    the same scripted fixtures can also serve
 *                                    `@deepseek-ai/dsh-llm-pi-ai` runs or plain
 *                                    OpenAI-shaped probes.
 *   - `GET  /v1/models`              catalog listing.
 *   - `GET  /__mock/status`          request counters + last request summaries.
 *   - `POST /__mock/reset`           clear counters (keeps the rule script).
 *   - `POST /__mock/shutdown`        graceful stop, for the orchestrator.
 *
 * Nothing here reaches the network: the server binds 127.0.0.1 only, makes no
 * outbound request, and imports from `node:` builtins alone (no npm dependency).
 *
 * Usage:
 *   node tests/external/mock-llm/server.mjs \
 *     --port 19399 --log logs/mock-llm-requests.jsonl [--script <file.json>] \
 *     [--text "fixed reply"] [--echo] [--chunk-size 24] [--frame-delay-ms 0]
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'

/** Parsed CLI options (see the header for the documented flags). */
function parseArgs(argv) {
  const options = {
    port: 19399,
    host: '127.0.0.1',
    log: '',
    script: '',
    text: '',
    echo: false,
    chunkSize: 24,
    frameDelayMs: 0,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--port':
        options.port = Number(value)
        i += 1
        break
      case '--host':
        options.host = value
        i += 1
        break
      case '--log':
        options.log = value
        i += 1
        break
      case '--script':
        options.script = value
        i += 1
        break
      case '--text':
        options.text = value
        i += 1
        break
      case '--echo':
        options.echo = true
        break
      case '--chunk-size':
        options.chunkSize = Math.max(1, Number(value))
        i += 1
        break
      case '--frame-delay-ms':
        options.frameDelayMs = Math.max(0, Number(value))
        i += 1
        break
      case '--quiet':
        options.quiet = true
        break
      case '--help':
        process.stdout.write(
          'usage: node tests/external/mock-llm/server.mjs [--port N] [--log FILE] ' +
            '[--script FILE] [--text STR] [--echo] [--chunk-size N] [--frame-delay-ms N]\n',
        )
        process.exit(0)
        break
      default:
        throw new Error(`mock-llm: unknown argument ${JSON.stringify(flag)}`)
    }
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error(`mock-llm: --port must be an integer 1..65535, got ${argv.join(' ')}`)
  }
  return options
}

/**
 * Load the ordered reply-rule list.
 *
 * A rule is `{ when, reply, times }`:
 *   - `when` matches the *incoming request* (all listed fields must hold):
 *       `model`, `path`, `textIncludes`, `purpose`, `toolName`, `hasTools`,
 *       `stream`, `index` (1-based ordinal), `indexes` (array of ordinals),
 *       `maxTokensAtMost`, `thinkingDisabled`.
 *     `{}` matches everything, so the last rule is normally the default.
 *   - `reply` describes the response: `text` (string or array of chunks),
 *     `toolCalls` (`[{name, input, id?}]`), `stopReason`, `usage`, `error`
 *     (`{status, type, message}`), or `echo: true` (mirror the last user text).
 *   - `capture` maps names to regexes evaluated against the last user text;
 *     a tool call may then reference the captured group as `${name}` — see
 *     `responses.job-output.example.json`.
 *   - `times` bounds how often the rule may fire (default: unlimited).
 *
 * @param options - parsed CLI options.
 * @returns the normalized rule list, always non-empty.
 */
function loadRules(options) {
  const rules = []
  if (options.script.length > 0) {
    const raw = JSON.parse(readFileSync(options.script, 'utf8'))
    const list = Array.isArray(raw) ? raw : raw.rules
    if (!Array.isArray(list)) throw new Error('mock-llm: --script must hold an array of rules')
    for (const entry of list) {
      rules.push({
        when: entry.when ?? {},
        reply: entry.reply ?? { echo: true },
        capture: entry.capture,
        times: entry.times ?? Number.POSITIVE_INFINITY,
        used: 0,
      })
    }
  }
  if (options.text.length > 0) {
    rules.push({
      when: {},
      reply: { text: options.text },
      times: Number.POSITIVE_INFINITY,
      used: 0,
    })
  }
  if (rules.length === 0 || options.echo) {
    rules.push({ when: {}, reply: { echo: true }, times: Number.POSITIVE_INFINITY, used: 0 })
  }
  return rules
}

/** Extract the concatenated text of the last user-role message. */
function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
    }
  }
  return ''
}

/** Concatenate the text of the last user message regardless of role ordering. */
function anyUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const texts = []
  for (const message of messages) {
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') texts.push(message.content)
    else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      }
    }
  }
  return texts.join('\n')
}

/** True when one rule's `when` predicate holds for the observed request. */
function ruleMatches(rule, request) {
  const when = rule.when ?? {}
  if (rule.used >= rule.times) return false
  if (when.index !== undefined && when.index !== request.seq) return false
  if (Array.isArray(when.indexes) && !when.indexes.includes(request.seq)) return false
  if (when.model !== undefined && when.model !== request.model) return false
  if (when.path !== undefined && when.path !== request.path) return false
  if (when.stream !== undefined && when.stream !== request.stream) return false
  if (when.hasTools !== undefined && when.hasTools !== request.toolNames.length > 0) return false
  if (when.toolName !== undefined && !request.toolNames.includes(when.toolName)) return false
  if (when.purpose !== undefined && when.purpose !== request.purpose) return false
  if (
    when.maxTokensAtMost !== undefined &&
    !(Number.isFinite(request.maxTokens) && request.maxTokens <= when.maxTokensAtMost)
  ) {
    return false
  }
  if (
    when.thinkingDisabled !== undefined &&
    (request.thinking?.type === 'disabled') !== when.thinkingDisabled
  ) {
    return false
  }
  if (when.textIncludes !== undefined && !request.lastUserText.includes(when.textIncludes)) {
    return false
  }
  return true
}

/** Select the first matching rule and account for the hit. */
function selectReply(rules, request) {
  for (const rule of rules) {
    if (!ruleMatches(rule, request)) continue
    rule.used += 1
    return { reply: rule.reply, capture: captureFrom(rule.capture, request.lastUserText) }
  }
  return { reply: { echo: true }, capture: {} }
}

/**
 * Evaluate one rule's `capture` map against the last user text.
 *
 * A rule may name a regex per key — `"capture": {"jobId": "job (task-\\d+)"} —
 * and reference the first group as `${jobId}` inside a tool call's arguments.
 * That is what lets a scripted reply react to what the harness actually sent
 * (a job id in a completion notice, a session id in a tool result) without
 * hard-coding an id the mock cannot know.
 *
 * @param capture - the rule's capture map, if any.
 * @param text - the request's last user text.
 * @returns captured name → first group (or the whole match).
 */
function captureFrom(capture, text) {
  const out = {}
  if (capture === undefined || capture === null) return out
  for (const [name, pattern] of Object.entries(capture)) {
    const match = new RegExp(pattern).exec(text)
    out[name] = match?.[1] ?? match?.[0] ?? ''
  }
  return out
}

/** Substitute `${name}` references inside one reply's tool-call inputs. */
function resolveTemplates(reply, capture) {
  if (Object.keys(capture).length === 0 || !Array.isArray(reply.toolCalls)) return reply
  const walk = (value) => {
    if (typeof value === 'string') {
      return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
        Object.hasOwn(capture, name) ? capture[name] : whole,
      )
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    }
    return value
  }
  return {
    ...reply,
    toolCalls: reply.toolCalls.map((call) => ({ ...call, input: walk(call.input) })),
  }
}

/** Text carried by `tool_result` blocks in a request body. */
function toolResultTexts(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const texts = []
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (block?.type !== 'tool_result') continue
      if (typeof block.content === 'string') {
        texts.push(block.content)
        continue
      }
      if (Array.isArray(block.content)) {
        texts.push(
          block.content
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n'),
        )
      }
    }
  }
  return texts
}

/** Split reply text into streaming chunks (`text` may pin its own chunk list). */
function textChunks(reply, fallback, chunkSize) {
  if (Array.isArray(reply.text)) return reply.text.map((chunk) => String(chunk))
  const text = typeof reply.text === 'string' ? reply.text : fallback
  if (text.length === 0) return ['']
  const chunks = []
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize))
  return chunks
}

/** Count characters as tokens; the mock's numbers only need to be plausible. */
function approxTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4))
}

/** Anthropic Messages SSE frames for one scripted reply. */
function anthropicFrames(reply, request, options) {
  const echoText = request.lastUserText
  const chunks = textChunks(reply, echoText, options.chunkSize)
  const toolCalls = Array.isArray(reply.toolCalls) ? reply.toolCalls : []
  const inputTokens = approxTokens(`${request.system ?? ''}${anyUserText(request.body)}`)
  const frames = [
    {
      type: 'message_start',
      message: {
        id: `msg_mock_${request.seq}`,
        type: 'message',
        role: 'assistant',
        model: request.model,
        content: [],
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    },
  ]
  let outputText = ''
  if (toolCalls.length === 0) {
    frames.push({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })
    for (const chunk of chunks) {
      outputText += chunk
      frames.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: chunk },
      })
    }
    frames.push({ type: 'content_block_stop', index: 0 })
  }
  toolCalls.forEach((call, position) => {
    const index = position
    const input = JSON.stringify(call.input ?? {})
    outputText += input
    frames.push({
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: call.id ?? `toolu_mock_${request.seq}_${position}`,
        name: call.name,
        input: {},
      },
    })
    frames.push({
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: input },
    })
    frames.push({ type: 'content_block_stop', index })
  })
  const stopReason =
    reply.stopReason ??
    (toolCalls.length > 0 ? 'tool_use' : chunks.join('').length > 0 ? 'end_turn' : 'end_turn')
  frames.push({
    type: 'message_delta',
    delta: { stop_reason: stopReason },
    usage: { output_tokens: reply.usage?.outputTokens ?? approxTokens(outputText) },
  })
  frames.push({ type: 'message_stop' })
  return frames
}

/** OpenAI chat-completion chunks for the same scripted reply. */
function openAiChunks(reply, request, options) {
  const chunks = textChunks(reply, request.lastUserText, options.chunkSize)
  const toolCalls = Array.isArray(reply.toolCalls) ? reply.toolCalls : []
  const id = `chatcmpl-mock-${request.seq}`
  const created = Math.floor(Date.now() / 1000)
  const base = { id, object: 'chat.completion.chunk', created, model: request.model }
  const frames = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
  ]
  if (toolCalls.length > 0) {
    toolCalls.forEach((call, position) => {
      frames.push({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: position,
                  id: call.id ?? `call_mock_${request.seq}_${position}`,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })
    })
    frames.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    return frames
  }
  for (const chunk of chunks) {
    frames.push({
      ...base,
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
    })
  }
  frames.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  return frames
}

/** Non-streaming OpenAI completion body. */
function openAiCompletion(reply, request) {
  const text = Array.isArray(reply.text)
    ? reply.text.join('')
    : typeof reply.text === 'string'
      ? reply.text
      : request.lastUserText
  const toolCalls = Array.isArray(reply.toolCalls) ? reply.toolCalls : []
  return {
    id: `chatcmpl-mock-${request.seq}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: request.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: toolCalls.length > 0 ? null : text,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((call, position) => ({
                  id: call.id ?? `call_mock_${request.seq}_${position}`,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
                })),
              }
            : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: approxTokens(`${request.system ?? ''}${anyUserText(request.body)}`),
      completion_tokens: reply.usage?.outputTokens ?? approxTokens(text),
      total_tokens:
        approxTokens(`${request.system ?? ''}${anyUserText(request.body)}`) +
        (reply.usage?.outputTokens ?? approxTokens(text)),
    },
  }
}

/** Read the request body as decoded text. */
function readBody(req) {
  return new Promise((resolve_, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve_(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Write one SSE frame. */
function writeFrame(res, frame, name) {
  res.write(`event: ${name ?? frame.type}\ndata: ${JSON.stringify(frame)}\n\n`)
}

/** Pause between frames when `--frame-delay-ms` is set. */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const rules = loadRules(options)
  const logPath = options.log.length > 0 ? resolve(options.log) : ''
  if (logPath.length > 0) mkdirSync(dirname(logPath), { recursive: true })
  const state = { startedAt: new Date().toISOString(), requests: [], byModel: {}, byPath: {} }
  const verbose = options.quiet !== true

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    if (req.method === 'GET' && path === '/__mock/status') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ...state,
          rules: rules.map(({ when, capture, times, used }) => ({
            when,
            capture,
            times: Number.isFinite(times) ? times : 'unlimited',
            used,
          })),
        }),
      )
      return
    }
    if (req.method === 'POST' && path === '/__mock/reset') {
      state.requests = []
      state.byModel = {}
      state.byPath = {}
      for (const rule of rules) rule.used = 0
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method === 'POST' && path === '/__mock/shutdown') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, total: state.requests.length }))
      setTimeout(() => process.exit(0), 50)
      return
    }
    if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'deepseek-flash', object: 'model', owned_by: 'mock-llm' },
            { id: 'deepseek-v4-pro', object: 'model', owned_by: 'mock-llm' },
            { id: 'mock-model', object: 'model', owned_by: 'mock-llm' },
          ],
        }),
      )
      return
    }

    let body = {}
    let rawBody = ''
    if (req.method === 'POST') {
      rawBody = await readBody(req)
      try {
        body = rawBody.length > 0 ? JSON.parse(rawBody) : {}
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: { type: 'invalid_request_error', message: `mock-llm: ${error.message}` },
          }),
        )
        return
      }
    }

    const seq = state.requests.length + 1
    const toolNames = Array.isArray(body.tools)
      ? body.tools.map((tool) => tool?.name ?? tool?.function?.name ?? '').filter(Boolean)
      : []
    const request = {
      seq,
      at: new Date().toISOString(),
      method: req.method,
      path,
      model: typeof body.model === 'string' ? body.model : '',
      stream: body.stream === true,
      maxTokens: body.max_tokens ?? body.max_tokens_completion ?? null,
      thinking: body.thinking ?? null,
      messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
      lastUserText: lastUserText(body).slice(0, 400),
      toolNames,
      purpose: req.headers['x-deepseek-harness-compact'] === '1' ? 'compaction' : '',
      sessionId: req.headers['x-deepseek-harness-session-id'] ?? '',
      userId: req.headers['x-deepseek-harness-user-id'] ?? '',
      anthropicVersion: req.headers['anthropic-version'] ?? '',
      anthropicBeta: req.headers['anthropic-beta'] ?? '',
      userAgent: req.headers['user-agent'] ?? '',
      authorization: req.headers.authorization !== undefined ? 'present' : 'absent',
      apiKeyHeader: req.headers['x-api-key'] !== undefined ? 'present' : 'absent',
      body,
      system: typeof body.system === 'string' ? body.system : '',
    }
    const selected = selectReply(rules, request)
    const reply = resolveTemplates(selected.reply, selected.capture)
    request.captures = selected.capture
    request.toolResultTexts = toolResultTexts(body)
    request.replyKind =
      reply.error !== undefined
        ? 'error'
        : Array.isArray(reply.toolCalls) && reply.toolCalls.length > 0
          ? 'tool-call'
          : reply.echo === true
            ? 'echo'
            : 'text'
    state.requests.push({ ...request, body: undefined, system: undefined })
    state.byModel[request.model] = (state.byModel[request.model] ?? 0) + 1
    state.byPath[path] = (state.byPath[path] ?? 0) + 1

    const record = {
      seq,
      at: request.at,
      method: request.method,
      path,
      model: request.model,
      stream: request.stream,
      messageCount: request.messageCount,
      toolNames,
      lastUserText: request.lastUserText,
      toolResultTexts: request.toolResultTexts.map((text) => text.slice(0, 2000)),
      captures: request.captures,
      replyKind: request.replyKind,
      sessionId: request.sessionId,
      userId: request.userId,
      anthropicVersion: request.anthropicVersion,
      userAgent: request.userAgent,
      apiKeyHeader: request.apiKeyHeader,
      authorization: request.authorization,
    }
    if (logPath.length > 0) appendFileSync(logPath, `${JSON.stringify(record)}\n`)
    if (verbose) {
      process.stdout.write(
        `[mock-llm] #${seq} ${req.method} ${path} model=${request.model || '-'} ` +
          `msgs=${request.messageCount} reply=${request.replyKind} ` +
          `lastUser=${JSON.stringify(request.lastUserText.slice(0, 80))}\n`,
      )
    }

    if (reply.error !== undefined) {
      const status = reply.error.status ?? 500
      res.writeHead(status, { 'content-type': 'application/json', 'request-id': `mock-req-${seq}` })
      res.end(
        JSON.stringify({
          error: {
            type: reply.error.type ?? 'api_error',
            code: reply.error.code,
            message: reply.error.message ?? 'mock-llm scripted error',
          },
        }),
      )
      return
    }

    const isAnthropic = path.endsWith('/messages')
    if (isAnthropic) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'request-id': `mock-req-${seq}`,
      })
      const frames = anthropicFrames(reply, request, options)
      for (const frame of frames) {
        writeFrame(res, frame)
        if (options.frameDelayMs > 0) await sleep(options.frameDelayMs)
      }
      res.end()
      return
    }

    if (path.endsWith('/chat/completions')) {
      if (request.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        for (const frame of openAiChunks(reply, request, options)) {
          res.write(`data: ${JSON.stringify(frame)}\n\n`)
          if (options.frameDelayMs > 0) await sleep(options.frameDelayMs)
        }
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(openAiCompletion(reply, request, options)))
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: { type: 'not_found_error', message: `mock-llm: no route for ${req.method} ${path}` },
      }),
    )
  })

  server.listen(options.port, options.host, () => {
    const address = server.address()
    process.stdout.write(
      `[mock-llm] listening on http://${options.host}:${address.port} ` +
        `(anthropic /v1/messages, openai /v1/chat/completions, ${rules.length} rule(s)` +
        `${logPath.length > 0 ? `, log ${logPath}` : ''})\n`,
    )
  })

  const stop = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((error) => {
  process.stderr.write(`mock-llm: ${error?.stack ?? String(error)}\n`)
  process.exit(1)
})

export { anthropicFrames, lastUserText, loadRules, openAiChunks, selectReply }
