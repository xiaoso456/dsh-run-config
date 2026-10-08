/**
 * Hero-page run targeting: which workspace the hero control acts on, and which
 * configurations it may run there. Extracted from `HeroRunControl` as pure
 * functions (no React, no browser API) so the rule that a hero run NEVER
 * substitutes a workspace the user did not pick can be asserted without a DOM.
 * @module @xiaoso/dsh-run-config/client/heroRun
 */

/** The workspace shape the hero control reads (a `useWorkspaces` item). */
export interface HeroWorkspace {
  workspaceId: string
  path: string
}

/** The configuration shape the hero filter reads. */
export interface HeroTask {
  type: string
  scope: string
  workspacePath?: string
}

/**
 * The workspace a hero run targets: ONLY the one the user picked.
 *
 * There is deliberately no fallback to `workspaces[0]`. The chip on the same row
 * renders the picked id (or its "pick a workspace" placeholder), so a fallback
 * would make the run control open and send into a workspace the user never
 * chose.
 * @param workspaces - the registered workspaces, in registry order.
 * @param selectedId - the workspace the owner's chip currently shows.
 * @returns the picked workspace, or `undefined` when nothing is picked.
 */
export function heroWorkspace<W extends HeroWorkspace>(
  workspaces: readonly W[],
  selectedId: string | undefined,
): W | undefined {
  if (selectedId === undefined) return undefined
  return workspaces.find((workspace) => workspace.workspaceId === selectedId)
}

/**
 * The configurations the hero control can run: `llm` only (a blank hero has no
 * session to run a command against), being every global one plus, with a picked
 * workspace, the ones bound to it.
 * @param tasks - the loaded configuration cache.
 * @param workspacePath - the picked workspace's path, or `undefined` when none is picked.
 * @returns the runnable configurations, in cache order.
 */
export function heroVisibleTasks<T extends HeroTask>(
  tasks: readonly T[],
  workspacePath: string | undefined,
): T[] {
  return tasks.filter((task) => {
    if (task.type !== 'llm') return false
    if (task.scope === 'global') return true
    return task.scope === 'workspace' && task.workspacePath === workspacePath
  })
}
