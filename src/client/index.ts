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
// Type-only: the `ctx.settingsScope` Context merge (the scope binder).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `ctx.uiWorkspace` Context merge (workspace navigation).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  type HeroInputActions,
  HeroRunControl,
  type HeroRunControlInjected,
} from './components/HeroRunControl.tsx'
import {
  RunConfigDialog,
  type RunConfigDialogInjected,
  type TaskRunnerDialogSettings,
} from './components/RunConfigDialog.tsx'
import { RunControl, type RunControlInjected } from './components/RunControl.tsx'
import { en, NS, zh } from './core/locales.ts'
import { createTaskRunnerRpc } from './core/rpc.ts'

/** Required services: slots (registration), locale, the wire, the settings scope binder, the pure workspace controller, workspace navigation, and sessions (hero connect + run handoff). */
export const inject = [
  'slots',
  'locale',
  'connection',
  'settingsScope',
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
  const settings = ctx.settingsScope.bind<TaskRunnerDialogSettings>({
    namespace: 'task-runner',
  })
  const getActiveLocale = (): string => ctx.locale.getLocale().active

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
  // handoff reads the renderer-host provide bundle for the current session's
  // input actions (blank sessions have no header to consume the run). The
  // host-side dsh-session merge shadows `ctx.sessions`, so read the runtime
  // face structurally through ctx.get.
  const sessions = ctx.get('sessions') as unknown as {
    currentProvideInfo: {
      getSnapshot(): {
        sessionId: string | undefined
        props: Record<string, unknown>
      }
      subscribe(listener: () => void): () => void
    }
  }
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
          getCurrentInputActions: () =>
            sessions.currentProvideInfo.getSnapshot().props.inputActions as
              | HeroInputActions
              | undefined,
          subscribeCurrentSession: (listener) => sessions.currentProvideInfo.subscribe(listener),
        }),
      },
      HeroRunControl,
    ),
  )
}
