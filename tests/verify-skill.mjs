/**
 * Runtime verification against the REAL dsh-skill registry (imported from the
 * project node_modules, like verify-tool-schema.mjs): mounting SkillRegistry
 * on a cordis Context, registering the run-configuration skill through our
 * plugin code, and asserting it appears in the catalog and loads its full
 * body on demand.
 *
 * Not part of `pnpm test`; run manually:
 *   node --experimental-strip-types tests/verify-skill.mjs
 */

import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { RUN_CONFIGURATION_SKILL, registerRunConfigurationSkill } from '../src/host/skill.ts'

const ctx = new Context()
await ctx.plugin(SkillRegistry)

const dispose = registerRunConfigurationSkill(ctx)

const catalog = await ctx.skills.list({})
const found = catalog.find((skill) => skill.name === RUN_CONFIGURATION_SKILL)
console.log('catalog names:', JSON.stringify(catalog.map((s) => s.name)))
console.log(
  'catalog entry:',
  found
    ? {
        name: found.name,
        description: found.description.slice(0, 90),
        whenToUse: found.whenToUse?.slice(0, 60),
      }
    : null,
)

const loaded = await ctx.skills.get(RUN_CONFIGURATION_SKILL, {})
console.log('loaded body length:', loaded?.content.length)
console.log('body head:', loaded?.content.slice(0, 80).replace(/\n/g, '|'))

dispose()
const after = await ctx.skills.list({})
console.log(
  'present after dispose:',
  after.some((s) => s.name === RUN_CONFIGURATION_SKILL),
)

const pass =
  found !== undefined &&
  loaded !== undefined &&
  loaded.content.length > 500 &&
  !after.some((s) => s.name === RUN_CONFIGURATION_SKILL)
process.exit(pass ? 0 : 1)
