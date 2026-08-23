/**
 * The hero-page run control, registered into `conversation.hero.workspace`
 * (a single slot whose default occupant is the workspace picker menu). This
 * composite keeps the picker working and adds the run control beside the
 * workspace chip: when the owner's menu is open it renders the workspace
 * picker (list + manual-path add); it always renders the compact run
 * control row.
 *
 * Hero run semantics (plan §4.3): no session exists yet, so running first
 * connects/creates the workspace's session (`connectWorkspace`), then hands
 * the task to the session header through the shared store's pending-run
 * slot, which executes it once the session is current.
 * @module @xiaoso/dsh-task-runner/client/HeroRunControl
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconFolderOpenOutline16,
  IconPlayOutline16,
  IconPlusOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { NS } from '../core/locales.ts'
import type { TaskRunnerRpc } from '../core/rpc.ts'
import { taskRunnerStore } from '../core/store.ts'
import { useTaskLoader } from '../core/useTaskLoader.ts'
import { useToast } from '../core/useToast.tsx'
import css from './HeroRunControl.module.css'
import { type MenuEntry, SearchPickerMenu } from './SearchPickerMenu.tsx'

/** Injected business face supplied by the client entry. */
export interface HeroRunControlInjected {
  rpc: TaskRunnerRpc
  /** Connect (or reuse) a workspace's blank session; resolves to its session id. */
  connectWorkspace: (workspaceId: WorkspaceId) => Promise<string>
  /** Create a workspace from a directory path. */
  createWorkspace: (path: string) => Promise<{ workspaceId: WorkspaceId }>
  /**
   * The current session's input actions (undefined while no session is
   * current), read from the renderer-host provide bundle.
   */
  getCurrentInputActions: () => HeroInputActions | undefined
  /** Subscribe to current-session changes (the renderer-host provide bundle). */
  subscribeCurrentSession: (listener: () => void) => () => void
}

/** The composer action face the hero needs (structural view of InputActions). */
export interface HeroInputActions {
  setDraft(text: string): void
  submit(): void
}

/** Full props for the hero control. */
export type HeroRunControlProps = PropsRuntime<'conversation.hero.workspace'> &
  PropsLocale<typeof NS> &
  HeroRunControlInjected

const ADD_WORKSPACE = '::add-workspace'

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
  connectWorkspace,
  createWorkspace,
  getCurrentInputActions,
  subscribeCurrentSession,
  t,
}: HeroRunControlProps) {
  const snap = useSyncExternalStore(taskRunnerStore.subscribe, taskRunnerStore.getSnapshot)
  const workspaces = useWorkspaces((state) => state.items)
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const { node: toastNode, show: showToast } = useToast()

  // Load tasks once and after every mutation revision (the hero page has no
  // session header, so this composite owns the initial load).
  useTaskLoader(rpc, snap.revision, (message) => {
    showToast(message, <IconWarningOutline16 size={14} />)
  })

  const visible = useMemo(
    () => (snap.tasks ?? []).filter((task) => task.scope === 'global'),
    [snap.tasks],
  )
  const selected = visible.find((task) => task.id === snap.selectedId) ?? visible[0]

  const run = (): void => {
    const task = selected
    if (task === undefined || busy) return
    const target =
      workspaces.find((workspace) => workspace.workspaceId === selectedId) ?? workspaces[0]
    if (target === undefined) {
      showToast(t('noVisibleTasks'), <IconWarningOutline16 size={14} />)
      return
    }
    setBusy(true)
    void connectWorkspace(target.workspaceId)
      .then((sessionId) => {
        if (task.type === 'command') {
          // Command tasks run directly on the connected session.
          return rpc.call('tasks/run', { id: task.id, sessionId, locale: 'zh' }).then((res) => {
            showToast(res.jobId, <IconCheckOutline16 size={14} />)
          })
        }
        // llm tasks: hand the run to whichever consumer is mounted (the hero
        // composite itself on blank sessions, the session header otherwise).
        taskRunnerStore.requestPendingRun(task.id)
        return undefined
      })
      .catch((error) => {
        showToast(
          String(error instanceof Error ? error.message : error),
          <IconWarningOutline16 size={14} />,
        )
      })
      .finally(() => {
        setBusy(false)
      })
  }

  // Consume a pending llm run once a session is current (blank sessions have
  // no header, so this composite executes the standard send flow itself).
  useEffect(() => {
    if (snap.pendingRunId === undefined) return
    const task = visible.find((candidate) => candidate.id === snap.pendingRunId)
    if (task === undefined || task.type !== 'llm') return
    const actions = getCurrentInputActions()
    if (actions !== undefined) {
      taskRunnerStore.consumePendingRun()
      actions.setDraft(task.llmPrompt ?? '')
      actions.submit()
      return
    }
    const off = subscribeCurrentSession(() => {
      const current = getCurrentInputActions()
      if (current === undefined) return
      off()
      taskRunnerStore.consumePendingRun()
      current.setDraft(task.llmPrompt ?? '')
      current.submit()
    })
    return off
  }, [snap.pendingRunId, visible, getCurrentInputActions, subscribeCurrentSession])

  const items: MenuEntry[] = workspaces.map((workspace) => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: <IconFolderOpenOutline16 size={14} />,
  }))

  const footer: MenuEntry[] = adding
    ? []
    : [
        {
          id: ADD_WORKSPACE,
          label: t('heroAddWorkspace'),
          icon: <IconPlusOutline16 size={14} />,
        },
      ]

  const handleSelect = (id: string): void => {
    if (id === ADD_WORKSPACE) {
      setAdding(true)
      return
    }
    onPick(id as WorkspaceId)
  }

  const create = (): void => {
    const trimmed = path.trim()
    if (trimmed.length === 0) return
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
          <IconWarningOutline16 size={14} />,
        )
      })
      .finally(() => {
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
      />
      {open && adding ? (
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
            <IconPlusOutline16 size={13} />
            {t('heroCreate')}
          </button>
        </div>
      ) : null}
      <div className={css.control}>
        <Button
          variant="primary"
          size="sm"
          icon={<IconPlayOutline16 size={14} />}
          title={t('run')}
          aria-label={t('run')}
          disabled={selected === undefined || busy}
          onClick={run}
        >
          {t('run')}
        </Button>
        <button
          type="button"
          className={css.pickerTrigger}
          title={selected?.name}
          onClick={() => {
            // Re-pull before opening the dialog (host-side mutations may
            // have happened through the LLM tool while this page sat open).
            taskRunnerStore.bumpRevision()
            taskRunnerStore.setDialogOpen(true)
          }}
        >
          <span className={css.pickerName}>{selected?.name ?? t('selectTask')}</span>
          <IconChevronDownOutline14 />
        </button>
        {toastNode}
      </div>
    </>
  )
}
