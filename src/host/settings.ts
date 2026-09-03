/**
 * Settings surface for dsh-run-config: the `task-runner` namespace holds the
 * `toolEnabled` switch that controls whether the `task_run_config` LLM tool
 * is registered (default on). Uses the settings provider's namespace
 * registration (an effect on the calling fiber), so a committed change applies
 * without a reload; when no settings provider is mounted the plugin keeps
 * working with the composition default.
 * @module @xiaoso/dsh-run-config/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsApplies, SettingsProvider, SettingsScope } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Settings namespace of this plugin (also the storage domain name and locale NS). */
export const TASK_RUNNER_SETTINGS_NS = 'task-runner'

/** Flat plugin settings: whether the task-management tool is exposed to the LLM. */
export interface TaskRunnerSettings {
  toolEnabled: boolean
}

/** Runtime schema: `toolEnabled` defaults to true (plan: the switch defaults on). */
export const TaskRunnerSettingsSchema: z<TaskRunnerSettings> = z.object({
  toolEnabled: z.boolean().default(true),
})

/** Defaults used while no settings provider is mounted. */
export const DEFAULT_TASK_RUNNER_SETTINGS: TaskRunnerSettings = {
  toolEnabled: true,
}

/**
 * Install the namespace registration: `onToolEnabled` fires with the
 * authoritative resolved value at registration and on every committed change.
 * @param ctx - plugin context owning the wiring.
 * @param onToolEnabled - re-sync the tool registration for the new value.
 */
export function installTaskRunnerSettings(
  ctx: Context,
  onToolEnabled: (enabled: boolean) => void,
): void {
  const settings = ctx.get('settings') as SettingsProvider | undefined
  if (settings === undefined) {
    // No settings provider mounted (or it attaches asynchronously): sync the
    // default now; the provider's registration is not available, so the switch
    // stays at the composition default for this process.
    onToolEnabled(DEFAULT_TASK_RUNNER_SETTINGS.toolEnabled)
    return
  }
  const scope = settings.register(TASK_RUNNER_SETTINGS_NS, TaskRunnerSettingsSchema, {
    base: DEFAULT_TASK_RUNNER_SETTINGS,
    applies: 'live' as SettingsApplies,
  })
  onToolEnabled(scope.get().toolEnabled)
  const dispose = scope.watch((next) => {
    onToolEnabled(next.toolEnabled)
  })
  ctx.effect(() => dispose, 'task-runner: settings watch')
}

/** Re-export the owner scope type for the client-facing surface. */
export type TaskRunnerSettingsScope = SettingsScope<TaskRunnerSettings>
