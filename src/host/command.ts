/**
 * Command-task execution: starts a background job through `ctx.jobs` with the
 * custom `task` kind, runs the command on the DSH `shell` service (cwd = the
 * task's workspace path; the concrete shell is the platform's sandboxed one —
 * bash on POSIX, PowerShell on win32), suppresses the tool-jobs default notice
 * by keeping a `jobs.wait` pending (settlement marks the job `reported`), and
 * then sends the plugin's own fixed-template completion message per
 * `notifyLlm` (locale zh/en, including the "user-started" marker).
 *
 * Sandbox policy: the shell call passes the owning session's resolved mode
 * with the TASK's workspace as the `workspace-write` root, so a command may
 * write inside the workspace it was defined for regardless of the server's
 * deployment cwd, while every other file effect stays confined to that root.
 * @module @xiaoso/dsh-task-runner/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: the `ctx.jobs` Context merge and the `JobKindMap` extension seat.
import type { JobId, JobKind, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: the `ctx.sandboxPolicy` Context merge.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
// Type-only: the `ctx.shell` Context merge.
import type {} from '@deepseek-ai/dsh-shell'
import type { TaskRecord } from './tasks.ts'

/** The custom job kind this plugin registers (declaration merge below). */
export const TASK_JOB_KIND = 'task'

/** Add the `task` kind to the jobs registry's id namespace. */
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    task: 'task'
  }
}

/** Max wait bound for the notice-suppression waiter (24h; jobs settle far sooner). */
const NOTICE_WAIT_MS = 86_400_000

/** Fixed completion templates per plan §2.6 (locale chosen by the client at run time). */
export function completionNoticeText(snapshot: JobSnapshot, locale: string): string {
  const status =
    snapshot.detail === undefined
      ? `[status: ${snapshot.status}]`
      : `[status: ${snapshot.status}, ${snapshot.detail}]`
  if (locale.startsWith('zh')) {
    return `后台任务 ${snapshot.id}「${snapshot.label}」已完成（用户手动启动）${status}`
  }
  return `Background job ${snapshot.id} "${snapshot.label}" finished (user-started) ${status}`
}

/** One-line notice summary (the collapsed transcript row). */
function completionSummary(snapshot: JobSnapshot): string {
  return boundContextSummary(`task ${snapshot.id} ${snapshot.status}`)
}

/**
 * Start one command task as a background job and wire the completion
 * notification. Requires `jobs` (with an attached controller) and `shell`.
 * @param ctx - plugin context.
 * @param task - the command task to run.
 * @param agent - the owning session agent (owner of the job).
 * @param cwd - working directory for the command (the workspace path).
 * @param locale - client locale ('zh' | 'en') choosing the notification template.
 * @returns the registry-issued job id.
 */
export function runCommandTask(
  ctx: Context,
  task: TaskRecord,
  agent: Agent,
  cwd: string,
  locale: string,
): JobId {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) {
    throw new Error(
      'background jobs unavailable: load @deepseek-ai/dsh-jobs and a controller such as @deepseek-ai/dsh-tool-jobs',
    )
  }
  const shell = ctx.get('shell')
  if (shell === undefined) {
    throw new Error(
      'shell service unavailable: load a shell implementation (e.g. @deepseek-ai/dsh-shell-bash-local)',
    )
  }
  const command = task.command ?? ''
  if (command.trim().length === 0) {
    throw new Error('command task has an empty command')
  }
  const id = jobs.start({
    kind: TASK_JOB_KIND as JobKind,
    label: task.name,
    owner: agent,
    run: () => {
      // Resolve the sandbox policy from the OWNING session (its mode override
      // or the deployment default) but root it at the task's workspace: the
      // command runs with cwd = the task workspace, and that is also where its
      // writes must be allowed. Without this, the shell's deployment fallback
      // would confine writes to the server's own cwd, denying any file effect
      // in the task workspace (e.g. `echo ok > marker.txt` fails with exit 1).
      const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
      const spec = shell.resolve({
        command,
        workdir: cwd,
        ...(policy === undefined
          ? {}
          : { sandboxPolicy: { mode: policy.mode, workspaceRoot: cwd } }),
      })
      const proc = shell.start(spec)
      return {
        cancel: (reason?: string) => {
          void reason
          proc.kill()
        },
        done: proc.done.then(() => {
          const exitCode = proc.exitCode
          if (exitCode === 0) return { status: 'completed' as const }
          if (proc.status === 'killed') return { status: 'killed' as const }
          return {
            status: 'failed' as const,
            ...(exitCode !== null ? { detail: `exit code: ${exitCode}` } : {}),
          }
        }),
      }
    },
  })
  monitorCompletion(ctx, id, agent, task.notifyLlm !== false, locale)
  return id
}

/**
 * Keep one `jobs.wait` pending so settlement marks the job `reported`
 * (suppressing the tool-jobs default notice), then deliver the plugin's own
 * notification when `notify` is true. Idle agents are woken with `followup`;
 * busy agents get an `inject` so the message queues for the next step.
 */
function monitorCompletion(
  ctx: Context,
  id: JobId,
  owner: Agent,
  notify: boolean,
  locale: string,
): void {
  void (async () => {
    try {
      const jobs = ctx.get('jobs')
      if (jobs === undefined) return
      let snapshot: JobSnapshot = await jobs.wait(id, NOTICE_WAIT_MS, owner)
      while (!isTerminal(snapshot.status)) {
        snapshot = await jobs.wait(id, NOTICE_WAIT_MS, owner)
      }
      if (!notify) return
      // The owner may have been disposed while the command ran.
      if (ctx.agents.get(owner.id) !== owner) return
      const message = createUserMessage({
        content: [{ type: 'text', text: completionNoticeText(snapshot, locale) }],
        source: {
          kind: 'plugin',
          plugin: 'task-runner',
          form: 'notice',
          summary: completionSummary(snapshot),
        },
      })
      if (owner.status === 'idle') owner.followup(message)
      else owner.inject(message)
    } catch (error) {
      ctx.logger.warn(`[task-runner] completion monitor for job ${id} failed: ${String(error)}`)
    }
  })()
}

function isTerminal(status: JobSnapshot['status']): boolean {
  return status === 'completed' || status === 'killed' || status === 'failed'
}
