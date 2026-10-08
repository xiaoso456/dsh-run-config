/**
 * Command-task execution: a `ctx.jobs` background job (custom `task` kind) on the platform's
 * sandboxed shell; a pending `jobs.wait` makes the settlement `awaited` so tool-jobs stays silent
 * and this plugin notifies per `notifyLlm`; cwd is the session workspace + `workspace-write` root.
 * @module @xiaoso/dsh-run-config/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: the `ctx.jobs` Context merge and the `JobKindMap` extension seat.
import type { JobId, JobKind, JobView } from '@deepseek-ai/dsh-jobs'
import { boundContextSummary, type ContextFormed, createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: the `ctx.sandboxPolicy` Context merge.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
// Type-only: the `ctx.shell` Context merge, plus the live execution handle.
import type { ShellExecution } from '@deepseek-ai/dsh-shell'
import type { TaskRecord } from './tasks.ts'

/** The custom job kind this plugin registers (declaration merge below). */
export const TASK_JOB_KIND = 'task'

/** Add the `task` kind to the jobs registry's id namespace. */
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    task: 'task'
  }
}

/**
 * Declare this plugin's own message source. 0.1.7 removed the shared catch-all
 * `plugin` kind — every producer names itself in its own module, exactly like
 * the official `tool-jobs` source.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'task-runner': { kind: 'task-runner' } & ContextFormed
  }
}

/** Max wait bound for the notice-suppression waiter (24h; jobs settle far sooner). */
const NOTICE_WAIT_MS = 86_400_000

/**
 * Brief English completion notice, aligned with the official tool-jobs shape
 * (`background job <id> (<kind>: <label>) finished [status: ...]. Read its
 * output with job_output.`) — only the `background job` head becomes
 * `User-started job`. The model reads the full output itself.
 */
export function completionNoticeText(snapshot: JobView): string {
  const status =
    snapshot.detail === undefined
      ? `[status: ${snapshot.status}]`
      : `[status: ${snapshot.status}, ${snapshot.detail}]`
  return `User-started job ${snapshot.id} (${snapshot.kind}: ${snapshot.label}) finished ${status}. Read its output with job_output.`
}

/** One-line notice summary (the collapsed transcript row). */
function completionSummary(snapshot: JobView): string {
  return boundContextSummary(`task ${snapshot.id} ${snapshot.status}`)
}

/**
 * Start one command task as a background job and wire the completion
 * notification. Requires `jobs` (with an attached controller) and `shell`.
 * @param ctx - plugin context.
 * @param task - the command task to run.
 * @param agent - the owning session agent (owner of the job).
 * @param cwd - working directory for the command (the session workspace, or the task workspace as fallback).
 * @returns the registry-issued job id.
 */
