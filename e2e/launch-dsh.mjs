/**
 * Start a private DSH instance for the e2e lane and publish its launch token.
 *
 * e2e's `app.command` runs this script, then polls the target's URL until it
 * answers. The instance therefore has to be up by the time this process is
 * "ready", and the token has to be on disk before the first test reads it.
 *
 * The instance is fully isolated from the developer's own DSH:
 *
 * - `DSH_HOME` points at a scratch directory inside `.e2e/`, so sessions,
 *   storages, credentials and caches this lane writes never touch the real
 *   home. The directory is recreated on every start.
 * - `profiles/dsh-task-runner` is a junction onto the developer's real profile,
 *   which is what makes the plugin under test load: that profile's
 *   `package.json` links `@xiaoso/dsh-run-config` at this checkout. Nothing
 *   here writes a profile file.
 * - `documents/deepseek-harness/default-workspace` is a junction onto this
 *   checkout, so a session's working directory is the repository. Without it
 *   the harness would create its first-use workspace under the real user
 *   `Documents` and command tasks would run somewhere else entirely.
 *
 * `rmSync(..., { recursive: true })` removes a junction itself rather than
 * descending into its target, so resetting the home cannot delete the profile
 * or the checkout.
 *
 * Usage: node launch-dsh.mjs --port <port> [--home <dir>] [--log <file>]
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This folder — the e2e lane's own root. */
const HERE = dirname(fileURLToPath(import.meta.url))

/** Repository root, one level up: the checkout the plugin is built from. */
const REPO = dirname(HERE)

/** The profile the plugin under test is installed into. */
const PROFILE = 'dsh-task-runner'

/** Process-scoped overlay: workspace pin plus onboarding suppression. */
const PATCH_TEMPLATE = join(HERE, 'dsh.patch.yml')

/** Scratch home for this lane, kept inside `e2e/` so nothing lands in the repo root. */
const DEFAULT_HOME = join(HERE, '.e2e', 'dsh-home')

/** Where the launch token is published for the test setup to read. */
const TOKEN_FILE = join(HERE, '.e2e', 'dsh-token')

/** Parse `--flag value` pairs; unknown flags are refused rather than ignored. */
function parseArgs(argv) {
  const known = new Set(['--port', '--home'])
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!known.has(flag)) throw new Error(`unknown argument: ${flag}`)
    if (value === undefined) throw new Error(`${flag} needs a value`)
    parsed[flag.slice(2)] = value
  }
  if (parsed.port === undefined) throw new Error('--port is required')
  return {
    port: Number(parsed.port),
    home: parsed.home ?? DEFAULT_HOME,
  }
}

/**
 * The dsh launcher to run.
 *
 * Only the globally installed CLI is used: this lane must never install a
 * second dsh runtime of its own (see the project rules), so there is no
 * fallback that would resolve a locally installed copy.
 */
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

/**
 * Build the lane's private home and the two junctions that make the real
 * profile and this checkout reachable from inside it.
 */
function prepareHome(home) {
  const realHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const realProfile = join(realHome, 'profiles', PROFILE)
  if (!existsSync(join(realProfile, 'package.json'))) {
    throw new Error(
      `profile "${PROFILE}" not found at ${realProfile}; the e2e lane needs it to load the plugin`,
    )
  }

  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, 'profiles'), { recursive: true })

  const profileLink = join(home, 'profiles', PROFILE)
  symlinkSync(realProfile, profileLink, 'junction')

  const documents = join(home, 'documents')
  const defaultWorkspace = join(documents, 'deepseek-harness', 'default-workspace')
  mkdirSync(dirname(defaultWorkspace), { recursive: true })
  symlinkSync(REPO, defaultWorkspace, 'junction')

  return { home, realProfile, profileLink, documents, defaultWorkspace }
}

/**
 * Render the overlay with this run's private documents root and the instance's
 * model endpoint substituted in. The template carries placeholders rather than
 * absolute paths and endpoints so it stays a readable, diffable repository file
 * and no credential or machine-specific value is ever committed.
 */
