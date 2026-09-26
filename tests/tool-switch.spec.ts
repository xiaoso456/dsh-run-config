/**
 * Integration test for the M5 switch on the dsh 0.1.7 configuration surface:
 * the `task_run_config` tool follows the plugin's volatile `toolEnabled` config
 * field — registered by default, unregistered when the switch turns off,
 * re-registered when it turns back on (no reload). The settings service
 * re-reads the volatile reference and announces it with
 * `settings/document-updated`, which is the signal the plugin follows.
 */

import { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_RUNNER_SETTINGS,
  installTaskRunnerSwitch,
  TASK_RUNNER_SETTINGS_NS,
  type TaskRunnerSettings,
} from '../src/host/settings.ts'
import type { TaskStore } from '../src/host/tasks.ts'
import { registerTaskRunnerTool } from '../src/host/tool/tool.ts'

/** The plugin's settings entry id, as the typed literal the event carries. */
const NS = TASK_RUNNER_SETTINGS_NS as SettingsNamespace

/** An unrelated entry id, for the ignore case. */
const OTHER_NS = 'some-other-plugin' as SettingsNamespace

/**
 * A minimal live config: the volatile reference is a stable cell whose value is
 * swapped from outside, exactly like a committed settings write does (0.1.7
 * updates the reference in place rather than re-applying the plugin).
 * @param initial - the starting `toolEnabled` value.
 * @returns the config handed to the plugin plus its writer.
 */
function liveConfig(initial: boolean): {
  config: TaskRunnerSettings
  set(value: boolean): void
} {
  let enabled = initial
  return {
    config: { toolEnabled: { get: () => enabled } } as TaskRunnerSettings,
    set(value) {
      enabled = value
    },
  }
}

/** A tool-registration toggler mirroring the host body's `syncTool`. */
function makeSync(ctx: Context, store: TaskStore): (enabled: boolean) => void {
  let toolDisposer: (() => void) | undefined
  return (enabled: boolean): void => {
    if (enabled && toolDisposer === undefined) {
      toolDisposer = registerTaskRunnerTool(ctx, store)
    } else if (!enabled && toolDisposer !== undefined) {
      toolDisposer()
      toolDisposer = undefined
    }
  }
}

describe('task_run_config tool switch', () => {
  it('registers by default, unregisters when toolEnabled=false, re-registers on true', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const store = {} as unknown as TaskStore

    const live = liveConfig(true)
    installTaskRunnerSwitch(ctx, live.config, makeSync(ctx, store))

    // Default on: the tool is visible.
    expect(ctx.tools.get('task_run_config')).toBeDefined()

    // Switch off (the settings write swapped the reference, then announced it).
    live.set(false)
    ctx.emit('settings/document-updated', NS, 1)
    expect(ctx.tools.get('task_run_config')).toBeUndefined()

    // Switch back on: the tool returns.
    live.set(true)
    ctx.emit('settings/document-updated', NS, 2)
    expect(ctx.tools.get('task_run_config')).toBeDefined()
  })

  it('ignores writes to another plugin entry', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const store = {} as unknown as TaskStore

    const live = liveConfig(true)
    installTaskRunnerSwitch(ctx, live.config, makeSync(ctx, store))

    live.set(false)
    ctx.emit('settings/document-updated', OTHER_NS, 1)
    expect(ctx.tools.get('task_run_config')).toBeDefined()
  })

  it('registers by default when no config write ever arrives', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const store = {} as unknown as TaskStore

    installTaskRunnerSwitch(ctx, liveConfig(true).config, makeSync(ctx, store))

    expect(ctx.tools.get('task_run_config')).toBeDefined()
    expect(DEFAULT_TASK_RUNNER_SETTINGS.toolEnabled).toBe(true)
  })
})
