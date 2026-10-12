/**
 * e2e configuration for @xiaoso/dsh-run-config.
 *
 * Runs the plugin's browser UI in a real Chromium against a private DSH
 * instance started by `launch-dsh.mjs`, and records a video plus evidence
 * screenshots of every attempt.
 *
 * The model is optional. Tests 01-04 drive the UI through the accessibility
 * tree and need no model at all; only the agentic test (05) does, and it skips
 * itself when `.env.local` is absent. Fill in `.env.local` (copy
 * `.env.example`) to enable it.
 *
 * `e2e` loads no `.env` file of its own, so this config reads it explicitly.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { web } from '@e2e-dev/web'
import type { E2EConfig } from 'e2e'

const ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * The local model/key file. Absent is normal: the deterministic tests still run.
 *
 * Two names are read, `.env.local` first. `.env.local` is the documented
 * convention for machine-local secrets; plain `.env` is accepted too because
 * Node's own tooling (and most editors) key off the `.env` prefix, so that is
 * what people reach for. Both are gitignored — see `.gitignore`.
 */
for (const name of ['.env.local', '.env']) {
  const file = join(ROOT, name)
  if (existsSync(file)) {
    process.loadEnvFile(file)
    break
  }
}

const baseURL = process.env.E2E_LLM_BASE_URL
const apiKey = process.env.E2E_LLM_API_KEY
const model = process.env.E2E_LLM_MODEL

/**
 * The agent entry, or nothing when no model is configured.
 *
 * Omitting `agents` is deliberate rather than lazy: e2e has no implicit model
 * and no environment fallback, so an unconfigured agent fails only at its first
 * model call. That keeps every model-free test runnable on a machine with no
 * key, while the agentic test reports the missing configuration itself.
 */
const agents =
  baseURL !== undefined && apiKey !== undefined && model !== undefined
    ? {
        default: {
          model: createOpenAICompatible({ name: 'local', baseURL, apiKey }).chatModel(model),
          context: [
            'This app is the DeepSeek Harness web GUI with the "Run Config" plugin.',
            'The plugin adds a run control to the session header: a play button next to a task-name dropdown.',
            'Run configurations are called 任务运行配置 / "run configurations".',
            'A configuration is either an LLM task (fills the composer) or a command task (runs a shell command in the background).',
            'The configuration dialog is titled 任务运行配置 and has a task list on the left and a form on the right.',
            'Its footer has 保存 / Save, 取消 / Cancel, and shows 已保存 / Saved after a successful save.',
            'The toolbar above the list has 新增 / New, 复制 / Duplicate and 删除 / Delete.',
          ].join(' '),
        },
      }
    : undefined

export default {
  projectId: 'dsh-run-config',

  targets: [
    {
      name: 'dsh',
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app: {
        // Port 0 asks the run for a free loopback port; `{port}` below is
        // expanded to that same number, so this lane never collides with the
        // developer's own instance (3190/3080) or another run.
        url: 'http://127.0.0.1:0',
        command: {
          executable: process.execPath,
          args: ['launch-dsh.mjs', '--port', '{port}'],
          // e2e spawns this process with an allowlisted environment (PATH, HOME,
          // TMPDIR, TMP, TEMP, SystemRoot, COMSPEC), so the values read from
          // `.env` would not reach it otherwise. The launcher needs the model
          // endpoint to point the instance's own provider at it, and the key to
          // pass on under the name the overlay declares.
          env: {
            ...(baseURL === undefined ? {} : { E2E_LLM_BASE_URL: baseURL }),
            ...(apiKey === undefined ? {} : { E2E_LLM_API_KEY: apiKey }),
            ...(model === undefined ? {} : { E2E_LLM_MODEL: model }),
          },
          startupTimeout: 120_000,
          // Relative to the project root, which is this folder. e2e requires
          // the log to stay inside it.
          log: '.e2e/dsh-instance.log',
        },
      },
    },
  ],

  ...(agents === undefined ? {} : { agents }),

  // Record every attempt, not just failures: the videos are the point.
  video: 'on',
  trace: 'on',

  // Pinned rather than left to e2e's CI detection. This machine's shell carries
  // CI=true (injected by the harness), which would otherwise silently switch
  // this lane to one worker, one retry, and — the costly one — a READ-ONLY
  // replay cache. Read-only means no recording is ever written, so every run
  // pays for the model again and the cache never warms up. Pinning the three
  // here makes a run behave the same in this shell as in a plain terminal.
  workers: 1,
  retries: 0,
  cache: 'read-write',

  timeout: 120_000,
  launchTimeout: 120_000,
} satisfies E2EConfig
