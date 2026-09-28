/**
 * dsh-run-config, browser half. Registers the session-header run control
 * (`conversation.session.header.utilities`), the run-config dialog
 * (`shell.overlay`), and the hero composite (`conversation.hero.workspace`,
 * shadowing the default picker at a lower priority), and wires the
 * `/task-runner` RPC caller plus the `task-runner` settings scope.
 * @module @xiaoso/dsh-run-config/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the `ctx.sessions` client merge (Session object layer + scopes)
// and its `ISessions` face.
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `ctx.workspaces` Context merge (pure Workspace Controller).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the `ctx.locale` Context merge (dictionary registration).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the session-header slot declaration + standard kit (inputActions).
// Type-only: the hero slot declaration (EmptyWorkspaceOwnerProps) and the
// session-addressed input facade face (`ctx.conversation.input`).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the `shell.overlay` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the `ctx.slots` Context merge (renderer-owned UI registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the session standard props (sessionId / useSessions / useSession)
// and the ui-session service merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the `ctx.configForms` Context merge (shared config forms + writes).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `ctx.uiWorkspace` Context merge (workspace navigation).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { HeroRunControl, type HeroRunControlInjected } from './components/HeroRunControl.tsx'
import {
  RunConfigDialog,
  type RunConfigDialogInjected,
  type TaskRunnerDialogSettings,
} from './components/RunConfigDialog.tsx'
import { RunControl, type RunControlInjected } from './components/RunControl.tsx'
import { en, NS, zh } from './core/locales.ts'
import { createTaskRunnerRpc } from './core/rpc.ts'

/** Required services: slots (registration), locale, the wire, the shared configuration forms, the session-addressed conversation input facade (hero LLM runs), the Session object layer, workspace navigation, and the pure workspace controller. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'configForms',
  'conversation',
  'sessions',
  'workspaces',
  'uiWorkspace',
]

/**
 * Mount the task-runner UI.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'task-runner: dictionaries')

  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const rpc = createTaskRunnerRpc(connection)
  // The plugin's live configuration (the `task-runner` profile entry's volatile
  // fields). 0.1.7 replaced the settings scope binder with the shared config
  // forms; `set` resolves `false` for a Host refusal instead of rejecting.
  const settings = ctx.configForms.get<TaskRunnerDialogSettings>('task-runner')
  const getActiveLocale = (): string => ctx.locale.getLocale().active

  // A blank session renders NO header, so the shared pending slot has no consumer
  // on the hero page; hero runs therefore go through the official
  // `uiWorkspace.openWorkspace`, delivering inside its synchronous `beforeOpen`.
  const conversation = ctx.conversation
  // dsh's two halves share the `sessions` Context key (`@deepseek-ai/dsh-session`
  // declares it for the HOST store); this file needs the browser-side `ISessions`.
  const sessions = ctx.get('sessions') as unknown as ISessions
  /**
   * Deliver one LLM task into a session's composer through the official
   * session-addressed input facade (`setDraft` + `submit` = the standard send
   * flow). Call it while the target session's scope is retained (the
   * `openWorkspace` → `beforeOpen` window).
   * @param sessionId - the retained target session.
   * @param prompt - the configuration's prompt.
   * @param autoSend - submit immediately, or only fill the composer.
   * @throws when the session has no retained scope, or when the facade itself
   * refuses the scope (`conversation.input.for` throws — it never returns
   * undefined). The caller must surface that failure and keep the run.
   */
  const deliverLlmTask = (sessionId: SessionId, prompt: string, autoSend: boolean): void => {
    const binding = sessions.binding(sessionId)
    if (binding === undefined) {
      throw new Error(`session ${sessionId} has no retained scope; the run was not delivered`)
    }
    const input = conversation.input.for(binding.ctx)
    input.setDraft(prompt)
    if (autoSend) input.submit()
  }

  // Report the UI locale to the Host so the approval gate renders its reason
  // in the user's language (fire-and-forget; the gate falls back to 'en').
  void rpc.call('client/locale', { locale: getActiveLocale() }).catch(() => {})

  // Session header: ▶ run + task picker + ⚙ config. Registered into the
  // header UTILITIES cluster with an order BELOW the official "Session log"
  // button (default 0), so the run control sits directly left of the log
  // entry, on the same row.
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: 'task-runner',
        order: -10,
        locale: NS,
        inject: (): RunControlInjected => ({ rpc }),
      },
      RunControl,
    ),
  )

  // Run-config dialog (IDEA style) + the "expose tool to LLM" switch.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'task-runner-dialog',
        order: 100,
        locale: NS,
        inject: (): RunConfigDialogInjected => ({ rpc, settings }),
      },
      RunConfigDialog,
    ),
  )

  // Hero page: composite (workspace picker + run control) shadowing the
  // default picker at a lower priority (lowest priority renders). An LLM run
  // opened from here rides the official navigation action: `openWorkspace`
  // retains the target Session (mainView) and hands the retained id to
  // `beforeOpen`, which is where the task is delivered. If that delivery fails,
  // the request is handed to the target Session's own run control through the
  // session-addressed pending slot instead of being dropped.
  ctx.slots.inject('conversation.hero.workspace', () =>
    ctx.slots.register(
      {
        name: 'conversation.hero.workspace',
        priority: -10,
        locale: NS,
        inject: (): HeroRunControlInjected => ({
          rpc,
          openWorkspace: (workspaceId, beforeOpen) =>
            ctx.uiWorkspace.openWorkspace(workspaceId, beforeOpen),
          createWorkspace: (input) => ctx.workspaces.create({ path: input }),
          deliverLlmTask,
        }),
      },
      HeroRunControl,
    ),
  )
}
