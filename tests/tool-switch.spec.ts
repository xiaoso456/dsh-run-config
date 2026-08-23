/**
 * Integration test for the M5 switch: the `task_runner_config` tool follows
 * the `task-runner` settings namespace's `toolEnabled` flag — registered by
 * default, unregistered when the switch turns off, re-registered when it
 * turns back on (no reload).
 */

import { Context } from '@deepseek-ai/cordis'
import {
  type SettingsNamespace,
  SettingsProvider,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_RUNNER_SETTINGS,
  installTaskRunnerSettings,
  TaskRunnerSettingsSchema,
} from '../src/host/settings.ts'
import type { TaskStore } from '../src/host/tasks.ts'
import { registerTaskRunnerTool } from '../src/host/tool/tool.ts'

/** A minimal settings provider implementing the three primitives. */
class BareProvider extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(
    ctx: ConstructorParameters<typeof SettingsProvider>[0],
    options?: { doc?: Record<string, unknown> },
  ) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const tick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

describe('task_runner_config tool switch', () => {
  it('registers by default, unregisters when toolEnabled=false, re-registers on true', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(BareProvider)
    const store = {} as unknown as TaskStore

    let toolDisposer: (() => void) | undefined
    const syncTool = (enabled: boolean): void => {
      if (enabled && toolDisposer === undefined) {
        toolDisposer = registerTaskRunnerTool(ctx, store)
      } else if (!enabled && toolDisposer !== undefined) {
        toolDisposer()
        toolDisposer = undefined
      }
    }
    installTaskRunnerSettings(ctx, syncTool)
    await tick()

    // Default on: the tool is visible.
    expect(ctx.tools.get('task_runner_config')).toBeDefined()

    // Switch off: the tool disappears.
    await ctx.settings.update(settingsNamespace('task-runner'), { toolEnabled: false })
    await tick()
    await tick()
    expect(ctx.tools.get('task_runner_config')).toBeUndefined()

    // Switch back on: the tool returns.
    await ctx.settings.update(settingsNamespace('task-runner'), { toolEnabled: true })
    await tick()
    await tick()
    expect(ctx.tools.get('task_runner_config')).toBeDefined()
  })

  it('keeps the tool registered when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const store = {} as unknown as TaskStore

    let toolDisposer: (() => void) | undefined
    const syncTool = (enabled: boolean): void => {
      if (enabled && toolDisposer === undefined) {
        toolDisposer = registerTaskRunnerTool(ctx, store)
      } else if (!enabled && toolDisposer !== undefined) {
        toolDisposer()
        toolDisposer = undefined
      }
    }
    installTaskRunnerSettings(ctx, syncTool)
    await tick()

    expect(ctx.tools.get('task_runner_config')).toBeDefined()
    expect(TaskRunnerSettingsSchema).toBeDefined()
    expect(DEFAULT_TASK_RUNNER_SETTINGS.toolEnabled).toBe(true)
  })
})
