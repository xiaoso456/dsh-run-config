/**
 * The session-header run control: a compact primary run button, the selected
 * task name with the official dsh Menu dropdown (grouped by scope, footer
 * entry opens the run-config dialog), and a ghost settings button.
 * Registered into `conversation.session.header.utilities`.
 *
 * Run semantics per plan §2.2: `llm` tasks fill the composer draft through
 * `inputActions` and submit through the standard send flow (pure client);
 * `command` tasks call the host `tasks/run` RPC.
 *
 * Visual language: the official dsh Button + Menu primitives (host styles),
 * pill status chips. See RunControl.module.css for the small surface rules.
 * @module @xiaoso/dsh-run-config/client/RunControl
 */

// Type-only: the ui-conversation standard-kit merge (useInput / inputActions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconCheckOutline16,
  IconCodeOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { NS } from '../core/locales.ts'
import type { TaskRunnerRpc } from '../core/rpc.ts'
import { taskRunnerStore } from '../core/store.ts'
import type { TaskView } from '../core/types.ts'
import { useTaskLoader } from '../core/useTaskLoader.ts'
import { useToast } from '../core/useToast.tsx'
import { RunCombo } from './RunCombo.tsx'
import css from './RunControl.module.css'
import { type MenuEntry, SearchPickerMenu } from './SearchPickerMenu.tsx'

/** Injected business face supplied by the client entry. */
export interface RunControlInjected {
  rpc: TaskRunnerRpc
  /** Current active UI locale ('zh' | 'en'), read at run time. */
  getActiveLocale: () => string
}

/** Full props for the header control. */
export type RunControlProps = PropsRuntime<'conversation.session.header.utilities'> &
  PropsLocale<typeof NS> &
  RunControlInjected

/** Footer entry id: open the run-config dialog. */
const EDIT_CONFIG = '::edit-config'

/**
 * The session-header run control.
 * @param props - runtime slot currency, the injected RPC face, and `t`.
 */
