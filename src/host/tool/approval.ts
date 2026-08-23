/**
 * Approval gate for the `task_run_config` tool, following the official
 * `tools/pre-execute` pattern: a guard returning `{ kind: 'ask' }` makes the
 * ToolRuntime resolve the decision through the standard approval seam
 * (`serviceAsk` → `approval.request`), while `{ kind: 'allow' }` skips
 * approval entirely. The tool body itself never touches approval — see
 * `./tool.ts` for the tool definition.
 * @module @xiaoso/dsh-run-config/approval
 */

import type { Context } from '@deepseek-ai/cordis'
import { getApprovalLocale } from '../locale.ts'
import type { TaskRunnerAction, TaskRunnerToolArgs } from './tool.ts'

/** Write actions that go through the approval gate. */
const WRITE_ACTIONS: readonly TaskRunnerAction[] = ['create', 'update', 'delete', 'duplicate']

/** Decision returned by a `tools/pre-execute` guard. */
export type TaskRunnerGateDecision =
  | { kind: 'allow' }
  | { kind: 'ask'; reason: string }
  | { kind: 'deny'; reason: string }

/** One-line approval reason shown in the approval prompt (i18n: zh/en). */
function writeApprovalReason(
  action: TaskRunnerAction,
  args: TaskRunnerToolArgs,
  locale: 'zh' | 'en',
): string {
  const plugin = locale === 'zh' ? '【dsh-run-config】' : '[dsh-run-config] '
  const typeName = (type: string | undefined): string =>
    locale === 'zh'
      ? type === 'command'
        ? '命令配置'
        : 'LLM 配置'
      : type === 'command'
        ? 'command'
        : 'LLM'
  const scopeName = (scope: string | undefined): string =>
    locale === 'zh'
      ? scope === 'global'
        ? '全局'
        : '工作区'
      : scope === 'global'
        ? 'global'
        : 'workspace'
  switch (action) {
    case 'create':
      return (
        plugin +
        (locale === 'zh'
          ? `创建任务运行配置「${args.name ?? ''}」（${typeName(args.type)}，${scopeName(args.scope)}）`
          : `Create run configuration "${args.name ?? ''}" (${typeName(args.type)}, ${scopeName(args.scope)})`)
      )
    case 'update':
      return locale === 'zh'
        ? `${plugin}更新任务运行配置「${args.id ?? ''}」`
        : `${plugin}Update run configuration "${args.id ?? ''}"`
    case 'delete':
      return locale === 'zh'
        ? `${plugin}删除任务运行配置「${args.id ?? ''}」`
        : `${plugin}Delete run configuration "${args.id ?? ''}"`
    case 'duplicate':
      return locale === 'zh'
        ? `${plugin}复制任务运行配置「${args.id ?? ''}」`
        : `${plugin}Duplicate run configuration "${args.id ?? ''}"`
    default:
      return locale === 'zh'
        ? `${plugin}管理任务运行配置（${action}）`
        : `${plugin}Manage run configuration (${action})`
  }
}

/**
 * Official-pattern approval decision for `task_run_config` (pure,
 * unit-testable). Per the official permission-presets semantics, a session
 * with `danger-full-access` sandbox mode needs no approval for write
 * actions — the sandbox mode is the deployment's policy; the tool itself
 * never touches `approval` directly.
 *
 * Returns `undefined` for anything the gate does not cover (other tools and
 * the read-only `list` action), so the waterfall falls through to the next
 * guard.
 */
export function decideTaskRunnerApproval(
  execName: string,
  action: string | undefined,
  args: TaskRunnerToolArgs,
  mode: string | undefined,
  locale: 'zh' | 'en' = 'en',
): TaskRunnerGateDecision | undefined {
  if (execName !== 'task_run_config') return undefined
  if (typeof action !== 'string' || !WRITE_ACTIONS.includes(action as TaskRunnerAction)) {
    return undefined
  }
  const typed = action as TaskRunnerAction
  if (mode === 'danger-full-access') return { kind: 'allow' }
  return { kind: 'ask', reason: writeApprovalReason(typed, args, locale) }
}

/**
 * Register the official-pattern approval gate for `task_run_config`
 * write actions on `tools/pre-execute` (returns the exact disposer).
 *
 * The gate resolves the session's sandbox mode through the optional
 * `sandboxPolicy` service (`ctx.get` — never injected, matching the harness
 * convention). `danger-full-access` → allow without approval; anything else
 * → `ask`, which the ToolRuntime resolves through the standard approval
 * seam (UI prompt + audit). A missing sandboxPolicy service fails closed to
 * `ask`. Guards covering other tools fall through via `next()`.
 */
export function registerTaskRunnerApprovalGate(ctx: Context): () => void {
  return ctx.on('tools/pre-execute', async (exec, next) => {
    const policy = ctx.get('sandboxPolicy')
    const mode = policy?.resolve({ session: exec.agent?.session }).mode
    const arguments_ = exec.arguments as Record<string, unknown> | undefined
    const decision = decideTaskRunnerApproval(
      exec.name,
      arguments_?.action as string | undefined,
      arguments_ as unknown as TaskRunnerToolArgs,
      mode,
      getApprovalLocale(),
    )
    return decision ?? next()
  })
}
