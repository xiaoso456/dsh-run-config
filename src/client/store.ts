/**
 * Shared client-side state for the run control, the run-config dialog, and
 * the hero run control: the task cache, the current selection, dialog
 * visibility, and the hero → session pending-run handoff. A tiny
 * module-level snapshot store consumed through `useSyncExternalStore`.
 * @module @xiaoso/dsh-task-runner/client/store
 */

import type { TaskView } from './types.ts'

/** Shared state held by the browser half. */
export interface TaskRunnerClientState {
  /** Task cache; `null` until the first successful load. */
  tasks: TaskView[] | null
  /** The currently selected task id (may be invisible in the active workspace). */
  selectedId: string | undefined
  /** Whether the run-config dialog is open. */
  dialogOpen: boolean
  /**
   * Hero → session handoff: a task the hero page asked to run; the session
   * header consumes it once its session is current and clears it.
   */
  pendingRunId: string | undefined
  /** Bumped after every mutation so mounted surfaces reload. */
  revision: number
}

let state: TaskRunnerClientState = {
  tasks: null,
  selectedId: undefined,
  dialogOpen: false,
  pendingRunId: undefined,
  revision: 0,
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[task-runner] store listener failed:', error)
    }
  }
}

function patch(next: Partial<TaskRunnerClientState>): void {
  state = { ...state, ...next }
  emit()
}

/** The module-level store: subscribe via `useSyncExternalStore`. */
export const taskRunnerStore = {
  getSnapshot: (): TaskRunnerClientState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  setTasks(tasks: TaskView[]): void {
    patch({ tasks })
  },
  setSelected(id: string | undefined): void {
    patch({ selectedId: id })
  },
  setDialogOpen(open: boolean): void {
    patch({ dialogOpen: open })
  },
  requestPendingRun(id: string | undefined): void {
    patch({ pendingRunId: id })
  },
  consumePendingRun(): string | undefined {
    const id = state.pendingRunId
    if (id !== undefined) patch({ pendingRunId: undefined })
    return id
  },
  bumpRevision(): void {
    patch({ revision: state.revision + 1 })
  },
}
