/**
 * Client-side caller for the task-runner Host endpoints. The Host serves one
 * exact Fetch route per endpoint on the Connection shared API channel, so the
 * caller goes through the same `/api` carrier (and its browser-session policy)
 * as every other browser RPC.
 * @module @xiaoso/dsh-run-config/client/rpc
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { TASK_RUNNER_CHANNEL, taskRunnerEndpointName } from '../../shared/wire.ts'
import type { TaskRunnerRpcMap } from './types.ts'

/** Minimal structural view of a channel result (the connection transport returns this envelope). */
export interface ChannelResult {
  ok: boolean
  value?: unknown
  error?: { code?: string; message: string }
}

/** The RPC caller face the client components need. */
export interface TaskRunnerRpc {
  call<K extends keyof TaskRunnerRpcMap>(
    endpoint: K,
    args: TaskRunnerRpcMap[K]['args'],
  ): Promise<TaskRunnerRpcMap[K]['result']>
}

/** Build the typed caller over the connection's generic RPC face. */
export function createTaskRunnerRpc(connection: ConnectionHandle): TaskRunnerRpc {
  return {
    async call(endpoint, args) {
      const result = (await connection.rpc.call(
        TASK_RUNNER_CHANNEL,
        taskRunnerEndpointName(endpoint),
        args,
      )) as unknown as ChannelResult
      if (!result.ok) {
        throw new Error(result.error?.message ?? `${endpoint} failed`)
      }
      return result.value as never
    },
  }
}
