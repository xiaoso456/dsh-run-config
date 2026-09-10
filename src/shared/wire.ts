/**
 * Browser↔Host wire constants for the task-runner RPC. Both halves must agree:
 * the Host registers one exact Fetch route per endpoint on the Connection
 * shared API channel, and the browser calls the same logical endpoint on that
 * channel. They live together so the two bundles cannot drift.
 * @module @xiaoso/dsh-run-config/shared/wire
 */

/**
 * The Connection channel carrying our calls. `/api` is the ONLY carrier-owned
 * browser entry point (`rpc.handle` rejects it as reserved): exact Fetch routes
 * registered there are served by whichever physical carrier is present, and
 * that carrier applies its Host/Origin + browser-session policy before the
 * handler runs. Our own channels were dropped because a private channel prefix
 * can only be mounted by the Web carrier through `connection.rpc.handle`, which
 * no longer resolves the registering context's `webServer` on dsh 0.1.5.
 */
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
