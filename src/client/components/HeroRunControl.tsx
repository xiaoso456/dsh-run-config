/**
 * The hero-page run control, registered into `conversation.hero.workspace`
 * (a single slot whose default occupant is the workspace picker menu). This
 * composite keeps the picker working and adds the run control beside the
 * workspace chip: when the owner's menu is open it renders the workspace
 * picker (list + manual-path add); it always renders the compact run
 * control row.
 *
 * Hero run semantics: no session exists yet, so a run opens the workspace through
 * the official `openWorkspace` and delivers into its synchronous callback; a
 * delivery that fails is handed to that session's own run control (pending slot).
 * @module @xiaoso/dsh-run-config/client/HeroRunControl
 */

import {
  IconCheckOutlineRegular,
  IconCodeOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconPlusOutlineRegular,
  IconSettingsOutlineRegular,
  IconThinkOutlineRegular,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { heroVisibleTasks, heroWorkspace } from '../core/heroRun.ts'
import type { NS } from '../core/locales.ts'
import type { TaskRunnerRpc } from '../core/rpc.ts'
import { taskRunnerStore } from '../core/store.ts'
import { taskListNotice } from '../core/taskListState.ts'
import type { TaskView } from '../core/types.ts'
import { useTaskLoader } from '../core/useTaskLoader.ts'
import { useToast } from '../core/useToast.tsx'
import css from './HeroRunControl.module.css'
import { RunCombo } from './RunCombo.tsx'
import { type MenuEntry, SearchPickerMenu } from './SearchPickerMenu.tsx'
import { TaskListNotice } from './TaskListNotice.tsx'

/** Injected business face supplied by the client entry. */
export interface HeroRunControlInjected {
  rpc: TaskRunnerRpc
  /**
   * Connect a Workspace and open its Session through the official navigation
   * action (`uiWorkspace.openWorkspace`): it retains the Session as the main
   * view's reference and runs `beforeOpen` synchronously while that reference
   * is live — the only window in which the Session Controller binding, and
   * with it the Session's composer facade, exists. A throw from `beforeOpen`
   * aborts the open and releases the retained reference.
   */
  openWorkspace: (
    workspaceId: WorkspaceId,
    beforeOpen?: (sessionId: SessionId) => void,
  ) => Promise<void>
  /** Create a workspace from a directory path. */
  createWorkspace: (path: string) => Promise<{ workspaceId: WorkspaceId }>
  /**
   * Deliver one LLM task into a retained Session's composer (`setDraft`
   * always, `submit` only when the task sends immediately).
   * @param sessionId - the retained target Session.
   * @param prompt - the configuration's prompt.
   * @param autoSend - whether running submits the prompt.
   * @throws when the Session has no retained scope, or when the composer
   * facade refuses it (`conversation.input.for` throws by contract).
   */
  deliverLlmTask: (sessionId: SessionId, prompt: string, autoSend: boolean) => void
}

/** Full props for the hero control. */
export type HeroRunControlProps = PropsRuntime<'conversation.hero.workspace'> &
  PropsLocale<typeof NS> &
  HeroRunControlInjected

const ADD_WORKSPACE = '::add-workspace'

/** Footer entry id: open the run-config dialog. */
const EDIT_CONFIG = '::edit-config'

/**
 * The hero composite: workspace picker menu (when the owner opens it) plus
 * the always-visible run control row.
 * @param props - owner share, global slot currency, injected face, and `t`.
 */
export function HeroRunControl({
  open,
  anchorRef,
  selectedId,
  onPick,
  onClose,
  useWorkspaces,
  rpc,
  openWorkspace,
  createWorkspace,
  deliverLlmTask,
  t,
}: HeroRunControlProps) {
  const snap = useSyncExternalStore(taskRunnerStore.subscribe, taskRunnerStore.getSnapshot)
  const workspaces = useWorkspaces((state) => state.items)
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [taskMenuOpen, setTaskMenuOpen] = useState(false)
  const taskTriggerRef = useRef<HTMLButtonElement>(null)
  // Synchronous door for "create workspace": see `create` below.
  const createGate = useRef(false)
  const { node: toastNode, show: showToast } = useToast()

  // Load tasks once and after every mutation revision (the hero page has no
  // session header, so this composite owns the initial load). The transport
  // error is the official Connection's English wording, wrapped here in this
  // plugin's own sentence.
  useTaskLoader(rpc, snap.revision, (message) => {
    showToast(t('tasksLoadFailedDetail', { message }), <IconWarningOutlineRegular size={14} />)
  })

  // LLM tasks only: a blank hero has no session to run a command against
  // (command tasks live in the session header / run-config dialog). The target
  // is ONLY the workspace the chip shows — never a silent `workspaces[0]`
  // fallback (the chip would keep showing its placeholder while the run control
  // acted on another workspace).
  const currentWorkspace = heroWorkspace(workspaces, selectedId)
  const visible = useMemo(
    () => heroVisibleTasks(snap.tasks ?? [], currentWorkspace?.path),
    [snap.tasks, currentWorkspace?.path],
  )
  const selected = visible.find((task) => task.id === snap.selectedId) ?? visible[0]

  // Loading / empty / failed must not read the same: the notice replaces the
  // placeholder (and the menu's empty row) whenever the cache has not landed or
  // the last load failed.
  const notice = taskListNotice({ status: snap.tasksStatus, loaded: snap.tasks !== null })
  const noticeText = notice === undefined ? undefined : t(notice.key)

  const run = (): void => {
    const task = selected
    if (task === undefined || busy) return
    if ((task.llmPrompt ?? '').trim().length === 0) {
      showToast(
        t('runFailed', { message: 'empty prompt' }),
        <IconWarningOutlineRegular size={14} />,
      )
      return
    }
    const target = currentWorkspace
    if (target === undefined) {
      // Nothing is picked: NOT "no workspaces at all" and not "no visible
      // configurations" (a visible task may well exist; there is simply no
      // workspace the user authorized). The chip shows its pick-a-workspace
      // placeholder and ▶ is disabled; this branch covers the keyboard path.
      showToast(t('heroNoWorkspace'), <IconWarningOutlineRegular size={14} />)
      return
    }
    setBusy(true)
    // The Session id handed to `beforeOpen` — kept so a failed delivery can be
    // handed to that exact Session's own run control instead of being lost.
    let targetSessionId: SessionId | undefined
    void openWorkspace(target.workspaceId, (sessionId) => {
      targetSessionId = sessionId
      // llm tasks: deliver into the Session the navigation just retained, through
      // the session-addressed input facade; a throw from it aborts the open and is
      // handled below, never swallowed.
      deliverLlmTask(sessionId, task.llmPrompt ?? '', task.autoSend !== false)
      if (task.autoSend === false) {
        showToast(t('filledIn'), <IconCheckOutlineRegular size={14} />)
      }
    })
      .catch((error) => {
        // The toast below is the failure signal. The pending slot is a
        // best-effort second chance: only a Session that renders a header
        // consumes it (a blank session does not).
        if (targetSessionId !== undefined) {
          taskRunnerStore.requestPendingRun({ taskId: task.id, sessionId: targetSessionId })
        }
        showToast(
          t('runFailed', {
            message: String(error instanceof Error ? error.message : error),
          }),
          <IconWarningOutlineRegular size={14} />,
        )
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const items: MenuEntry[] = workspaces.map((workspace) => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: <IconFolderOpenOutlineRegular size={14} />,
  }))

  const footer: MenuEntry[] = adding
    ? []
    : [
        {
          id: ADD_WORKSPACE,
          label: t('heroAddWorkspace'),
          icon: <IconPlusOutlineRegular size={14} />,
        },
      ]

  const handleSelect = (id: string): void => {
    if (id === ADD_WORKSPACE) {
      setAdding(true)
      return
    }
    onPick(id as WorkspaceId)
  }

  // "Add workspace" is a mode of the OPEN menu, not of the control: any close
  // (outside click, Escape, picking a workspace, the owner collapsing it) ends it.
  useEffect(() => {
    if (open) return
    setAdding(false)
    setPath('')
  }, [open])

  // Picker rows: GLOBAL / current-workspace groups, with the "edit
  // configurations" entry pinned in the footer.
  const taskItems: MenuEntry[] = useMemo(() => {
    const out: MenuEntry[] = []
    const entry = (task: TaskView): MenuEntry => ({
      id: task.id,
      label: task.name,
      icon: <IconThinkOutlineRegular size={14} />,
    })
    const currentTasks = visible.filter((task) => task.scope !== 'global')
    const globalTasks = visible.filter((task) => task.scope === 'global')
    if (currentTasks.length > 0) {
      out.push({
        type: 'label',
        id: 'label-workspace',
        text: t('groupWorkspace'),
      })
      for (const task of currentTasks) out.push(entry(task))
    }
    if (globalTasks.length > 0) {
      out.push({ type: 'label', id: 'label-global', text: t('groupGlobal') })
      for (const task of globalTasks) out.push(entry(task))
    }
    if (out.length === 0) {
      out.push({
        type: 'label',
        id: 'label-empty',
        text: noticeText ?? t('noVisibleTasks'),
      })
    }
    return out
  }, [visible, t, noticeText])

  const taskFooter: MenuEntry[] = [
    {
      id: EDIT_CONFIG,
      label: t('editConfig'),
      icon: <IconSettingsOutlineRegular size={14} />,
    },
  ]

  const handleTaskSelect = (id: string): void => {
    if (id === EDIT_CONFIG) {
      setTaskMenuOpen(false)
      // Re-pull before opening the dialog (host-side mutations may exist).
      taskRunnerStore.bumpRevision()
      taskRunnerStore.setDialogOpen(true)
      return
    }
    taskRunnerStore.setSelected(id)
    setTaskMenuOpen(false)
  }

  const create = (): void => {
    // One create in flight at a time. The ref is the gate: every Enter press in
    // the same tick reads the same `busy` state, and the keyboard path never
    // passes the button whose `disabled` is the only other door. A second
    // `workspace/create` would register a real directory a second time.
    if (createGate.current) return
    const trimmed = path.trim()
    if (trimmed.length === 0) return
    createGate.current = true
    setBusy(true)
    void createWorkspace(trimmed)
      .then((workspace) => {
        setAdding(false)
        setPath('')
        onPick(workspace.workspaceId)
      })
      .catch((error) => {
        showToast(
          String(error instanceof Error ? error.message : error),
          <IconWarningOutlineRegular size={14} />,
        )
      })
      .finally(() => {
        createGate.current = false
        setBusy(false)
      })
  }

  return (
    <>
      <SearchPickerMenu
        open={open}
        getAnchorRect={() => anchorRef?.current?.getBoundingClientRect() ?? null}
        items={items}
        footer={footer}
        selectedId={selectedId}
        onSelect={handleSelect}
        onClose={onClose}
        searchPlaceholder={t('heroSearchWorkspace')}
        emptyText={t('heroNoWorkspaces')}
        dense
        triggerRef={anchorRef}
        // The add row renders INSIDE the menu card: the card's outside-pointerdown
        // judge treats only its own subtree as interior.
        footerExtra={
          open && adding ? (
            <div className={css.addRow}>
              <input
                className={css.pathInput}
                placeholder={t('heroPathPlaceholder')}
                value={path}
                onChange={(event) => {
                  setPath(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') create()
                  if (event.key === 'Escape') {
                    setAdding(false)
                    setPath('')
                  }
                }}
              />
              <button type="button" className={css.addButton} disabled={busy} onClick={create}>
                <IconPlusOutlineRegular size={13} />
                {t('heroCreate')}
              </button>
            </div>
          ) : null
        }
      />
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
          open={taskMenuOpen}
          runEnabled={selected !== undefined && currentWorkspace !== undefined && !busy}
          pickLabel={t('selectTask')}
          runLabel={() =>
            selected === undefined ? t('noVisibleTasks') : t('runTaskHint', { name: selected.name })
          }
          runTooltipDisabled={busy}
          runAriaLabel={t('run')}
          onPick={() => {
            // Re-pull before showing (host-side mutations may exist).
            taskRunnerStore.bumpRevision()
            setTaskMenuOpen((value) => !value)
          }}
          onRun={run}
          triggerRef={taskTriggerRef}
        />
        {toastNode}
      </div>
      <SearchPickerMenu
        open={taskMenuOpen}
        getAnchorRect={() => taskTriggerRef.current?.getBoundingClientRect() ?? null}
        items={taskItems}
        footer={taskFooter}
        selectedId={selected?.id}
        onSelect={handleTaskSelect}
        onClose={() => {
          setTaskMenuOpen(false)
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
        triggerRef={taskTriggerRef}
      />
    </>
  )
}
