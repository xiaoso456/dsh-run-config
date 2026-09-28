/**
 * Client-side copies of the task model and RPC payloads. The browser half
 * must not depend on the Host package, so these shapes are spelled here
 * (official convention: the client spells the same values the Host registers).
 * @module @xiaoso/dsh-run-config/client/types
 */

import type { TaskRunnerEndpoint } from '../../shared/wire.ts'

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
  /** type === 'llm': whether running sends the prompt immediately (default true; false fills the composer only). */
  autoSend?: boolean
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
  /** type === 'llm': whether running sends the prompt immediately (default true). */
  autoSend?: boolean
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
  /** Run ONE COMMAND task as a background job; other types are rejected. No `locale` argument. */
  'tasks/run': {
    args: { id: string; sessionId: string }
    result: { jobId: string }
  }
}

/**
 * Every endpoint `TASK_RUNNER_ENDPOINTS` declares must have a typed entry above:
 * a new wire endpoint without one of these members is a compile error, so the
 * browser half cannot fall behind the single source in `shared/wire.ts`
 * (type-checking alone never compared the two lists).
 */
export const TASK_RUNNER_RPC_COVERAGE: Record<TaskRunnerEndpoint, keyof TaskRunnerRpcMap> = {
  'client/locale': 'client/locale',
  'tasks/list': 'tasks/list',
  'tasks/create': 'tasks/create',
  'tasks/update': 'tasks/update',
  'tasks/delete': 'tasks/delete',
  'tasks/duplicate': 'tasks/duplicate',
  'tasks/reorder': 'tasks/reorder',
  'tasks/run': 'tasks/run',
}
