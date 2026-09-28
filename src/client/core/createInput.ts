/**
 * The run-config dialog's "New" button: the create input it will submit is
 * derived here as a pure function, so the scope semantics are unit-testable
 * without a DOM (this module imports neither React nor any browser API).
 *
 * Semantics — the same default the `task_run_config` tool applies when the
 * model omits `scope`: a new configuration belongs to the CURRENT workspace,
 * taken from the session cwd first and from the first registered workspace as
 * the fallback (the same fallback the scope switch uses). With neither, the
 * create is refused; it never falls back to `global`.
 * @module @xiaoso/dsh-run-config/client/createInput
 */

/** The `scope` / `workspacePath` pair the create call carries. */
export interface WorkspaceCreateInput {
  /** Always 'workspace': this entry point never creates global configs. */
  readonly scope: 'workspace'
  /** The workspace the configuration belongs to. */
  readonly workspacePath: string
}

/** What the dialog can offer as a workspace. */
export interface CreateInputSources {
  /** The current session's cwd, when the main view has a session with one. */
  readonly currentCwd: string | undefined
  /** Registered workspaces in registry order (only `path` is read). */
  readonly workspaces: readonly { readonly path?: string }[]
}

/** Why a create was refused (the caller renders its own message). */
export type CreateRefusal = 'no-workspace'

/** The "New" button's decision: create with this input, or refuse. */
export type CreateInputDecision =
  | { readonly kind: 'create'; readonly input: WorkspaceCreateInput }
  | { readonly kind: 'refuse'; readonly reason: CreateRefusal }

/**
 * Derive the `tasks/create` input for a new configuration.
 * @param sources - the current session cwd and the registered workspaces.
 * @returns `create` with the workspace-scoped input, or `refuse` when no
 *   workspace is available (never a silent `global` fallback).
 */
export function nextCreateInput(sources: CreateInputSources): CreateInputDecision {
  const workspacePath = sources.currentCwd ?? sources.workspaces[0]?.path
  if (workspacePath === undefined) return { kind: 'refuse', reason: 'no-workspace' }
  return { kind: 'create', input: { scope: 'workspace', workspacePath } }
}
