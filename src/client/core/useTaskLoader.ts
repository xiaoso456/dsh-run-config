/**
 * Shared task-loading hook: loads the task cache once and after every
 * mutation revision, and reports load failures to the caller. The error
 * callback rides a ref so its identity never re-triggers the load loop.
 * @module @xiaoso/dsh-run-config/client/useTaskLoader
 */

import { useEffect, useRef } from 'react'
import type { TaskRunnerRpc } from './rpc.ts'
import { taskRunnerStore } from './store.ts'

/**
 * Load tasks into the shared store on mount and after every mutation
 * revision. `onError` receives load failures (transient UI feedback).
 * @param rpc - the task-runner RPC caller.
 * @param revision - the store revision (bumped after every mutation).
 * @param onError - failure callback (called once per failed load).
 */
export function useTaskLoader(
  rpc: TaskRunnerRpc,
  revision: number,
  onError: (message: string) => void,
): void {
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    void rpc
      .call('tasks/list', {})
      .then((res) => {
        if (cancelled) return
        taskRunnerStore.setTasks(res.tasks)
      })
      .catch((error) => {
        if (cancelled) return
        onErrorRef.current(String(error instanceof Error ? error.message : error))
      })
    return () => {
      cancelled = true
    }
  }, [revision, rpc])
}
