/**
 * Configuration surface for dsh-run-config. Since dsh 0.1.7 a plugin declares
 * its tunable values on its own Cordis `Config` with `.volatile()` fields: the
 * settings form projects exactly those fields (writes land in the active
 * profile's Cordis patch), and the running plugin reads the live value off the
 * stable reference instead of watching a settings scope — a config write
 * updates the reference in place without re-applying the plugin.
 *
 * `toolEnabled` is the one switch: it decides whether the `task_run_config`
 * LLM tool (and its usage skill) is exposed to the model. Default on.
 * @module @xiaoso/dsh-run-config/settings
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/**
 * Settings namespace of this plugin — the same kebab-case string is the locale
 * NS. It is NOT the storage domain name: the domain is `task_runner`
 * (underscore), because `defineDomain` only accepts `[a-z0-9_]` (see D11 in the
 * local decision log and `name: 'task_runner'` in host/tasks.ts).
 */
export const TASK_RUNNER_SETTINGS_NS = 'task-runner'

/**
 * The plugin's live configuration (the resolved `Config` schema below).
 * `toolEnabled` arrives as a stable reference, never a plain value.
 */
export interface TaskRunnerSettings {
  /** Whether the task-management tool is exposed to the LLM. */
  toolEnabled: Volatile<boolean>
}

/**
 * Runtime schema. `toolEnabled` is `volatile()` — the only kind of field the
 * settings form may edit — and defaults to true (the switch ships on).
 */
export const Config = z.object({
  toolEnabled: z.boolean().default(true).volatile(),
})

/**
 * Drive the tool switch from the live config reference.
 *
 * The value is read once now and re-read on every committed settings write for
 * this entry: 0.1.7 emits `settings/document-updated` from the settings
 * service, and the volatile reference already carries the new value by then.
 * @param ctx - plugin context owning the wiring.
 * @param config - the resolved plugin config (volatile references).
 * @param onToolEnabled - re-sync the tool registration for the new value.
 */
export function installTaskRunnerSwitch(
  ctx: Context,
  config: TaskRunnerSettings,
  onToolEnabled: (enabled: boolean) => void,
): void {
  onToolEnabled(config.toolEnabled.get())
  ctx.on('settings/document-updated', (ns) => {
    if ((ns as string) !== TASK_RUNNER_SETTINGS_NS) return
    onToolEnabled(config.toolEnabled.get())
  })
}
