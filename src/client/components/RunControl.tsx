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
  IconCheckOutlineRegular,
  IconCodeOutlineRegular,
  IconSettingsOutlineRegular,
  IconThinkOutlineRegular,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { NS } from '../core/locales.ts'
import { consumePendingRun } from '../core/pendingRun.ts'
import type { TaskRunnerRpc } from '../core/rpc.ts'
import { taskRunnerStore } from '../core/store.ts'
import { taskListNotice } from '../core/taskListState.ts'
import type { TaskView } from '../core/types.ts'
import { useTaskLoader } from '../core/useTaskLoader.ts'
import { useToast } from '../core/useToast.tsx'
import { RunCombo } from './RunCombo.tsx'
import css from './RunControl.module.css'
import { type MenuEntry, SearchPickerMenu } from './SearchPickerMenu.tsx'
import { TaskListNotice } from './TaskListNotice.tsx'

/** Injected business face supplied by the client entry. */
export interface RunControlInjected {
  rpc: TaskRunnerRpc
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
  t,
}: RunControlProps) {
  const snap = useSyncExternalStore(taskRunnerStore.subscribe, taskRunnerStore.getSnapshot)
  const cwd = useSessions((state) => state.byId[sessionId]?.cwd)
  // The composer's current draft: running an LLM configuration REPLACES it
  // (official contract, `input.d.ts` "Replace the whole draft"), so what is
  // about to be overwritten has to be read before the write.
  const inputState = useInput((s) => s)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // One run in flight at a time. The ref is the gate: every click in the same
  // tick reads the same `busy` state, and three clicks in one tick used to issue
  // three `tasks/run` calls (three background processes for one configuration).
  // Same door as HeroRunControl's `createGate`.
  //
  // The gate is only SET on the command branch below. The LLM branch ends in
  // `inputActions.submit()`, whose official submit plane (its phase/claim state
  // machine) is what owns "one send per click burst" — not this ref. That
  // asymmetry is deliberate, not a missing guard; the alternative (gating LLM
  // runs here too) is unverified, and the only acceptance script with a request
  // to count (`tests/cdp-double-run.mjs`) covers the command path.
  const runGate = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { node: toastNode, show: showToast } = useToast()

  // Load tasks once and after every mutation revision. The transport error is
  // the official Connection's English wording, so it is wrapped in this
  // plugin's own sentence (the toast is user-facing copy, not a log line).
  useTaskLoader(rpc, snap.revision, (message) => {
    showToast(t('tasksLoadFailedDetail', { message }), <IconWarningOutlineRegular size={14} />)
  })

  const visible = useMemo(() => snap.tasks ?? [], [snap.tasks])

  const globalTasks = useMemo(() => visible.filter((task) => task.scope === 'global'), [visible])
  const currentTasks = useMemo(
    () => visible.filter((task) => task.scope !== 'global' && task.workspacePath === cwd),
    [visible, cwd],
  )

  // The selection must come from the VISIBLE tasks (current workspace first,
  // then global) — the shared store's selectedId may point at another
  // workspace's task (it is global across workspaces), and visible[0] may be
  // one too. Falling back to the first visible task keeps the run control on
  // the current workspace's configurations.
  const visibleTasks = useMemo(() => [...currentTasks, ...globalTasks], [currentTasks, globalTasks])
  const selected = visibleTasks.find((task) => task.id === snap.selectedId) ?? visibleTasks[0]

  // Loading / empty / failed must be three different messages here too (the
  // header picker lists the same cache as the hero control).
  const notice = taskListNotice({ status: snap.tasksStatus, loaded: snap.tasks !== null })
  const noticeText = notice === undefined ? undefined : t(notice.key)

  const runTask = (task: TaskView | undefined): void => {
    if (task === undefined || busy || runGate.current) return
    if (task.type === 'llm') {
      const prompt = task.llmPrompt ?? ''
      if (prompt.trim().length === 0) {
        showToast(
          t('runFailed', { message: 'empty prompt' }),
          <IconWarningOutlineRegular size={14} />,
        )
        return
      }
      const replaced =
        inputState.draft.trim().length > 0 && inputState.draft.trim() !== prompt.trim()
      inputActions.setDraft(prompt)
      if (task.autoSend !== false) {
        inputActions.submit()
        // The official contract replaces the whole draft, so the user's own
        // text is gone — never silently.
        if (replaced) showToast(t('draftReplaced'), <IconWarningOutlineRegular size={14} />)
      } else {
        // autoSend off: fill the composer and let the user edit before sending.
        // Only one banner is on screen at a time, and "your draft was replaced"
        // is the news that must survive alongside "filled in".
        showToast(
          replaced ? t('filledInReplaced') : t('filledIn'),
          <IconCheckOutlineRegular size={14} />,
        )
      }
      return
    }
    setBusy(true)
    runGate.current = true
    // Command-only endpoint (LLM runs go through the composer above).
    void rpc
      .call('tasks/run', { id: task.id, sessionId })
      .then((res) => {
        showToast(t('started', { id: res.jobId }), <IconCheckOutlineRegular size={14} />)
      })
      .catch((error) => {
        showToast(
          t('runFailed', {
            message: String(error instanceof Error ? error.message : error),
          }),
          <IconWarningOutlineRegular size={14} />,
        )
      })
      .finally(() => {
        runGate.current = false
        setBusy(false)
      })
  }

  // Hero → session handoff: a run the hero page requested executes here, and only
  // here — a handoff addressed to another Session is left for that Session's own
  // control. The rules live in core/pendingRun.ts (`consumePendingRun`), so they
  // are asserted without a DOM; this effect only supplies the state.
  useEffect(() => {
    consumePendingRun<TaskView>({
      pending: snap.pendingRun,
      sessionId,
      tasksLoaded: snap.tasks !== null,
      canStart: !busy,
      // The handoff lookup uses THIS control's visible set (current workspace +
      // global) — the exact tasks it may act on, per the `pendingRun` contract.
      // The hero hands over a configuration it showed for the workspace it just
      // opened, so the target is either global or bound to that same workspace,
      // whose path this session's cwd echoes (both come from the workspace
      // registry).
      visible: visibleTasks,
      clearPendingRun: (pending) => {
        taskRunnerStore.clearPendingRun(pending)
      },
      reportUnavailable: () => {
        // The task is gone from the cache, so there is no name to show: the id
        // is not user-facing copy.
        showToast(t('runUnavailable'), <IconWarningOutlineRegular size={14} />)
      },
      start: runTask,
    })
    // `busy` is a dependency because a handoff arriving during a run is
    // deferred: it must be consumed as soon as this control is free again.
    // `visibleTasks` is one too: the lookup must use the CURRENT workspace's
    // view, and a workspace/task change re-targets what this control may act on.
  }, [snap.pendingRun, snap.tasks, visibleTasks, inputActions, sessionId, busy])

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
      out.push({
        type: 'label',
        id: 'label-empty',
        text: noticeText ?? t('noVisibleTasks'),
      })
    }
    return out
  }, [globalTasks, currentTasks, t, noticeText])

  const footer: MenuEntry[] = [
    {
      id: EDIT_CONFIG,
      label: t('editConfig'),
      icon: <IconSettingsOutlineRegular size={14} />,
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
            <IconThinkOutlineRegular size={14} />
          ) : (
            <IconCodeOutlineRegular size={14} />
          )
        }
        name={
          selected === undefined && notice !== undefined && noticeText !== undefined ? (
            <TaskListNotice notice={notice} text={noticeText} />
          ) : (
            selected?.name
          )
        }
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
        emptyText={
          notice !== undefined && noticeText !== undefined ? (
            <TaskListNotice notice={notice} text={noticeText} />
          ) : (
            t('noVisibleTasks')
          )
        }
        noMatchText={t('noMatchTasks')}
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
        task.type === 'llm' ? (
          <IconThinkOutlineRegular size={14} />
        ) : (
          <IconCodeOutlineRegular size={14} />
        ),
    }
  }
}
