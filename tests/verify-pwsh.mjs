/**
 * Runtime verification that the DSH shell service on win32 executes commands
 * through PowerShell (NOT Git Bash): mount the real dsh-subprocess-local +
 * dsh-pwsh-local executors on a cordis Context and run a PowerShell-only
 * command (`Write-Output` — bash would fail with "command not found").
 *
 * Not part of `pnpm test`; run manually:
 *   node --experimental-strip-types tests/verify-pwsh.mjs
 */

import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'

const base = 'D:/program/nvm/v22.23.2/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const { default: LocalSubprocessRuntime } = await import(
  pathToFileURL(`${base}/dsh-subprocess-local/lib/index.js`).href
)
const { default: PwshLocalExecutor } = await import(
  pathToFileURL(`${base}/dsh-pwsh-local/lib/index.js`).href
)

const ctx = new Context()
await ctx.plugin(LocalSubprocessRuntime)
await ctx.plugin(PwshLocalExecutor, { pwshPath: 'pwsh' })

const shell = ctx.get('shell')
if (shell === undefined) throw new Error('shell service did not mount')

const spec = shell.resolve({ command: 'Write-Output hello-from-pwsh' })
const result = await shell.run(spec)
console.log(JSON.stringify(result, null, 1))

const pass = result.exitCode === 0
process.exit(pass ? 0 : 1)
