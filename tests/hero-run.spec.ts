/**
 * Hero-page run targeting (round-1 review P2).
 *
 * The hero control and the workspace chip sit on the same row. The chip renders
 * the PICKED workspace id (or its "pick a workspace" placeholder), so the run
 * control must not substitute another workspace: `HeroRunControl` used to fall
 * back to `workspaces[0]` when nothing was bound, which opened and sent into a
 * workspace the user never chose while the chip kept showing the placeholder.
 *
 * The rule lives in `core/heroRun.ts` (pure, no React) so it is asserted here;
 * the component keeps only the wiring.
 */
import { describe, expect, it } from 'vitest'
import { heroVisibleTasks, heroWorkspace } from '../src/client/core/heroRun.ts'

/** One registered workspace. */
const WORKSPACES = [
  { workspaceId: 'w-1', path: 'D:\\work\\alpha' },
  { workspaceId: 'w-2', path: 'D:\\work\\beta' },
]

/** One configuration; only the fields the hero filter reads matter. */
function task(
  id: string,
  type: 'llm' | 'command',
  scope: 'global' | 'workspace',
  workspacePath?: string,
): { id: string; type: 'llm' | 'command'; scope: 'global' | 'workspace'; workspacePath?: string } {
  return { id, type, scope, ...(workspacePath === undefined ? {} : { workspacePath }) }
}

const CACHE = [
  task('global-llm', 'llm', 'global'),
  task('alpha-llm', 'llm', 'workspace', 'D:\\work\\alpha'),
  task('beta-llm', 'llm', 'workspace', 'D:\\work\\beta'),
  task('alpha-command', 'command', 'workspace', 'D:\\work\\alpha'),
  task('global-command', 'command', 'global'),
]

describe('heroWorkspace (the hero run target)', () => {
  it('returns the workspace the chip picked', () => {
    expect(heroWorkspace(WORKSPACES, 'w-2')).toEqual({ workspaceId: 'w-2', path: 'D:\\work\\beta' })
  })

  it('NEVER falls back to the first workspace when nothing is picked', () => {
    // The regression: this used to return WORKSPACES[0], so pressing ▶ with an
    // unbound chip opened and sent into 'D:\work\alpha'.
    expect(heroWorkspace(WORKSPACES, undefined)).toBeUndefined()
  })

  it('returns undefined for an id the registry no longer holds (stale selection)', () => {
    expect(heroWorkspace(WORKSPACES, 'w-gone')).toBeUndefined()
  })

  it('has no fallback even with a single registered workspace', () => {
    expect(
      heroWorkspace([{ workspaceId: 'w-only', path: 'D:\\work\\only' }], undefined),
    ).toBeUndefined()
  })
})

describe('heroVisibleTasks (what the hero may run)', () => {
  it('lists only global LLM configurations when no workspace is picked', () => {
    // With nothing picked the control must not offer another workspace's
    // configurations — the target it would run them in does not exist.
    expect(heroVisibleTasks(CACHE, undefined).map((entry) => entry.id)).toEqual(['global-llm'])
  })

  it('adds the picked workspace’s LLM configurations, and nothing else', () => {
    expect(heroVisibleTasks(CACHE, 'D:\\work\\beta').map((entry) => entry.id)).toEqual([
      'global-llm',
      'beta-llm',
    ])
  })

  it('never offers command configurations (a blank hero has no session to run them in)', () => {
    const ids = heroVisibleTasks(CACHE, 'D:\\work\\alpha').map((entry) => entry.id)
    expect(ids).toEqual(['global-llm', 'alpha-llm'])
    expect(ids).not.toContain('alpha-command')
    expect(ids).not.toContain('global-command')
  })
})
