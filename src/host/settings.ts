/**
 * Settings surface for dsh-task-runner: the `task-runner` namespace holds the
 * `toolEnabled` switch that controls whether the `task_run_config` LLM tool
 * is registered (default on). Uses the official optional-settings wiring so a
 * committed change applies without a reload and the plugin keeps working when
 * no settings provider is mounted.
 * @module @xiaoso/dsh-task-runner/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Settings namespace of this plugin (also the storage domain name and locale NS). */
export const TASK_RUNNER_SETTINGS_NS = settingsNamespace('task-runner')

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
 * Install the optional-settings consumer wiring. `onToolEnabled` fires with
 * the authoritative value at attach, on every committed change, and at
 * detach (re-syncing to the composition default).
 * @param ctx - plugin context owning the wiring.
 * @param onToolEnabled - re-sync the tool registration for the new value.
 */
export function installTaskRunnerSettings(
  ctx: Context,
  onToolEnabled: (enabled: boolean) => void,
): void {
  let current = (): TaskRunnerSettings => DEFAULT_TASK_RUNNER_SETTINGS
  let installed = false
  installSettingsSection(
    ctx,
    TASK_RUNNER_SETTINGS_NS,
    TaskRunnerSettingsSchema,
    DEFAULT_TASK_RUNNER_SETTINGS,
    {
      setSource: (thunk) => {
        current = thunk
        installed = true
      },
      onChange: () => {
        onToolEnabled(current().toolEnabled)
      },
    },
  )
  // No settings provider mounted (or it attaches asynchronously): sync the
  // default now; a later attach fires setSource+onChange again.
  if (!installed) onToolEnabled(DEFAULT_TASK_RUNNER_SETTINGS.toolEnabled)
}
