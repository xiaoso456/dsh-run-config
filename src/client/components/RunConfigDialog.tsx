/**
 * The run-config dialog (IDEA Run/Debug Configurations style), registered
 * into `shell.overlay`. Left pane: searchable, grouped task list with
 * add / duplicate / delete (with confirmation) and drag reordering. Right
 * pane: the selected task's form. Footer: OK / Cancel / Apply, plus the
 * "expose the task tool to the LLM" switch bound to the `task-runner`
 * settings namespace.
 *
 * Visual language: host design tokens only, precision-tool density. See
 * RunConfigDialog.module.css for the shape / motion / height rules.
 * @module @xiaoso/dsh-run-config/client/RunConfigDialog
 */

import {
  Button,
  IconChecklistOutline14,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconCodeOutline16,
  IconCopyOutline16,
  IconEllipsisOutline16,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconThinkOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DragEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { NS } from '../core/locales.ts'
import type { TaskRunnerRpc } from '../core/rpc.ts'
import { taskRunnerStore } from '../core/store.ts'
import type { TaskScope, TaskType, TaskView } from '../core/types.ts'
import css from './RunConfigDialog.module.css'
import { type MenuEntry, SearchPickerMenu } from './SearchPickerMenu.tsx'

/** Settings shape the dialog's switch writes. */
export interface TaskRunnerDialogSettings {
  toolEnabled?: boolean
}

/** Injected business face supplied by the client entry. */
export interface RunConfigDialogInjected {
  rpc: TaskRunnerRpc
  settings: SettingsScope<TaskRunnerDialogSettings>
}

/** Full props for the dialog. */
export type RunConfigDialogProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<typeof NS> &
  RunConfigDialogInjected

/** Editable form fields for one task. */
interface Draft {
  name: string
  description: string
  type: TaskType
  scope: TaskScope
  workspacePath: string
  llmPrompt: string
  autoSend: boolean
  command: string
  notifyLlm: boolean
}

function toDraft(task: TaskView): Draft {
  return {
    name: task.name,
    description: task.description ?? '',
    type: task.type,
    scope: task.scope,
    workspacePath: task.workspacePath ?? '',
    llmPrompt: task.llmPrompt ?? '',
    autoSend: task.autoSend ?? true,
    command: task.command ?? '',
    notifyLlm: task.notifyLlm ?? true,
  }
}

function sameAsTask(draft: Draft, task: TaskView): boolean {
  return (
    draft.name === task.name &&
    (draft.description || undefined) === task.description &&
    draft.type === task.type &&
    draft.scope === task.scope &&
    (draft.workspacePath || undefined) === task.workspacePath &&
    (draft.llmPrompt || undefined) === task.llmPrompt &&
    draft.autoSend === (task.autoSend ?? true) &&
    (draft.command || undefined) === task.command &&
    draft.notifyLlm === (task.notifyLlm ?? true)
  )
}

/**
 * The run-config dialog.
 * @param props - global slot currency, the injected RPC + settings faces, and `t`.
 */
export function RunConfigDialog({
  useSessions,
  useWorkspaces,
  rpc,
  settings,
  t,
}: RunConfigDialogProps) {
  const snap = useSyncExternalStore(taskRunnerStore.subscribe, taskRunnerStore.getSnapshot)
  const currentCwd = useSessions((state) => {
    const current = state.current
    return current === undefined ? undefined : state.byId[current]?.cwd
  })
  const workspaces = useWorkspaces((state) => state.items)

  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null)

  // Keep the settings switch live (the scope snapshot is identity-stable;
  // arrow wrappers keep the class methods' `this` binding).
  const settingsSnap = useSyncExternalStore(
    (listener) => settings.subscribe(listener),
    () => settings.getSnapshot(),
  )

  const tasks = snap.tasks ?? []
  const selected = tasks.find((task) => task.id === snap.selectedId)

  // Reset the form whenever the selection (or a committed revision) changes.
  useEffect(() => {
    const task = tasks.find((candidate) => candidate.id === snap.selectedId)
    setDraft(task === undefined ? null : toDraft(task))
    setConfirmDelete(false)
    setSaveError(undefined)
  }, [snap.selectedId, snap.revision, tasks])

  // The "saved" hint clears on selection change and by its own timer.
  useEffect(() => {
    setSaved(false)
  }, [snap.selectedId])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => {
      setSaved(false)
    }, 2_000)
    return () => {
      clearTimeout(timer)
    }
  }, [saved])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // All tasks are visible (no workspace filtering): global first, then the
    // current workspace, then every other workspace grouped by name — a
    // task never becomes unreachable.
    if (needle.length === 0) return tasks
    return tasks.filter(
      (task) =>
        task.name.toLowerCase().includes(needle) ||
        (task.description ?? '').toLowerCase().includes(needle),
    )
  }, [tasks, query])

  const globalTasks = filtered.filter((task) => task.scope === 'global')
  const currentTasks = filtered.filter(
    (task) => task.scope !== 'global' && task.workspacePath === currentCwd,
  )
  // Other workspace tasks, grouped by workspace path, groups sorted by name.
  const otherGroups = useMemo(() => {
    const groups = new Map<string, TaskView[]>()
    for (const task of filtered) {
      if (task.scope === 'global') continue
      if (task.workspacePath === currentCwd) continue
      const path = task.workspacePath ?? ''
      const list = groups.get(path)
      if (list === undefined) groups.set(path, [task])
      else list.push(task)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, currentCwd])

  // Group title for a workspace path: the workspace title when resolvable,
  // otherwise the path's basename (tasks may reference removed workspaces).
  const groupTitle = (path: string): string => {
    const workspace = workspaces.find((candidate) => candidate.path === path)
    if (workspace !== undefined) return workspace.title
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
  }

  const toolEnabled =
    settingsSnap.status === 'ready' ? (settingsSnap.value?.toolEnabled ?? true) : true

  const close = (): void => {
    taskRunnerStore.setDialogOpen(false)
  }

  const refresh = (): void => {
    taskRunnerStore.bumpRevision()
  }

  const select = (id: string | undefined): void => {
    taskRunnerStore.setSelected(id)
  }

  const createTask = (): void => {
    void rpc
      .call('tasks/create', {
        name: t('newTaskName'),
        type: 'llm',
        scope: 'global',
      })
      .then((res) => {
        refresh()
        select(res.task.id)
      })
      .catch((error) => {
        setSaveError(String(error instanceof Error ? error.message : error))
      })
  }

  const duplicateTask = (): void => {
    if (selected === undefined) return
    void rpc
      .call('tasks/duplicate', { id: selected.id })
      .then((res) => {
        refresh()
        select(res.task.id)
      })
      .catch((error) => {
        setSaveError(String(error instanceof Error ? error.message : error))
      })
  }

  const deleteTask = (): void => {
    if (selected === undefined) return
    void rpc
      .call('tasks/delete', { id: selected.id })
      .then(() => {
        refresh()
        const remaining = tasks.filter((task) => task.id !== selected.id)
        select(remaining[0]?.id)
        setConfirmDelete(false)
      })
      .catch((error) => {
        setSaveError(String(error instanceof Error ? error.message : error))
      })
  }

  const applyDraft = (): void => {
    if (draft === null || selected === undefined) return
    const patch: Record<string, unknown> = {
      name: draft.name,
      description: draft.description || undefined,
      type: draft.type,
      scope: draft.scope,
    }
    if (draft.scope === 'workspace') patch.workspacePath = draft.workspacePath
    if (draft.type === 'llm') {
      patch.llmPrompt = draft.llmPrompt
      patch.autoSend = draft.autoSend
    }
    if (draft.type === 'command') {
      patch.command = draft.command
      patch.notifyLlm = draft.notifyLlm
    }
    void rpc
      .call('tasks/update', { id: selected.id, patch })
      .then(() => {
        refresh()
        setSaveError(undefined)
        setSaved(true)
      })
      .catch((error) => {
        setSaveError(String(error instanceof Error ? error.message : error))
      })
  }

  const patchDraft = (patch: Partial<Draft>): void => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }))
  }

  const onScopeChange = (scope: TaskScope): void => {
    patchDraft({
      scope,
      ...(scope === 'workspace' && (draft?.workspacePath ?? '') === ''
        ? { workspacePath: currentCwd ?? workspaces[0]?.path ?? '' }
        : {}),
    })
  }

  const onDrop = (event: DragEvent, targetId: string): void => {
    event.preventDefault()
    if (dragId === null || dragId === targetId) return
    const ids = tasks.map((task) => task.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    setDragId(null)
    void rpc
      .call('tasks/reorder', { ids: next })
      .then(() => {
        refresh()
      })
      .catch((error) => {
        setSaveError(String(error instanceof Error ? error.message : error))
      })
  }

  const toggleToolEnabled = (): void => {
    void settings.set('toolEnabled', !toolEnabled).catch((error) => {
      setSaveError(String(error instanceof Error ? error.message : error))
    })
  }

  const dirty = draft !== null && selected !== undefined && !sameAsTask(draft, selected)

  // Workspace picker rows for the scope === 'workspace' field (searchable).
  const workspaceItems: MenuEntry[] = useMemo(
    () =>
      workspaces.map((workspace) => ({
        id: workspace.path,
        label: workspace.path,
        icon: <IconFolderOpenOutline16 size={14} />,
      })),
    [workspaces],
  )

  return (
    <Modal
      open={snap.dialogOpen}
      onClose={close}
      closeLabel={t('btnCancel')}
      title={t('configTitle')}
      className={css.dialog}
      contentClassName={css.modalContent}
      footer={
        <div className={css.footer}>
          {saveError !== undefined ? (
            <span className={css.footerError} role="alert">
              <IconWarningOutline16 size={14} />
              <span className={css.footerErrorText}>{saveError}</span>
            </span>
          ) : saved ? (
            <span className={css.footerSaved} role="status">
              <IconCheckOutline16 size={14} />
              <span>{t('savedText')}</span>
            </span>
          ) : null}
          <span className={css.spacer} />
          <Button variant="outline" size="sm" onClick={close}>
            {t('btnCancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={!dirty} onClick={applyDraft}>
            {t('btnSave')}
          </Button>
        </div>
      }
    >
      <div className={css.layout}>
        <div className={css.left}>
          <div className={css.toolbar}>
            <button
              type="button"
              className={css.toolButton}
              title={t('btnAdd')}
              aria-label={t('btnAdd')}
              onClick={createTask}
            >
              <IconPlusOutline16 size={14} />
            </button>
            <button
              type="button"
              className={css.toolButton}
              title={t('btnDuplicate')}
              aria-label={t('btnDuplicate')}
              disabled={selected === undefined}
              onClick={duplicateTask}
            >
              <IconCopyOutline16 size={14} />
            </button>
            <button
              type="button"
              className={`${css.toolButton} ${css.toolButtonDanger}`}
              title={t('btnDelete')}
              aria-label={t('btnDelete')}
              disabled={selected === undefined}
              onClick={() => {
                setConfirmDelete((current) => !current)
              }}
            >
              <IconTrashOutline16 size={14} />
            </button>
            <div className={css.searchWrap}>
              <IconSearchOutline16 className={css.searchIcon} size={13} />
              <input
                className={css.search}
                placeholder={t('searchPlaceholder')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                }}
              />
            </div>
          </div>
          {confirmDelete && selected !== undefined ? (
            <div className={css.confirmBar} role="alertdialog" aria-label={t('deleteConfirmTitle')}>
              <span className={css.confirmIcon}>
                <IconWarningOutline16 size={14} />
              </span>
              <span className={css.confirmText}>
                {t('deleteConfirmBody', { name: selected.name })}
              </span>
              <div className={css.confirmActions}>
                <Button
                  variant="outline"
                  size="sm"
                  className={css.confirmDanger}
                  onClick={deleteTask}
                >
                  {t('deleteConfirmYes')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConfirmDelete(false)
                  }}
                >
                  {t('deleteConfirmNo')}
                </Button>
              </div>
            </div>
          ) : null}
          <div className={css.list}>
            {filtered.length === 0 ? (
              <div className={css.empty}>
                <span className={css.emptyIcon}>
                  <IconChecklistOutline14 size={18} />
                </span>
                <span>{t('emptyList')}</span>
                <span>{t('emptyListHint')}</span>
              </div>
            ) : (
              <>
                {globalTasks.length > 0 ? (
                  <>
                    <div className={css.groupLabel}>
                      <span>{t('groupGlobal')}</span>
                      <span className={css.groupCount}>{globalTasks.length}</span>
                    </div>
                    {globalTasks.map((task, index) => row(task, index))}
                  </>
                ) : null}
                {currentTasks.length > 0 ? (
                  <>
                    <div className={css.groupLabel}>
                      <span>{t('groupWorkspace')}</span>
                      <span className={css.groupCount}>{currentTasks.length}</span>
                    </div>
                    {currentTasks.map((task, index) => row(task, globalTasks.length + index))}
                  </>
                ) : null}
                {otherGroups.map(([path, groupTasks], groupIndex) => (
                  <span key={path}>
                    <div className={css.groupLabel}>
                      <span title={path}>{groupTitle(path)}</span>
                      <span className={css.groupCount}>{groupTasks.length}</span>
                    </div>
                    {groupTasks.map((task, index) =>
                      row(task, globalTasks.length + currentTasks.length + groupIndex * 4 + index),
                    )}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
        <div className={css.right}>
          {draft === null || selected === undefined ? (
            <div className={css.empty}>
              <span className={css.emptyIcon}>
                <IconChecklistOutline14 size={18} />
              </span>
              <span>{t('emptyList')}</span>
            </div>
          ) : (
            <div className={css.form}>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('fieldName')}</span>
                <input
                  className={css.input}
                  value={draft.name}
                  onChange={(event) => {
                    patchDraft({ name: event.target.value })
                  }}
                />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('fieldDescription')}</span>
                <input
                  className={css.input}
                  value={draft.description}
                  onChange={(event) => {
                    patchDraft({ description: event.target.value })
                  }}
                />
                <span className={css.fieldHint}>{t('fieldDescriptionHint')}</span>
              </label>
              <div className={css.field}>
                <span className={css.fieldLabel}>{t('fieldType')}</span>
                <SegmentGroup
                  ariaLabel={t('fieldType')}
                  value={draft.type}
                  onChange={(type) => {
                    patchDraft({ type: type as TaskType })
                  }}
                  options={[
                    {
                      id: 'llm',
                      label: (
                        <>
                          <IconThinkOutline16 size={14} />
                          {t('typeLlm')}
                        </>
                      ),
                    },
                    {
                      id: 'command',
                      label: (
                        <>
                          <IconCodeOutline16 size={14} />
                          {t('typeCommand')}
                        </>
                      ),
                    },
                  ]}
                />
              </div>
              <div className={css.field}>
                <span className={css.fieldLabel}>{t('fieldScope')}</span>
                <SegmentGroup
                  ariaLabel={t('fieldScope')}
                  value={draft.scope}
                  onChange={(scope) => {
                    onScopeChange(scope as TaskScope)
                  }}
                  options={[
                    { id: 'global', label: t('scopeGlobal') },
                    { id: 'workspace', label: t('scopeWorkspace') },
                  ]}
                />
              </div>
              {draft.scope === 'workspace' ? (
                <div className={`${css.field} ${css.fieldReveal}`}>
                  <span className={css.fieldLabel}>{t('fieldWorkspace')}</span>
                  <div className={css.pickerField}>
                    <button
                      ref={workspaceTriggerRef}
                      type="button"
                      className={
                        workspaceOpen ? `${css.input} ${css.pickerTriggerOpen}` : css.input
                      }
                      aria-expanded={workspaceOpen}
                      onClick={() => {
                        setWorkspaceOpen((current) => !current)
                      }}
                    >
                      <span className={css.pickerValue} title={draft.workspacePath}>
                        {draft.workspacePath !== ''
                          ? draft.workspacePath
                          : t('workspacePlaceholder')}
                      </span>
                      <IconChevronDownOutline14
                        className={workspaceOpen ? css.selectArrowOpen : css.selectArrow}
                      />
                    </button>
                    <SearchPickerMenu
                      open={workspaceOpen}
                      getAnchorRect={() =>
                        workspaceTriggerRef.current?.getBoundingClientRect() ?? null
                      }
                      items={workspaceItems}
                      selectedId={draft.workspacePath}
                      onSelect={(id) => {
                        patchDraft({ workspacePath: id })
                        setWorkspaceOpen(false)
                      }}
                      onClose={() => {
                        setWorkspaceOpen(false)
                      }}
                      searchPlaceholder={t('heroSearchWorkspace')}
                      emptyText={t('heroNoWorkspaces')}
                      dense
                      matchWidth
                      triggerRef={workspaceTriggerRef}
                    />
                  </div>
                </div>
              ) : null}
              {draft.type === 'llm' ? (
                <>
                  <label className={`${css.field} ${css.fieldReveal}`}>
                    <span className={css.fieldLabel}>{t('fieldPrompt')}</span>
                    <textarea
                      className={`${css.input} ${css.textarea}`}
                      value={draft.llmPrompt}
                      onChange={(event) => {
                        patchDraft({ llmPrompt: event.target.value })
                      }}
                    />
                    <span className={css.fieldHint}>{t('fieldPromptHint')}</span>
                  </label>
                  <div className={css.switchRow}>
                    <label className={css.switchLabel}>
                      <input
                        type="checkbox"
                        className={css.switchInput}
                        checked={draft.autoSend}
                        onChange={(event) => {
                          patchDraft({ autoSend: event.target.checked })
                        }}
                      />
                      <span className={css.switchText}>
                        <span className={css.switchTitle}>{t('fieldAutoSend')}</span>
                        <span className={css.switchHint}>{t('fieldAutoSendHint')}</span>
                      </span>
                      <span className={css.switchTrack} aria-hidden="true">
                        <span className={css.switchThumb} />
                      </span>
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <label className={`${css.field} ${css.fieldReveal}`}>
                    <span className={css.fieldLabel}>{t('fieldCommand')}</span>
                    <textarea
                      className={`${css.input} ${css.textarea}`}
                      value={draft.command}
                      onChange={(event) => {
                        patchDraft({ command: event.target.value })
                      }}
                    />
                    <span className={css.fieldHint}>{t('fieldCommandHint')}</span>
                  </label>
                  <label className={`${css.checkboxRow} ${css.fieldReveal}`}>
                    <input
                      type="checkbox"
                      className={css.checkInput}
                      checked={draft.notifyLlm}
                      onChange={(event) => {
                        patchDraft({ notifyLlm: event.target.checked })
                      }}
                    />
                    <span className={css.checkbox} aria-hidden="true">
                      {draft.notifyLlm ? <IconCheckOutline16 size={12} /> : null}
                    </span>
                    <span className={css.checkboxText}>
                      <span className={css.checkboxTitle}>{t('fieldNotifyLlm')}</span>
                      <span className={css.checkboxHint}>{t('fieldNotifyLlmHint')}</span>
                    </span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className={css.switchRow}>
        <label className={css.switchLabel}>
          <input
            type="checkbox"
            className={css.switchInput}
            checked={toolEnabled}
            onChange={toggleToolEnabled}
          />
          <span className={css.switchText}>
            <span className={css.switchTitle}>{t('exposeToolToLlm')}</span>
            <span className={css.switchHint}>{t('exposeToolToLlmHint')}</span>
          </span>
          <span className={css.switchTrack} aria-hidden="true">
            <span className={css.switchThumb} />
          </span>
        </label>
      </div>
    </Modal>
  )

  function row(task: TaskView, index: number) {
    const isSelected = task.id === snap.selectedId
    return (
      <button
        key={task.id}
        type="button"
        draggable
        style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
        onDragStart={() => {
          setDragId(task.id)
        }}
        onDragOver={(event) => {
          event.preventDefault()
        }}
        onDrop={(event) => {
          onDrop(event, task.id)
        }}
        className={isSelected ? `${css.row} ${css.rowSelected}` : css.row}
        onClick={() => {
          select(task.id)
        }}
      >
        <span className={css.dragHandle} aria-hidden="true">
          <IconEllipsisOutline16 className={css.dragHandleIcon} size={12} />
        </span>
        <span className={css.typeChip}>
          {task.type === 'llm' ? <IconThinkOutline16 size={13} /> : <IconCodeOutline16 size={13} />}
        </span>
        <span className={css.rowName} title={task.name}>
          {task.name}
        </span>
        {isSelected ? (
          <span className={css.rowCheck}>
            <IconCheckOutline16 size={12} />
          </span>
        ) : null}
      </button>
    )
  }
}

/** One selectable option of a {@link SegmentGroup}. */
interface SegmentOption {
  id: string
  label: ReactNode
}

/**
 * Segmented control with a sliding indicator (Tab-like, GPU-only: the
 * indicator is positioned with `transform: translateX`, so switching
 * animates on the compositor instead of repainting).
 */
function SegmentGroup({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{
    left: number
    width: number
  } | null>(null)

  // Measure the active segment and slide the indicator to it. Runs on mount
  // and whenever the value changes (type / scope switches).
  useEffect(() => {
    const group = groupRef.current
    if (group === null) return
    const active = group.querySelector<HTMLElement>('[aria-checked="true"]')
    if (active === null) {
      setIndicator(null)
      return
    }
    const g = group.getBoundingClientRect()
    const a = active.getBoundingClientRect()
    setIndicator({ left: a.left - g.left, width: a.width })
  }, [value])

  return (
    <div ref={groupRef} className={css.segmentGroup} role="radiogroup" aria-label={ariaLabel}>
      {indicator !== null ? (
        <span
          className={css.segmentIndicator}
          style={{
            transform: `translateX(${indicator.left}px)`,
            width: indicator.width,
          }}
          aria-hidden="true"
        />
      ) : null}
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={value === option.id ? `${css.segment} ${css.segmentActive}` : css.segment}
          onClick={() => {
            onChange(option.id)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
