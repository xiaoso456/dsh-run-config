/**
 * dsh-run-config, host half.
 *
 * Wires the persistent task store (storage domain), the browser RPC routes on
 * the shared Connection `/api` channel (task CRUD + command runs, see
 * host/rpc.ts), the `task-runner` settings namespace (`toolEnabled`), and the
 * `task_run_config` LLM tool whose registration follows the switch dynamically.
 *
 * Run semantics: `llm` tasks run purely in the browser (standard send flow);
 * `command` tasks run here as background jobs (see host/command.ts).
 * @module @xiaoso/dsh-run-config
 */

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-storage-domain'
// Type-only merges: ctx.tools / ctx.agents / ctx.connection / ctx.settings /
// ctx.storageDomain context augmentation. (ctx.skills is consumed through a
// structural cast in host/skill.ts — dsh-skill is not a project dependency.)
import type {} from '@deepseek-ai/dsh-tools'
import { registerTaskRunnerRpc } from './host/rpc.ts'
import { installTaskRunnerSettings } from './host/settings.ts'
import { registerRunConfigurationSkill } from './host/skill.ts'
import { openTaskStore, type TaskStore } from './host/tasks.ts'
import { registerTaskRunnerApprovalGate } from './host/tool/approval.ts'
import { registerTaskRunnerTool } from './host/tool/tool.ts'

/** Host plugin name (also the profile patch row id). */
export const name = 'task-runner'

/**
 * Hard service dependencies. `approval` is intentionally NOT here: following
 * the official pattern, write-approval for the `task_run_config` tool is
 * enforced by a `tools/pre-execute` gate (registerTaskRunnerApprovalGate)
 * that consumes `sandboxPolicy`/`approval` opportunistically with `ctx.get`,
 * and the ToolRuntime resolves `ask` through the standard approval seam.
 * jobs/shell stay optional.
 *
 * `connection` remains a hard dependency because the browser half has no other
 * transport; the RPC registration itself re-binds it through `ctx.inject`
 * (see the end of `apply`).
 */
export const inject = ['storageDomain', 'tools', 'connection', 'agents', 'skills']

/** Host plugin body. */
export async function apply(ctx: import('@deepseek-ai/cordis').Context): Promise<void> {
  // Task store: opens the storage domain and closes it on teardown.
  const store: TaskStore = await openTaskStore(ctx)

  // Tool registration follows the settings switch (`toolEnabled`, default on).
  // The `run-configuration` skill (detailed usage guide) rides the same
  // switch: it only makes sense while the tool is exposed.
  let toolDisposer: (() => void) | undefined
  let gateDisposer: (() => void) | undefined
  let skillDisposer: (() => void) | undefined
  const syncTool = (enabled: boolean): void => {
    if (enabled && toolDisposer === undefined) {
      toolDisposer = registerTaskRunnerTool(ctx, store)
      // Official-pattern write-approval gate (full access → allow, else ask).
      gateDisposer = registerTaskRunnerApprovalGate(ctx)
      // The skill is a usage guide for the tool — never let its registration
      // failure take down the plugin (tool + gate are already registered).
      try {
        skillDisposer = registerRunConfigurationSkill(ctx)
      } catch (error) {
        ctx.logger.warn(
          `[task-runner] run-configuration skill registration failed: ${String(error)}`,
        )
        skillDisposer = undefined
      }
    } else if (!enabled && toolDisposer !== undefined) {
      toolDisposer()
      toolDisposer = undefined
      gateDisposer?.()
      gateDisposer = undefined
      skillDisposer?.()
      skillDisposer = undefined
    }
  }
  installTaskRunnerSettings(ctx, syncTool)
  ctx.effect(
    () => () => {
      toolDisposer?.()
      gateDisposer?.()
      skillDisposer?.()
    },
    'task-runner: tool + gate + skill teardown',
  )

  // Command jobs: attach a controller so `jobs.start` serves our owners even
  // when no other job controller is mounted.
  const jobs = ctx.get('jobs')
  if (jobs !== undefined) {
    ctx.effect(() => jobs.attachController('task-runner'), 'task-runner: job controller')
  }

  // Browser-facing RPC: one exact Fetch route per endpoint on the shared
  // `/api` Connection channel (see host/rpc.ts). Registration needs the
  // Connection service bound to the calling context, so it runs in an
  // `ctx.inject` child; the carrier that owns `/api` authenticates the
  // request before the handler sees it.
  ctx.inject(['connection'], (connectionCtx) => {
    registerTaskRunnerRpc(connectionCtx, store)
  })
}