function renderPatch(homeDir, documents) {
  let template = readFileSync(PATCH_TEMPLATE, 'utf8')
  for (const placeholder of ['__DOCUMENTS__', '__LLM_BASE_URL__', '__LLM_MODEL__']) {
    if (!template.includes(placeholder)) {
      throw new Error(`${PATCH_TEMPLATE} no longer carries the ${placeholder} placeholder`)
    }
  }
  template = template.replaceAll('__DOCUMENTS__', documents)

  // The instance's own agent turns need a model, because opening a session
  // requires sending one message. Without `E2E_LLM_BASE_URL` there is nothing
  // to point at, so the provider entries are dropped rather than left pointing
  // at a placeholder — an unconfigured provider reports `MODEL_UNAVAILABLE`,
  // which is clearer than a request to a bogus host.
  const baseURL = process.env.E2E_LLM_BASE_URL
  const model = process.env.E2E_LLM_MODEL
  if (baseURL === undefined || baseURL.length === 0 || model === undefined || model.length === 0) {
    const start = template.indexOf('- id: llm-deepseek')
    if (start !== -1) template = template.slice(0, start)
    console.log(
      '[launch] no E2E_LLM_BASE_URL/MODEL: the instance keeps its own provider configuration',
    )
  } else {
    // The two consumers want different base URLs from the same setting.
    //
    // `E2E_LLM_BASE_URL` is written for e2e's OpenAI-compatible client, which
    // appends `/chat/completions` and therefore expects the URL to end in `/v1`.
    // dsh's `llm-deepseek` provider speaks the Anthropic dialect instead: it
    // appends `/v1/messages` itself, so handing it the same `/v1` URL produces
    // `/v1/v1/messages` and the endpoint answers 404.
    const instanceBase = baseURL.replace(/\/v1\/?$/, '')
    template = template.replaceAll('__LLM_BASE_URL__', instanceBase)
    template = template.replaceAll('__LLM_MODEL__', model)
    console.log(`[launch] instance model: ${model} @ ${instanceBase} (from ${baseURL})`)
  }

  const rendered = join(homeDir, 'dsh.patch.yml')
  writeFileSync(rendered, template)
  return rendered
}

/**
 * Start the instance and wait until its startup line carries the launch token.
 * Resolving with the token is what makes this script "ready" for e2e.
 *
 * Output is echoed to stdout rather than written to a file of our own: e2e's
 * `app.command.log` already captures this process's stdout and stderr, so the
 * instance's own lines land there with a single writer and one place to look.
 */
function startInstance(dshBin, port, home) {
  const child = spawn(
    process.execPath,
    [
      dshBin,
      '--profile',
      PROFILE,
      '--patch',
      renderPatch(home.home, home.documents),
      '--port',
      String(port),
      '--no-open',
    ],
    {
      cwd: REPO,
      env: {
        ...process.env,
        DSH_HOME: home.home,
        // The overlay names this variable as the provider's key (`apiKeyEnv`).
        // Renaming it here means the instance resolves only this lane's key and
        // never the developer's own `DEEPSEEK_API_KEY`.
        E2E_DSH_API_KEY: process.env.E2E_LLM_API_KEY ?? '',
        // A property of THIS lane's instance process, never of the user's
        // profile. The win32 ACL restricted-token sandbox cannot grant write
        // inside this checkout (`SetNamedSecurityInfoW failed (Win32 5)`: the
        // checkout is owned by a different SID than the running token), so a
        // `workspace-write` instance refuses every command with
        // `SandboxUnavailableError` and a command task can never produce a file
        // effect — which is exactly what the run test checks. The provider
        // itself names `danger-full-access` as the documented escape, and the
        // plugin's README recommends it too.
        DSH_PERMISSION_MODE: 'danger-full-access',
        // The lane drives its own browser and reads the instance's stdout, so
        // telemetry and auto-open would only add noise.
        DSH_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const lines = []
  let settled = false

  return new Promise((resolvePromise, rejectPromise) => {
    const record = (chunk) => {
      const text = String(chunk)
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue
        lines.push(line)
        process.stdout.write(`[dsh] ${line}\n`)
        const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=([A-Za-z0-9_.-]+)/.exec(line)
        if (match !== null && !settled) {
          settled = true
          resolvePromise({ child, token: match[1], lines })
        }
      }
    }
    child.stdout.on('data', record)
    child.stderr.on('data', record)

    child.on('exit', (code) => {
      if (settled) return
      settled = true
      rejectPromise(
        new Error(
          `dsh exited with code ${code} before printing a launch token\n` +
            `--- last lines ---\n${lines.slice(-20).join('\n') || '(no output)'}`,
        ),
      )
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectPromise(
        new Error(
          `dsh printed no launch token within 90s\n` +
            `--- last lines ---\n${lines.slice(-20).join('\n') || '(no output)'}`,
        ),
      )
    }, 90_000)
    child.on('exit', () => clearTimeout(timer))
  })
}

/** Kill the whole process tree; the instance spawns its own children. */
function stopTree(child) {
  if (child === undefined || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    /* best effort: e2e kills the command's process group on shutdown too */
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dshBin = resolveDshBin()
  const home = prepareHome(options.home)

  rmSync(TOKEN_FILE, { force: true })

  console.log(`[launch] repo=${REPO}`)
  console.log(`[launch] dsh=${dshBin}`)
  console.log(`[launch] private DSH_HOME=${home.home}`)
  console.log(`[launch]   ${home.profileLink} -> ${home.realProfile}`)
  console.log(`[launch]   ${home.defaultWorkspace} -> ${REPO}`)

  const { child, token } = await startInstance(dshBin, options.port, home)

  mkdirSync(dirname(TOKEN_FILE), { recursive: true })
  writeFileSync(TOKEN_FILE, token)
  console.log(`[launch] token written to ${TOKEN_FILE}`)

  const shutdown = () => {
    stopTree(child)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  child.on('exit', (code) => {
    console.log(`[launch] dsh exited with code ${code}`)
    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(`[launch] ${error.message}`)
  process.exit(1)
})
