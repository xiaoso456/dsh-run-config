/**
 * Launch a private headless Chrome with a DevTools port, for the CDP
 * acceptance scripts (`tests/cdp-*.mjs`).
 *
 * Chrome runs in the FOREGROUND with its stdio forwarded, so the surrounding
 * shell/background job owns the whole process tree: stopping the job (or
 * Ctrl-C) stops Chrome and leaves no orphan browser behind.
 *
 * usage: node tests/lib/cdp-chrome-launch.mjs <port> [profileDir]
 *
 * The Chrome path below defaults to this machine's Google Chrome install — the
 * browser the CDP scripts were verified against. Set `CHROME` to the executable
 * when it lives somewhere else.
 *
 * The profile directory is always independent of the user's daily Chrome
 * profile; it defaults to <os.tmpdir()>/dsh-cdp-chrome-<port>.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const port = process.argv[2] ?? '9222'
const profile = resolve(process.argv[3] ?? join(tmpdir(), `dsh-cdp-chrome-${port}`))
mkdirSync(profile, { recursive: true })

const args = [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
]

console.log(`[cdp-chrome-launch] "${CHROME}" ${args.join(' ')}`)
const child = spawn(CHROME, args, { stdio: 'inherit' })
console.log(`[cdp-chrome-launch] chrome pid ${child.pid}`)
child.on('error', (error) => {
  process.stderr.write(`[cdp-chrome-launch] chrome failed to start: ${error.message}\n`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  console.log(`[cdp-chrome-launch] chrome exited code=${code} signal=${signal}`)
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
