/**
 * Skill registration: the `run-configuration` skill carries a LEAN catalog
 * summary (description, injected into the model context) and a DETAILED body
 * (content, loaded on demand through the official skill mechanism). The
 * name must satisfy the official `isSkillName` pattern, and the disposer
 * must remove the registration.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { RUN_CONFIGURATION_SKILL, registerRunConfigurationSkill } from '../src/host/skill.ts'

/** Minimal `skills` service standing in for dsh-skill. */
class FakeSkills extends Service {
  static current: FakeSkills | undefined

  registered: {
    name: string
    description: string
    whenToUse?: string
    source: string
    content: string
  }[] = []

  constructor(ctx: Context) {
    super(ctx, 'skills')
    FakeSkills.current = this
  }

  register(skill: {
    name: string
    description: string
    whenToUse?: string
    source: string
    content: string
  }): () => void {
    this.registered.push(skill)
    return () => {
      this.registered = this.registered.filter((entry) => entry.name !== skill.name)
    }
  }
}

describe('registerRunConfigurationSkill', () => {
  it('registers a valid skill name with a lean summary and a detailed body', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSkills)
    const dispose = registerRunConfigurationSkill(ctx)
    const skills = FakeSkills.current
    if (skills === undefined) throw new Error('skills did not mount')

    expect(skills.registered).toHaveLength(1)
    const skill = skills.registered[0]
    expect(skill.name).toBe(RUN_CONFIGURATION_SKILL)
    // Official isSkillName: lowercase letters/digits + hyphens.
    expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    // The catalog summary must stay lean (it is injected into every request).
    expect(skill.description.length).toBeLessThan(200)
    expect(skill.whenToUse?.length ?? 0).toBeGreaterThan(0)
    // The body carries the detailed guide (loaded on demand).
    expect(skill.content.length).toBeGreaterThan(500)
    expect(skill.content).toContain('## When to create vs reuse')
    expect(skill.content).toContain('## Defaults')
    expect(skill.content).toContain('## Parameters')
    expect(skill.content).toContain('## Examples')

    dispose()
    expect(skills.registered).toHaveLength(0)
  })
})
