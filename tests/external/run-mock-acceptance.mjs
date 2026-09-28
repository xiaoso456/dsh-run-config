#!/usr/bin/env node
/**
 * Acceptance orchestrator for the *external dependency* lane.
 *
 * It runs the two CDP scripts that need a live agent turn — `tests/cdp-llm-run.mjs`
 * and `tests/cdp-pwsh.mjs` — against a dsh test instance whose provider route is
 * pointed at the local mock (`tests/external/mock-llm/server.mjs`), and records
 * every raw stream so the run is provable end to end:
 *
 *   mock server stdout/request log  →  proof the turn really reached the mock
 *   dsh instance log                →  proof the overlay was the applied layer
 *   each script's raw output + exit →  proof the assertions ran and passed
 *
 * Isolation rules this file enforces:
 *   - the instance is a private `--profile dsh-task-runner --port <free port>`
 *     process; the long-running development service (3080) and the developer's
 *     browser CDP port (9222) are refused by `assertNotReservedPort`;
 *   - the provider is re-pointed through the launcher's `--patch` overlay or
 *     through `DEEPSEEK_BASE_URL`; nothing under `$DSH_HOME` is written, backed
 *     up, or edited;
 *   - every process this script starts is killed by PID tree at the end
 *     (`taskkill /T /F` on Windows), so no orphan Chrome or instance survives.
 *
 *   - the home is reset before every run and removed afterwards unless
 *     `--keep-home` is given (which keeps it for post-mortem extraction).
 *
 * Usage:
 *   node tests/external/run-mock-acceptance.mjs                 # green lane
 *   node tests/external/run-mock-acceptance.mjs --skip-mock     # control lane:
 *                                                               # same overlay,
 *                                                               # no mock process
 *   node tests/external/run-mock-acceptance.mjs --only cdp-llm-run
 *   node tests/external/run-mock-acceptance.mjs --wiring env    # env-var wiring
 *
 * Flags: --mock-port N --dsh-port N --cdp-port N --log-dir DIR --script FILE
 *        --wiring patch|env --permission-mode MODE --home DIR --keep-home
 *        --prefix NAME --skip-mock --only NAME --keep-alive
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const MOCK_SERVER = join(HERE, 'mock-llm', 'server.mjs')
const PATCH_TEMPLATE = join(HERE, 'mock-llm', 'dsh-mock-llm.patch.yml')
const DEFAULT_SCRIPT = join(HERE, 'mock-llm', 'responses.acceptance.json')

/** Ports never to be used by this lane: the developer's own services. */
const RESERVED_PORTS = new Set(['3080', '9222'])

/** Mock-side credential name; the mock never validates it. */
const MOCK_API_KEY = 'sk-mock-local-acceptance-key'

/** A run id for this invocation, matching the `tests/runs/<id>` convention. */
function runId() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

/** The CDP scripts this lane owns. */
const SCRIPTS = {
  'cdp-llm-run': { file: join(REPO, 'tests', 'cdp-llm-run.mjs'), args: ['send'] },
  'cdp-pwsh': { file: join(REPO, 'tests', 'cdp-pwsh.mjs'), args: [] },
}

