/**
 * Guardrails for the acceptance tooling in `tests/external/` and `tests/lib/`.
 *
 * These scripts only misbehave when something is already wrong (a child that
 * exits before it is ready, a Chrome that cannot be launched, logs written over
 * a previous run's evidence), so the failure is easy to misread as an
 * environment problem. Each case below pins one diagnostic that used to hide
 * its real cause.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LAUNCHER = join(REPO, 'tests', 'lib', 'cdp-chrome-launch.mjs')
const ORCHESTRATOR = join(REPO, 'tests', 'external', 'run-mock-acceptance.mjs')
const HARD_CODED_CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-acceptance-guardrail-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

interface Run {
  code: number | null
  out: string
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: REPO,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('close', (code) => resolveRun({ code, out }))
  })
}

/**
 * A copy of the launcher that differs only in the Chrome path, so a launch
 * failure can be provoked without touching the real script's hard-coded
 * constant. The spawn call and its event handling stay byte-identical.
 */
function launcherWithMissingChrome(): string {
  const source = readFileSync(LAUNCHER, 'utf8')
  if (!source.includes(HARD_CODED_CHROME)) {
    throw new Error(`cdp-chrome-launch.mjs no longer hard-codes ${HARD_CODED_CHROME}`)
  }
  const missing = join(scratch, 'not-a-browser.exe')
  const target = join(scratch, 'launcher-missing-chrome.mjs')
  writeFileSync(target, source.replaceAll(HARD_CODED_CHROME, missing.replaceAll('\\', '\\\\')))
  return target
}

describe('cdp-chrome-launch diagnostics', () => {
  it('reports an unlaunchable Chrome as a launch failure, not an unhandled event', async () => {
    const result = await run(launcherWithMissingChrome(), ['19911', join(scratch, 'profile-a')])

    expect(result.out).not.toContain("Unhandled 'error' event")
    expect(result.out).toContain('chrome failed to start')
    expect(result.out).toContain('not-a-browser.exe')
    // A failed launch is not a clean exit, and must not report one.
    expect(result.out).not.toContain('chrome exited code=0')
    expect(result.code).not.toBe(0)
  }, 30_000)

  it('honours CHROME so the launcher works where Chrome is installed elsewhere', async () => {
    const elsewhere = join(scratch, 'chrome-from-env.exe')
    const result = await run(LAUNCHER, ['19912', join(scratch, 'profile-b')], {
      CHROME: elsewhere,
    })

    expect(result.out).toContain(elsewhere)
    expect(result.out).not.toContain(HARD_CODED_CHROME.replaceAll('\\\\', '\\'))
  }, 30_000)
})

/**
 * Read the log directory the orchestrator resolved.
 *
 * The banner that prints it is emitted by `main()` right after `parseArgs`, so
 * the run is stopped at the first port check by handing it a port this process
 * already holds. That keeps the probe free of DSH, Chrome and the mock server.
 */
async function reportedLogDir(args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  const blocker = createServer()
  await new Promise<void>((ready) => blocker.listen(0, '127.0.0.1', () => ready()))
  const held = (blocker.address() as AddressInfo).port
  try {
    const result = await run(ORCHESTRATOR, [...args, '--dsh-port', String(held)], env)
    const reported = /\[orchestrator\] log-dir=(.*)/.exec(result.out)?.[1]?.trim()
    expect(reported, `no log-dir in banner:\n${result.out}`).toBeDefined()
    return reported as string
  } finally {
    await new Promise<void>((closed) => blocker.close(() => closed()))
  }
}

describe('orchestrator log directory', () => {
  it('does not default into a run directory that already exists', async () => {
    const runDirs = readdirSync(join(REPO, 'tests', 'runs'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const reported = await reportedLogDir([], { DSH_RUN_ID: undefined })

    for (const dir of runDirs) {
      expect(reported, `default log dir reused existing run ${dir}`).not.toContain(dir)
    }
  }, 30_000)

  it('still honours an explicit DSH_RUN_ID', async () => {
    const reported = await reportedLogDir([], { DSH_RUN_ID: 'guardrail-run-id' })

    expect(reported).toContain('guardrail-run-id')
  }, 30_000)

  it('keeps --log-dir authoritative', async () => {
    const target = join(scratch, 'explicit-logs')
    const reported = await reportedLogDir(['--log-dir', target], { DSH_RUN_ID: 'guardrail-run-id' })

    expect(reported).toBe(target)
  }, 30_000)
})
