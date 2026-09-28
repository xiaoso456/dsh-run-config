/**
 * The run-config dialog's editable draft: the form's working copy of one task
 * plus the rules around it (pure, so they are asserted without a DOM).
 *
 * - `toDraft` / `sameAsTask` normalize the optional text fields on BOTH sides:
 *   the Host stores `''` and "absent" alike (`src/host/tasks.ts` accepts an
 *   empty prompt), so folding one side only makes `dirty` permanently true for
 *   such a record.
 * - `draftSignature` is what the dialog keys its "rebuild the form" effect on.
 *   It is stable across a reorder (order changes, values do not) and moves
 *   whenever a committed value does.
 * @module @xiaoso/dsh-run-config/client/draft
 */

import type { TaskScope, TaskType, TaskView } from './types.ts'

/** Editable form fields for one task. */
export interface TaskDraft {
  name: string
  description: string
  type: TaskType
  scope: TaskScope
  workspacePath: string
  llmPrompt: string
  autoSend: boolean
  command: string
  notifyLlm: boolean
}

/**
 * The optional text fields compared as "unset" for both `''` and `undefined`,
 * which is the single meaning the Host gives them.
 * @param value - the field value from either side of the comparison.
 * @returns `undefined` when the field carries nothing, the value otherwise.
 */
function optionalText(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

/**
 * Build the form's working copy of a task.
 * @param task - the task as stored on the Host.
 * @returns the editable draft.
 */
export function toDraft(task: TaskView): TaskDraft {
  return {
    name: task.name,
    description: task.description ?? '',
    type: task.type,
    scope: task.scope,
    workspacePath: task.workspacePath ?? '',
    llmPrompt: task.llmPrompt ?? '',
    autoSend: task.autoSend ?? true,
    command: task.command ?? '',
    notifyLlm: task.notifyLlm ?? true,
  }
}

/**
 * Whether the draft still equals the task it was built from.
 * @param draft - the current form contents.
 * @param task - the stored task.
 * @returns `true` when saving would change nothing.
 */
export function sameAsTask(draft: TaskDraft, task: TaskView): boolean {
  return (
    draft.name === task.name &&
    optionalText(draft.description) === optionalText(task.description) &&
    draft.type === task.type &&
    draft.scope === task.scope &&
    optionalText(draft.workspacePath) === optionalText(task.workspacePath) &&
    optionalText(draft.llmPrompt) === optionalText(task.llmPrompt) &&
    draft.autoSend === (task.autoSend ?? true) &&
    optionalText(draft.command) === optionalText(task.command) &&
    draft.notifyLlm === (task.notifyLlm ?? true)
  )
}

/**
 * The task's editable value as a comparable string. Field ORDER follows
 * {@link TaskDraft}; the dialog rebuilds its form exactly when this changes.
 * @param task - the stored task.
 * @returns a stable signature of the task's editable fields.
 */
export function draftSignature(task: TaskView): string {
  const draft = toDraft(task)
  return JSON.stringify([
    draft.name,
    draft.description,
    draft.type,
    draft.scope,
    draft.workspacePath,
    draft.llmPrompt,
    draft.autoSend,
    draft.command,
    draft.notifyLlm,
  ])
}