function parseArgs(argv) {
  const options = {
    mockPort: 19399,
    dshPort: 3190,
    cdpPort: 19333,
    logDir: join(REPO, 'tests', 'runs', process.env.DSH_RUN_ID ?? runId(), 'logs'),
    script: DEFAULT_SCRIPT,
    wiring: 'patch',
    // The win32 ACL restricted-token sandbox runner cannot grant write inside
    // this checkout (`SetNamedSecurityInfoW failed (Win32 5)` — the checkout is
    // owned by another SID than the running token), so a `workspace-write`
    // instance refuses every command with SandboxUnavailableError and the pwsh
    // probe can never be written. `danger-full-access` is the documented escape
    // the provider itself names ("otherwise switch the consumer to
    // danger-full-access"); it is a property of THIS lane's instance process
    // env, never of the user's profile. See the README's "cannot cover" table.
    permissionMode: 'danger-full-access',
    // A private harness home keeps this lane out of the developer's shared
    // session/storage store: the instance resumes no previous session, so the
    // very first run is byte-for-byte the same scenario as the tenth.
    home: join(tmpdir(), 'dsh-mock-acceptance-home'),
    keepHome: false,
    prefix: 'mock',
    skipMock: false,
    keepAlive: false,
    only: Object.keys(SCRIPTS),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--mock-port':
        options.mockPort = Number(value)
        i += 1
        break
      case '--dsh-port':
        options.dshPort = Number(value)
        i += 1
        break
      case '--cdp-port':
        options.cdpPort = Number(value)
        i += 1
        break
      case '--log-dir':
        options.logDir = resolve(value)
        i += 1
        break
      case '--script':
        options.script = resolve(value)
        i += 1
        break
      case '--wiring':
        if (value !== 'patch' && value !== 'env') throw new Error('--wiring must be patch|env')
        options.wiring = value
        i += 1
        break
      case '--permission-mode':
        if (!['read-only', 'workspace-write', 'danger-full-access'].includes(value)) {
          throw new Error('--permission-mode must be read-only|workspace-write|danger-full-access')
        }
        options.permissionMode = value
        i += 1
        break
      case '--skip-mock':
        options.skipMock = true
        break
      case '--home':
        options.home = resolve(value)
        i += 1
        break
      case '--keep-home':
        // Documented meaning: keep the private home AFTER the run for
        // inspection. The home is reset before every run regardless.
        options.keepHome = true
        break
      case '--prefix':
        options.prefix = String(value)
        i += 1
        break
      case '--keep-alive':
        options.keepAlive = true
        break
      case '--only': {
        const names = String(value)
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
        for (const name of names) {
          if (SCRIPTS[name] === undefined) throw new Error(`--only: unknown script ${name}`)
        }
        options.only = names
        i += 1
        break
      }
      case '--help':
        process.stdout.write(
          'usage: node tests/external/run-mock-acceptance.mjs [--mock-port N] [--dsh-port N] ' +
            '[--cdp-port N] [--log-dir DIR] [--script FILE] [--wiring patch|env] ' +
            '[--permission-mode read-only|workspace-write|danger-full-access] [--home DIR] ' +
            '[--keep-home] [--prefix NAME] [--skip-mock] [--only name,name] [--keep-alive]\n',
        )
        process.exit(0)
        break
      default:
        throw new Error(`unknown argument ${JSON.stringify(flag)}`)
    }
  }
  for (const [label, port] of [
    ['mock', options.mockPort],
    ['dsh', options.dshPort],
    ['cdp', options.cdpPort],
  ]) {
    assertNotReservedPort(label, port)
  }
  return options
}

