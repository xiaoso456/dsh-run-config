/**
 * dsh-run-config, browser half. Registers the session-header run control
 * (`conversation.session.header.utilities`), the run-config dialog
 * (`shell.overlay`), and the hero composite (`conversation.hero.workspace`,
 * shadowing the default picker at a lower priority), and wires the
 * `/task-runner` RPC caller plus the `task-runner` settings scope.
 * @module @xiaoso/dsh-run-config/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the `ctx.workspaces` Context merge (pure Workspace Controller).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the `ctx.locale` Context merge (dictionary registration).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the session-header slot declaration + standard kit (inputActions).
// Type-only: the hero slot declaration (EmptyWorkspaceOwnerProps).
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

/** Structural view of one session's composer actions (the `InputActions` face session-scoped slots receive). */
interface SessionInputFace {
  setDraft(text: string): void
  submit(): void
}

/** Structural view of the two official seams a hero LLM run needs. */
interface SessionRunnables {
  /** Scope-addressed conversation service (root singleton). */
  conversation?: { input: { for(actx: unknown): SessionInputFace | undefined } }
  /** Client Session object layer: binds a session id to its scoped context. */
  sessions?: { binding(id: unknown): { ctx: unknown } | undefined }
}

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

  // Hero LLM runs need the connected session's composer actions, and a BLANK
  // session renders no session header — so the pending-run slot alone would
  // never be consumed there. Resolve them through the official session-
  // addressed seams instead: bind the session id to its scoped context, then
  // take that session's input facade (setDraft + submit = the standard send
  // flow). The binding can trail the connect call, hence the bounded retry.
  const { conversation, sessions } = {
    conversation: ctx.get('conversation'),
    sessions: ctx.get('sessions'),
  } as unknown as SessionRunnables
  const deliverLlmTask = async (
    sessionId: string,
    prompt: string,
    autoSend: boolean,
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const binding = sessions?.binding(sessionId)
      const input = binding === undefined ? undefined : conversation?.input.for(binding.ctx)
      if (input !== undefined) {
        input.setDraft(prompt)
        if (autoSend) input.submit()
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return false
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
        inject: (): RunControlInjected => ({ rpc, getActiveLocale }),
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
  // default picker at a lower priority (lowest priority renders). The llm-run
  // handoff rides the shared store's pending-run slot: the session header
  // consumes and executes it once the connected session is current (the hero
  // unmounts at that point).
  ctx.slots.inject('conversation.hero.workspace', () =>
    ctx.slots.register(
      {
        name: 'conversation.hero.workspace',
        priority: -10,
        locale: NS,
        inject: (): HeroRunControlInjected => ({
          rpc,
          connectWorkspace: (workspaceId) => ctx.uiWorkspace.connectWorkspace(workspaceId),
          createWorkspace: (input) => ctx.workspaces.create({ path: input }),
          deliverLlmTask,
        }),
      },
      HeroRunControl,
    ),
  )
}