export function RunControl({
  sessionId,
  useSessions,
  useInput,
  inputActions,
  rpc,
  getActiveLocale,
  t,
}: RunControlProps) {
  const snap = useSyncExternalStore(taskRunnerStore.subscribe, taskRunnerStore.getSnapshot)
  const cwd = useSessions((state) => state.byId[sessionId]?.cwd)
  // Draft state drives the run button's enabled posture (empty draft = nothing to send).
  useInput((s) => s)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { node: toastNode, show: showToast } = useToast()

  // Load tasks once and after every mutation revision.
  useTaskLoader(rpc, snap.revision, (message) => {
    showToast(message, <IconWarningOutline16 size={14} />)
  })

  const visible = useMemo(() => snap.tasks ?? [], [snap.tasks])

  const globalTasks = visible.filter((task) => task.scope === 'global')
  const currentTasks = visible.filter(
    (task) => task.scope !== 'global' && task.workspacePath === cwd,
  )

  // The selection must come from the VISIBLE tasks (current workspace first,
  // then global) — the shared store's selectedId may point at another
  // workspace's task (it is global across workspaces), and visible[0] may be
  // one too. Falling back to the first visible task keeps the run control on
  // the current workspace's configurations.
  const visibleTasks = [...currentTasks, ...globalTasks]
  const selected = visibleTasks.find((task) => task.id === snap.selectedId) ?? visibleTasks[0]

  const runTask = (task: TaskView | undefined): void => {
    if (task === undefined || busy) return
    if (task.type === 'llm') {
      const prompt = task.llmPrompt ?? ''
      if (prompt.trim().length === 0) {
        showToast(t('runFailed', { message: 'empty prompt' }), <IconWarningOutline16 size={14} />)
        return
      }
      inputActions.setDraft(prompt)
      if (task.autoSend !== false) {
        inputActions.submit()
      } else {
        // autoSend off: fill the composer and let the user edit before sending.
        showToast(t('filledIn'), <IconCheckOutline16 size={14} />)
      }
      return
    }
    setBusy(true)
    void rpc
      .call('tasks/run', { id: task.id, sessionId, locale: getActiveLocale() })
      .then((res) => {
        showToast(t('started', { id: res.jobId }), <IconCheckOutline16 size={14} />)
      })
      .catch((error) => {
        showToast(
          t('runFailed', {
            message: String(error instanceof Error ? error.message : error),
          }),
          <IconWarningOutline16 size={14} />,
        )
      })
      .finally(() => {
        setBusy(false)
      })
  }

  // Hero → session handoff: a pending run requested on the hero page executes
  // once a session is current.
  useEffect(() => {
    const id = taskRunnerStore.consumePendingRun()
    if (id === undefined) return
    const task = visible.find((candidate) => candidate.id === id)
    if (task !== undefined) runTask(task)
  }, [snap.pendingRunId, visible, inputActions, sessionId])

  // Menu entries: the header picker shows only the CURRENT workspace and
  // GLOBAL tasks (the run button acts on this session; every other
  // workspace's tasks live in the run-config dialog, which lists all of
  // them). Current workspace first as it is the most relevant here.
  const items: MenuEntry[] = useMemo(() => {
    const out: MenuEntry[] = []
    if (currentTasks.length > 0) {
      out.push({
        type: 'label',
        id: 'label-workspace',
        text: t('groupWorkspace'),
      })
      for (const task of currentTasks) out.push(menuEntry(task))
    }
    if (globalTasks.length > 0) {
      out.push({ type: 'label', id: 'label-global', text: t('groupGlobal') })
      for (const task of globalTasks) out.push(menuEntry(task))
    }
    if (out.length === 0) {
      out.push({ type: 'label', id: 'label-empty', text: t('noVisibleTasks') })
    }
    return out
  }, [globalTasks, currentTasks, t])

  const footer: MenuEntry[] = [
    {
      id: EDIT_CONFIG,
      label: t('editConfig'),
      icon: <IconSettingsOutline16 size={14} />,
    },
  ]

  const handleSelect = (id: string): void => {
    if (id === EDIT_CONFIG) {
      setOpen(false)
      // Re-pull before opening the dialog (host-side mutations may exist).
      taskRunnerStore.bumpRevision()
      taskRunnerStore.setDialogOpen(true)
      return
    }
    taskRunnerStore.setSelected(id)
    setOpen(false)
  }

  return (
    <div className={css.control}>
      <RunCombo
        icon={
          selected === undefined ? undefined : selected.type === 'llm' ? (
            <IconThinkOutline16 size={14} />
          ) : (
            <IconCodeOutline16 size={14} />
          )
        }
        name={selected?.name}
        placeholder={t('selectTask')}
        open={open}
        runEnabled={selected !== undefined && !busy}
        pickLabel={t('selectTask')}
        runLabel={() =>
          selected === undefined ? t('noVisibleTasks') : t('runTaskHint', { name: selected.name })
        }
        runTooltipDisabled={busy}
        runAriaLabel={t('run')}
        onPick={() => {
          // Refresh on open: the LLM tool (task_run_config) can mutate
          // tasks on the host without any client signal, so the picker must
          // re-pull before showing (bump → useTaskLoader reloads).
          if (!open) taskRunnerStore.bumpRevision()
          setOpen(!open)
        }}
        onRun={() => {
          runTask(selected)
        }}
        triggerRef={triggerRef}
      />
      <SearchPickerMenu
        open={open}
        getAnchorRect={() => triggerRef.current?.getBoundingClientRect() ?? null}
        items={items}
        footer={footer}
        selectedId={selected?.id}
        onSelect={handleSelect}
        onClose={() => {
          setOpen(false)
        }}
        searchPlaceholder={t('searchPlaceholder')}
        emptyText={t('noVisibleTasks')}
        dense
        triggerRef={triggerRef}
      />
      {toastNode}
    </div>
  )

  function menuEntry(task: TaskView): MenuEntry {
    return {
      id: task.id,
      label: task.name,
      icon:
        task.type === 'llm' ? <IconThinkOutline16 size={14} /> : <IconCodeOutline16 size={14} />,
    }
  }
}