export function runCommandTask(ctx: Context, task: TaskRecord, agent: Agent, cwd: string): JobId {
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
    // 0.1.7: a job's owner is the owning SessionId, not the Agent handle.
    owner: agent.id,
    // No outputLimitBytes: the job keeps the FULL final output readable via
    // `jobs.read`/job_output; the executor's own cap bounds memory (spill
    // files carry the full stream).
    run: () => {
      // Resolve the sandbox policy from the OWNING session (its mode override
      // or the deployment default) but root it at the command's cwd: the
      // command runs with that cwd, and that is also where its writes must be
      // allowed. Without this, the shell's deployment fallback would confine
      // writes to the server's own cwd, denying any file effect in the run
      // directory (e.g. `echo ok > marker.txt` fails with exit 1).
      const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
      // A background job must not be bounded by the executor's own deadline.
      // `resolve` defaults `onExpiry` to 'kill' with a 120s `timeoutMs` (see
      // PwshLocalExecutor/LocalBashExecutor), which silently killed any command
      // task running longer than two minutes — reported as a bare
      // `[status: killed]` with no explanation. The official background tools
      // pass `onExpiry: 'none'` for exactly this reason; the job's own
      // lifecycle (cancel, owner disposal, service teardown) is what stops it.
      //
      // The job-owned `signal` is the other half: `cancel` can only reach a
      // live handle, so a kill arriving during a slow spawn/preparation would
      // otherwise be lost. Passing controller.signal lets the executor abort
      // preparation as well (the same shape the official tools use).
      const controller = new AbortController()
      const spec = shell.resolve({
        command,
        workdir: cwd,
        onExpiry: 'none',
        signal: controller.signal,
        ...(policy === undefined
          ? {}
          : { sandboxPolicy: { mode: policy.mode, workspaceRoot: cwd } }),
      })
      // 0.1.7: `execute` replaced `start` and is async, while `JobSpec.run`
      // must return its hooks synchronously — so the spawn promise is captured
      // here and the hooks below project it. The spawn still happens inside the
      // starter, i.e. after the registry's admission preflight.
      let killedReason: string | undefined
      let live: ShellExecution | undefined
      const spawned = shell.execute(spec).then(
        (proc) => {
          live = proc
          if (killedReason !== undefined) proc.kill()
          return proc
        },
        (error: unknown) => {
          // A confining executor rejects when preparation is aborted (the argv
          // step throws after the abort) — a user-requested stop, not a crash.
          // The official background tool maps exactly this shape to `killed`
          // (`processJob`: `controller.signal.aborted && process === undefined`).
          if (controller.signal.aborted) return undefined
          throw error
        },
      )
      return {
        cancel: (reason?: string) => {
          killedReason = reason
          // Abort preparation (no handle exists yet) *and* stop a live process.
          controller.abort(reason)
          live?.kill()
        },
        done: spawned.then(async (proc) => {
          if (proc === undefined) {
            // Preparation was aborted before any process existed. `detail` is
            // left to the registry, which appends the job's kill reason.
            return { status: 'killed' as const }
          }
          await proc.done
          const exitCode = proc.exitCode
          // One final read collects the whole stdout+stderr delta (buffered
          // output stays readable after exit); lossy reads carry spill paths.
          const read = proc.readOutput()
          let output = read.delta
          if (read.lossy) {
            const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter(
              (path): path is string => path !== undefined,
            )
            if (paths.length > 0) {
              output += `\n[Output truncated; read ${paths.join(', ')} for full output]`
            }
          }
          if (exitCode === 0) {
            // Match the official bash outcome: completed carries the exit
            // code detail too (`[status: completed, exit code: 0]`).
            return {
              status: 'completed' as const,
              detail: `exit code: ${exitCode}`,
              ...(output.length > 0 ? { result: output } : {}),
            }
          }
          if (proc.status === 'killed') {
            // Keep the cause: without it a deadline kill, a user `job_kill`,
            // and an owner teardown all read as a bare `[status: killed]`.
            // `killedReason` is deliberately NOT echoed here — the registry
            // appends the job's own kill reason to `detail` on settlement
            // (`dsh-jobs-local` killJob → detail `${detail}; ${killReason}`),
            // so repeating it would duplicate the text.
            const cause =
              killedReason === undefined
                ? proc.signal !== null
                  ? `signal: ${proc.signal}`
                  : 'killed before exit'
                : undefined
            return { status: 'killed' as const, ...(cause === undefined ? {} : { detail: cause }) }
          }
          return {
            status: 'failed' as const,
            ...(exitCode !== null ? { detail: `exit code: ${exitCode}` } : {}),
            ...(output.length > 0 ? { result: output } : {}),
          }
        }),
      }
    },
  })
  monitorCompletion(ctx, id, agent, task.notifyLlm !== false)
  return id
}

/**
 * Keep one `jobs.wait` pending so the settlement is reported `awaited`
 * (suppressing the tool-jobs default notice), then deliver the plugin's own
 * notification when `notify` is true. Idle agents are woken with `followup`;
 * busy agents get an `inject` so the message queues for the next step.
 */
function monitorCompletion(ctx: Context, id: JobId, owner: Agent, notify: boolean): void {
  void (async () => {
    try {
      const jobs = ctx.get('jobs')
      if (jobs === undefined) return
      // 0.1.7: the waiter is addressed by SessionId (the Agent's id), not the
      // Agent handle itself.
      let snapshot: JobView = await jobs.wait(id, NOTICE_WAIT_MS, owner.id)
      while (!isTerminal(snapshot.status)) {
        snapshot = await jobs.wait(id, NOTICE_WAIT_MS, owner.id)
      }
      if (!notify) return
      // The owner may have been disposed while the command ran.
      if (ctx.agents.get(owner.id) !== owner) return
      const message = createUserMessage({
        content: [{ type: 'text', text: completionNoticeText(snapshot) }],
        source: {
          kind: 'task-runner',
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

function isTerminal(status: JobView['status']): boolean {
  return status === 'completed' || status === 'killed' || status === 'failed'
}
