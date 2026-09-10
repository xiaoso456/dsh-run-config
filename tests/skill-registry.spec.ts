/**
 * The `run-configuration` skill against the REAL dsh 0.1.5 registry.
 *
 * This replaces the removed `tests/cdp-skill.mjs`: that script asserted the
 * skill name appeared in the page text, which stopped meaning anything when the
 * catalog became model-context-only (it is not rendered in the UI any more).
 * Mounting `@deepseek-ai/dsh-skill` verifies the actual contract this plugin
 * depends on — the registration shape is accepted, the skill reaches the
 * catalog, its body loads on demand, and disposal removes it.
 * (`tests/verify-skill.mjs` remains the manual, print-and-inspect variant.)
 */
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import { RUN_CONFIGURATION_SKILL, registerRunConfigurationSkill } from '../src/host/skill.ts'

/** Mount the registry and register our skill through the production path. */
async function mountSkill(): Promise<{ ctx: Context; dispose: () => void }> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  let dispose: () => void = () => {}
  await new Promise<void>((resolve) => {
    ctx.inject(['skills'], (skillCtx) => {
      dispose = registerRunConfigurationSkill(skillCtx)
      resolve()
    })
  })
  return { ctx, dispose }
}

describe('run-configuration skill (real dsh-skill registry)', () => {
  it('appears in the catalog with its routing description', async () => {
    const { ctx } = await mountSkill()
    const summaries = await ctx.skills.list()
    const summary = summaries.find((entry) => entry.name === RUN_CONFIGURATION_SKILL)
    expect(summary).toBeDefined()
    expect(summary?.description).toContain('How to use dsh-run-config run configurations')
    expect(summary?.whenToUse).toContain('save, remember, or reuse')
    expect(summary?.source).toBe('runtime')
    expect(summary?.invocation.modelInvocable).toBe(true)
  })

  it('serves the full usage guide on demand', async () => {
    const { ctx } = await mountSkill()
    const definition = await ctx.skills.get(RUN_CONFIGURATION_SKILL)
    expect(definition?.content).toContain('# Run configurations (dsh-run-config)')
    expect(definition?.content).toContain('## Parameters')
    expect(definition?.content).toContain('task_run_config')
  })

  it('disappears from the catalog when the tool switch disposes it', async () => {
    const { ctx, dispose } = await mountSkill()
    dispose()
    const summaries = await ctx.skills.list()
    expect(summaries.some((entry) => entry.name === RUN_CONFIGURATION_SKILL)).toBe(false)
  })
})
