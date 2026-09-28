/**
 * `vitest.config.ts` 的收集边界 —— 单元测试套件到底会捡起哪些文件。
 *
 * 钉的是**解析后的收集集合**，不是 `include`/`exclude` 的字面量：这里问 vitest 本人
 * （`vitest list`），而不是用 `fs.globSync` 复刻一个模型。
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VITEST_BIN = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const RUN_ARTIFACT_DIR = 'tests/runs/'

/** What vitest itself reports it collects, as posix-ish relative paths. */
function collectedSpecFiles(): string[] {
  const stdout = execFileSync(
    process.execPath,
    // `--api 0` gives the child's websocket server a free port; without it the
    // child races the running suite for vitest's default API port and writes
    // "Port is already in use" to stderr on every test run.
    [VITEST_BIN, 'list', '--filesOnly', '--api', '0'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return stdout.split(/\r?\n/).filter(Boolean).sort()
}

/** Every spec under `tests/`, by plain directory recursion — no glob engine. */
function specFilesOnDisk(): string[] {
  return readdirSync(`${ROOT}tests`, { recursive: true, encoding: 'utf8' })
    .map((file) => `tests/${file.split(sep).join('/')}`)
    .filter((file) => file.endsWith('.spec.ts') || file.endsWith('.spec.tsx'))
    .sort()
}

describe('vitest suite collection boundary', () => {
  let collected: string[]

  beforeAll(() => {
    collected = collectedSpecFiles()
  }, 30_000)

  it('never collects the gitignored run-artifact directory', () => {
    expect(collected.filter((file) => file.startsWith(RUN_ARTIFACT_DIR))).toEqual([])
  })

  it('collects exactly the spec files that exist on disk', () => {
    const onDisk = specFilesOnDisk().filter((file) => !file.startsWith(RUN_ARTIFACT_DIR))
    expect(onDisk.length).toBeGreaterThan(0)
    expect(collected).toEqual(onDisk)
  })
})