function assertNotReservedPort(label, port) {
  if (RESERVED_PORTS.has(String(port))) {
    throw new Error(
      `${label} port ${port} is reserved for the developer's own services ` +
        '(3080 long-running dev instance / 9222 browser); pick another port',
    )
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${label} port must be an integer 1..65535, got ${port}`)
  }
}

/** Refuse to start on a port something else already holds. */
function assertPortFree(port, label) {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', (error) =>
      fail(new Error(`${label} port ${port} is already in use: ${error.code}`)),
    )
    probe.listen(port, '127.0.0.1', () => probe.close(() => done()))
  })
}

/** Locate the global dsh launcher without going through a shell shim. */
function resolveDshBin() {
  const candidates = [
    process.env.DSH_BIN,
    join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  throw new Error(
    `dsh launcher not found; set DSH_BIN to <dsh>/lib/bin.js. Tried: ${candidates.join(', ')}`,
  )
}

/** Spawn a child whose stdio is piped into a log file, and echo the lines. */
function startLogged(name, command, args, childEnv, logPath) {
  mkdirSync(dirname(logPath), { recursive: true })
  const lines = []
  const child = spawn(command, args, {
    cwd: REPO,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const record = (chunk, stream) => {
    const text = String(chunk)
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue
      lines.push(`[${stream}] ${line}`)
      process.stdout.write(`[${name}/${stream}] ${line}\n`)
    }
    writeFileSync(logPath, lines.join('\n') + '\n')
  }
  child.stdout.on('data', (chunk) => record(chunk, 'out'))
  child.stderr.on('data', (chunk) => record(chunk, 'err'))
  return { child, lines, logPath }
}

/** Wait until `predicate()` over the collected lines holds. */
async function waitFor(label, container, predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = predicate(container.lines)
    if (hit !== undefined && hit !== false) return hit
    if (container.child.exitCode !== null) {
      throw new Error(
        `${label} exited before becoming ready (code ${container.child.exitCode})\n` +
          exitDiagnosis(label, container),
      )
    }
    await new Promise((done) => setTimeout(done, 200))
  }
  throw new Error(
    `${label} did not become ready within ${timeoutMs} ms\n${exitDiagnosis(label, container)}`,
  )
}

/**
 * Why a child never became ready.
 *
 * `code 0` is the confusing one: a process that exits 0 has not crashed, so
 * "exited early" sends the reader looking for a crash instead of the reason the
 * child was gone before it was ready. The collected output is the only place
 * that reason exists, so it belongs in the error.
 */
function exitDiagnosis(label, container) {
  const code = container.child.exitCode
  const note =
    code === 0
      ? `${label} exited cleanly, so whatever stopped it is not a crash — read the lines below.`
      : `${label} exited with code ${code}.`
  const lines = container.lines.slice(-20)
  return `${note}\n--- ${label} output (last ${lines.length} line(s)) ---\n${
    lines.join('\n') || '(no output)'
  }`
}

/** Kill a whole process tree by PID; `child.kill()` would orphan Chrome children. */
function stopTree(child, label) {
  if (child === undefined || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
    process.stdout.write(`[teardown] killed ${label} pid ${child.pid}\n`)
  } catch (error) {
    process.stdout.write(`[teardown] ${label} pid ${child.pid}: ${error.message}\n`)
  }
}

/** Run one acceptance script and capture its raw output + exit code. */
function runAcceptanceScript(name, env, logPath) {
  const spec = SCRIPTS[name]
  const chunks = []
  const child = spawn(process.execPath, [spec.file, ...spec.args], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((done) => {
    child.stdout.on('data', (chunk) => chunks.push(String(chunk)))
    child.stderr.on('data', (chunk) => chunks.push(String(chunk)))
    child.on('exit', (code) => {
      const text = chunks.join('')
      process.stdout.write(`\n===== ${name} (exit ${code}) =====\n${text}\n`)
      mkdirSync(dirname(logPath), { recursive: true })
      writeFileSync(logPath, text)
      done({ name, code, text, logPath })
    })
  })
}

/** Render the overlay (mock provider + pinned first-use workspace). */
function renderPatch(options, logDir, documents) {
  const providerLayer =
    options.wiring === 'patch'
      ? readFileSync(PATCH_TEMPLATE, 'utf8').replaceAll(
          '127.0.0.1:19399',
          `127.0.0.1:${options.mockPort}`,
        )
      : "# Provider wiring: --wiring env, so this layer carries the lane's shell/workspace\n" +
        '# conditions only; the provider endpoint comes from DEEPSEEK_BASE_URL.\n'
  const rendered = [
    providerLayer,
    '',
    "# Lane-only layer (always applied): keep the harness's first-use Workspace",
    '# inside the private home, where it is a junction onto this repository (see',
    '# `prepareHome`). Without it the harness creates that folder under the real',
    '# user Documents directory and the session cwd leaves the checkout.',
    '- id: workspace-controller',
    "  name: '@deepseek-ai/dsh-api-workspace-controller'",
    '  config:',
    `    documentsDirectory: '${documents}'`,
    '',
  ].join('\n')
  const target = join(logDir, `${options.prefix}-llm-rendered.patch.yml`)
  mkdirSync(logDir, { recursive: true })
  writeFileSync(target, rendered)
  return target
}

/** Hash one file, or `missing` when it is absent. */
function fileDigest(path) {
  if (!existsSync(path)) return 'missing'
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Build the lane's private harness home. Everything is created fresh inside it
 * (sessions, storages, credentials, cache), so the lane can neither read nor
 * add to the developer's history.
 *
 * Two deliberate links:
 * - `profiles/dsh-task-runner` is a junction onto the developer's real profile
 *   (nothing in this lane writes a profile file; the provider override arrives
 *   as a launcher `--patch` overlay).
 * - `<Documents>/deepseek-harness/default-workspace` is a junction onto this
 *   repository, because `tests/cdp-pwsh.mjs` proves the PowerShell executor ran
 *   by looking for `<repo>/pwsh-probe.txt` while the command's cwd is the
 *   session's workspace. Without a registered workspace the harness would create
 *   its first-use one under the user's real `Documents` and the probe file would
 *   land outside the repository.
 *
 * `fs.rmSync(..., {recursive: true})` removes a junction itself and does not
 * descend into its target, so resetting the home each run cannot touch the
 * profile or the checkout.
 *
 * @param options - parsed CLI options.
 * @returns home/link/documents facts plus the profile-integrity baseline.
 */
function prepareHome(options) {
  const realHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const realProfile = join(realHome, 'profiles', 'dsh-task-runner')
  const before = {
    profilePatch: fileDigest(join(realProfile, 'cordis.patch.yml')),
    profileEntries: existsSync(realProfile) ? null : 'profile missing',
  }
  // The home is ALWAYS reset before the run: the lane's determinism depends on
  // starting with no session to resume, because `tests/cdp-llm-run.mjs` asserts
  // on a `1 轮` transcript that a reused session's counter cannot match.
  // `--keep-home` therefore means "leave it in place afterwards, for
  // post-mortem extraction" — never "reuse the previous run's state".
  rmSync(options.home, { recursive: true, force: true })
  mkdirSync(join(options.home, 'profiles'), { recursive: true })
  const profileLink = join(options.home, 'profiles', 'dsh-task-runner')
  if (!existsSync(profileLink)) symlinkSync(realProfile, profileLink, 'junction')
  if (!existsSync(join(profileLink, 'node_modules'))) {
    throw new Error(`private home junction is not usable: ${profileLink}/node_modules missing`)
  }
  const documents = join(options.home, 'documents')
  const defaultWorkspace = join(documents, 'deepseek-harness', 'default-workspace')
  mkdirSync(dirname(defaultWorkspace), { recursive: true })
  if (!existsSync(defaultWorkspace)) symlinkSync(REPO, defaultWorkspace, 'junction')
  return {
    home: options.home,
    profileLink,
    realProfile,
    documents,
    defaultWorkspace,
    before,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  mkdirSync(options.logDir, { recursive: true })
  const dshBin = resolveDshBin()
  const summary = { startedAt: new Date().toISOString(), options, steps: [] }

  console.log(
    `[orchestrator] repo=${REPO}\n[orchestrator] dsh=${dshBin}\n` +
      `[orchestrator] mock-port=${options.mockPort} dsh-port=${options.dshPort} ` +
      `cdp-port=${options.cdpPort} wiring=${options.wiring} skip-mock=${options.skipMock}\n` +
      `[orchestrator] log-dir=${options.logDir}`,
  )

  await assertPortFree(options.dshPort, 'dsh')
  await assertPortFree(options.cdpPort, 'cdp')
  if (!options.skipMock) await assertPortFree(options.mockPort, 'mock')

  const home = prepareHome(options)
  const patchPath = renderPatch(options, options.logDir, home.documents)
  summary.home = home
  console.log(
    `[orchestrator] private DSH_HOME=${home.home}\n` +
      `[orchestrator]   ${home.profileLink} -> ${home.realProfile}\n` +
      `[orchestrator]   ${home.defaultWorkspace} -> ${REPO}\n` +
      `[orchestrator]   shared profile cordis.patch.yml sha256=${home.before.profilePatch}`,
  )
  const teardown = []

  try {
    // 1) mock provider -------------------------------------------------------
    if (!options.skipMock) {
      const mock = startLogged(
        'mock-llm',
        process.execPath,
        [
          MOCK_SERVER,
          '--port',
          String(options.mockPort),
          '--script',
          options.script,
          '--log',
          join(options.logDir, `${options.prefix}-llm-requests.jsonl`),
        ],
        { ...process.env },
        join(options.logDir, `${options.prefix}-llm-server.log`),
      )
      teardown.push({ child: mock.child, label: 'mock-llm' })
      await waitFor('mock-llm', mock, (lines) => lines.some((line) => line.includes('listening')))
    } else {
      console.log('[orchestrator] --skip-mock: the mock process is deliberately NOT started')
      writeFileSync(
        join(options.logDir, `${options.prefix}-llm-server.log`),
        '(--skip-mock: mock not started)\n',
      )
    }

    // 2) dsh test instance ---------------------------------------------------
    const instanceEnv = {
      ...process.env,
      DSH_HOME: home.home,
      MOCK_LLM_API_KEY: MOCK_API_KEY,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: options.permissionMode,
    }
    const instanceArgs = ['--profile', 'dsh-task-runner']
    // The overlay always carries the lane's workspace pin; it also carries the
    // provider route in `patch` mode, where an inherited endpoint variable is
    // dropped so nothing can outrank it.
    instanceArgs.push('--patch', patchPath)
    if (options.wiring === 'patch') {
      delete instanceEnv.DEEPSEEK_BASE_URL
    } else {
      instanceEnv.DEEPSEEK_BASE_URL = `http://127.0.0.1:${options.mockPort}`
      instanceEnv.DEEPSEEK_API_KEY = MOCK_API_KEY
    }
    instanceArgs.push('--port', String(options.dshPort), '--no-open')
    const instance = startLogged(
      'dsh-instance',
      process.execPath,
      [dshBin, ...instanceArgs],
      instanceEnv,
      join(options.logDir, `${options.prefix}-instance-${options.dshPort}.log`),
    )
    teardown.push({ child: instance.child, label: 'dsh-instance' })
    const tokenLine = await waitFor('dsh-instance', instance, (lines) =>
      lines.find((line) => /http:\/\/127\.0\.0\.1:\d+\/\?token=/.test(line)),
    )
    const token = /token=([A-Za-z0-9_.-]+)/.exec(tokenLine)?.[1]
    if (token === undefined) throw new Error(`could not read the launch token from ${tokenLine}`)
    summary.tokenLine = tokenLine
    summary.wiring = options.wiring
    summary.patchPath = patchPath
    console.log(`[orchestrator] instance ready: ${tokenLine}`)

    // 3) private headless Chrome --------------------------------------------
    const chrome = startLogged(
      'chrome',
      process.execPath,
      [join(REPO, 'tests', 'lib', 'cdp-chrome-launch.mjs'), String(options.cdpPort)],
      { ...process.env },
      join(options.logDir, `${options.prefix}-chrome-${options.cdpPort}.log`),
    )
    teardown.push({ child: chrome.child, label: 'chrome' })
    await waitFor('chrome', chrome, (lines) =>
      lines.some((line) => line.includes('DevTools listening')),
    )
    summary.chromePidLine = chrome.lines.find((line) => line.includes('chrome pid'))

    // 4) acceptance scripts --------------------------------------------------
    const scriptEnv = {
      ...process.env,
      DSH_WEB_TOKEN: token,
      DSH_BASE: `http://127.0.0.1:${options.dshPort}`,
      DSH_CDP_PORT: String(options.cdpPort),
    }
    for (const name of options.only) {
      const result = await runAcceptanceScript(
        name,
        scriptEnv,
        join(options.logDir, `${options.prefix}-${name}.log`),
      )
      summary.steps.push({ name, exitCode: result.code, logPath: result.logPath })
    }

    // 5) mock-side counters: the proof the requests went through the mock ----
    if (!options.skipMock) {
      const status = await fetch(`http://127.0.0.1:${options.mockPort}/__mock/status`).then((r) =>
        r.json(),
      )
      writeFileSync(
        join(options.logDir, `${options.prefix}-llm-status.json`),
        `${JSON.stringify(status, null, 2)}\n`,
      )
      summary.mock = {
        total: status.requests.length,
        byModel: status.byModel,
        byPath: status.byPath,
        lastUserTexts: status.requests.slice(-6).map((request) => request.lastUserText),
      }
      console.log(
        `[orchestrator] mock served ${status.requests.length} request(s) ` +
          `${JSON.stringify(status.byModel)} ${JSON.stringify(status.byPath)}`,
      )
    }
  } finally {
    if (options.keepAlive) {
      console.log('[orchestrator] --keep-alive: leaving processes running (kill them yourself)')
    } else {
      for (const entry of teardown.reverse()) stopTree(entry.child, entry.label)
    }
  }

  summary.finishedAt = new Date().toISOString()
  summary.profileAfter = fileDigest(join(home.realProfile, 'cordis.patch.yml'))
  summary.sharedProfileUnchanged = summary.profileAfter === home.before.profilePatch
  summary.ok = summary.steps.length > 0 && summary.steps.every((step) => step.exitCode === 0)
  if (!options.keepHome) {
    rmSync(home.home, { recursive: true, force: true })
    summary.homeRemoved = true
  }
  writeFileSync(
    join(options.logDir, `${options.prefix}-run-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  const table = summary.steps
    .map((step) => `  ${step.name}: exit ${step.exitCode}  (${step.logPath})`)
    .join('\n')
  console.log(
    `\n[orchestrator] results\n${table}\n` +
      `[orchestrator] shared profile untouched=${summary.sharedProfileUnchanged} ` +
      `(sha256 ${summary.profileAfter})\n[orchestrator] ok=${summary.ok}`,
  )
  process.exit(summary.ok ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`[orchestrator] fatal: ${error?.stack ?? String(error)}\n`)
  process.exit(2)
})
