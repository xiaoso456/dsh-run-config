/**
 * Shared client-side state for the run control, the run-config dialog, and
 * the hero run control: the task cache, the current selection, dialog
 * visibility, and the hero → session pending-run handoff. A tiny
 * module-level snapshot store consumed through `useSyncExternalStore`.
 * @module @xiaoso/dsh-run-config/client/store
 */

import type { TaskView } from './types.ts'

/**
 * One hero → session handoff: a task the hero page asked to run, together with
 * the Session it was asked for. The target Session is part of the request —
 * only that Session's own run control may execute it.
 */
export interface PendingRun {
  /** The task to run. */
  taskId: string
  /** The Session whose run control must execute it. */
  sessionId: string
}

/** Load state of the task cache, so an empty list can be told from a pending or failed load. */
export type TaskLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Shared state held by the browser half. */
export interface TaskRunnerClientState {
  /** Task cache; `null` until the first successful load. */
  tasks: TaskView[] | null
  /**
   * Load state of `tasks`. A load failure leaves the previous cache in place
   * (a working list must not be wiped by a transient failure) and only flips
   * this to `error`, so every surface can say "failed" instead of "empty".
   */
  tasksStatus: TaskLoadStatus
  /** Message of the last failed load (`tasksStatus === 'error'`). */
  loadError: string | undefined
  /** The currently selected task id (may be invisible in the active workspace). */
  selectedId: string | undefined
  /** Whether the run-config dialog is open. */
  dialogOpen: boolean
  /**
   * Hero → session handoff: a task the hero page asked to run for one specific
   * Session, cleared by that Session's own run control once it has acted on it.
   */
  pendingRun: PendingRun | undefined
  /** Bumped after every mutation so mounted surfaces reload. */
  revision: number
}

let state: TaskRunnerClientState = {
  tasks: null,
  tasksStatus: 'idle',
  loadError: undefined,
  selectedId: undefined,
  dialogOpen: false,
  pendingRun: undefined,
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
  /** Mark a (re)load in flight; the previous cache stays readable meanwhile. */
  beginLoad(): void {
    patch({ tasksStatus: 'loading' })
  },
  setTasks(tasks: TaskView[]): void {
    patch({ tasks, tasksStatus: 'ready', loadError: undefined })
  },
  /**
   * Insert or replace ONE task in the cache, so a just-written configuration is
   * selectable before the next reload lands. The cache's own load state stays
   * out of it: `tasks === null` still means "no list yet", and a write is not a load.
   */
  upsertTask(task: TaskView): void {
    const current = state.tasks
    if (current === null) return
    const index = current.findIndex((candidate) => candidate.id === task.id)
    const next =
      index < 0 ? [...current, task] : current.map((entry, i) => (i === index ? task : entry))
    patch({ tasks: next })
  },
  /**
   * Record a failed load. `tasks` is intentionally left untouched: a failed
   * refresh must not throw away the list the user is already looking at.
   */
  setLoadError(message: string): void {
    patch({ tasksStatus: 'error', loadError: message })
  },
  setSelected(id: string | undefined): void {
    patch({ selectedId: id })
  },
  setDialogOpen(open: boolean): void {
    patch({ dialogOpen: open })
  },
  /** Record one hero → session handoff (replaces any older, unconsumed one). */
  requestPendingRun(pending: PendingRun): void {
    patch({ pendingRun: pending })
  },
  /**
   * Clear exactly this handoff. A handoff that has since been replaced by a
   * newer request stays put, so a slow consumer can never drop a newer run.
   */
  clearPendingRun(pending: PendingRun): void {
    if (state.pendingRun !== pending) return
    patch({ pendingRun: undefined })
  },
  bumpRevision(): void {
    patch({ revision: state.revision + 1 })
  },
}
