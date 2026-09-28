/**
 * Browser↔Host wire constants for the task-runner RPC. Both halves must agree:
 * the Host registers one exact Fetch route per endpoint on the Connection
 * shared API channel, and the browser calls the same logical endpoint on that
 * channel. They live together so the two bundles cannot drift.
 * @module @xiaoso/dsh-run-config/shared/wire
 */

/** The Connection channel carrying our calls: the one carrier-owned browser entry point. */
export const TASK_RUNNER_CHANNEL = '/api'

/** Endpoint namespace inside the shared channel (keeps our routes disjoint). */
export const TASK_RUNNER_NAMESPACE = 'task-runner'

/** Every endpoint the Host serves; one exact POST route each. */
export const TASK_RUNNER_ENDPOINTS = [
  'client/locale',
  'tasks/list',
  'tasks/create',
  'tasks/update',
  'tasks/delete',
  'tasks/duplicate',
  'tasks/reorder',
  // Generic-looking but COMMAND-ONLY: the handler rejects any other task type,
  // and LLM configurations never call it (their run is the browser's standard
  // send flow). Kept as-is rather than renamed so the wire stays stable.
  'tasks/run',
] as const

/** One endpoint name this plugin owns. */
export type TaskRunnerEndpoint = (typeof TASK_RUNNER_ENDPOINTS)[number]

/**
 * Absolute path of one endpoint's exact Fetch route.
 * @param endpoint - endpoint name such as `tasks/list`.
 * @returns the path below `/api` the Host registers for it.
 */
export function taskRunnerRoutePath(endpoint: string): string {
  return `${TASK_RUNNER_CHANNEL}/${TASK_RUNNER_NAMESPACE}/${endpoint}`
}

/**
 * Logical endpoint the browser calls on the shared channel.
 * @param endpoint - endpoint name such as `tasks/list`.
 * @returns the endpoint segment pair the caller passes to `connection.rpc.call`.
 */
export function taskRunnerEndpointName(endpoint: string): string {
  return `${TASK_RUNNER_NAMESPACE}/${endpoint}`
}
