/**
 * Client-side copies of the task model and RPC payloads. The browser half
 * must not depend on the Host package, so these shapes are spelled here
 * (official convention: the client spells the same values the Host registers).
 * @module @xiaoso/dsh-run-config/client/types
 */

/** Task type: `llm` sends a prompt into the current session; `command` runs a bash command in the background. */
export type TaskType = 'llm' | 'command'

/** Visibility scope. `global` shows in every workspace; `workspace` only in the declared one. */
export type TaskScope = 'global' | 'workspace'

/** One run configuration (mirror of the host TaskRecord). */
export interface TaskView {
  id: string
  name: string
  /** Optional note describing what this task does. */
  description?: string
  type: TaskType
  scope: TaskScope
  workspacePath?: string
  llmPrompt?: string
  command?: string
  notifyLlm?: boolean
  createdAt: string
  updatedAt: string
}

/** Input accepted by `tasks/create`. */
export interface TaskCreateInput {
  name: string
  description?: string
  type: TaskType
  scope: TaskScope
  workspacePath?: string
  llmPrompt?: string
  command?: string
  notifyLlm?: boolean
}

/** Payloads for the `/task-runner` RPC endpoints. */
export interface TaskRunnerRpcMap {
  'client/locale': { args: { locale: string }; result: Record<string, never> }
  'tasks/list': { args: Record<string, never>; result: { tasks: TaskView[] } }
  'tasks/create': { args: TaskCreateInput; result: { task: TaskView } }
  'tasks/update': {
    args: { id: string; patch: Partial<TaskCreateInput> }
    result: { task: TaskView }
  }
  'tasks/delete': { args: { id: string }; result: { deleted: boolean } }
  'tasks/duplicate': { args: { id: string }; result: { task: TaskView } }
  'tasks/reorder': { args: { ids: string[] }; result: Record<string, never> }
  'tasks/run': {
    args: { id: string; sessionId: string; locale: string }
    result: { jobId: string }
  }
}
