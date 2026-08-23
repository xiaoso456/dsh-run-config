/**
 * The combined run control: one connected pill (IDEA-style combo) holding a
 * task-picker segment (type icon + task name + chevron) and an icon-only
 * run segment. Clicking the picker segment toggles the task dropdown (owned
 * by the caller); clicking the run segment runs the selected task. The run
 * segment carries the official Tooltip ("run task X in the current
 * workspace"), so the action is discoverable without any run label.
 * @module @xiaoso/dsh-task-runner/client/RunCombo
 */

import { IconChevronDownOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode, Ref } from 'react'
import css from './RunCombo.module.css'

/** Props for the combined run control. */
export interface RunComboProps {
  /** Task-type icon (llm think / command code); hidden while no task is selected. */
  icon?: ReactNode
  /** Selected task name; undefined renders the placeholder. */
  name?: string
  /** Placeholder text when no task is selected. */
  placeholder: string
  /** Picker-segment open state (active fill + chevron rotation). */
  open: boolean
  /** Whether the run segment is enabled (a task exists and nothing is busy). */
  runEnabled: boolean
  /** Picker-segment tooltip text. */
  pickLabel?: string
  /** Run-segment tooltip resolver (evaluated only while the bubble is visible). */
  runLabel: () => string
  /** Suppress the run-segment tooltip (e.g. while a run is in flight). */
  runTooltipDisabled?: boolean
  /** Accessible label for the icon-only run segment. */
  runAriaLabel: string
  /** Picker-segment click (toggle the dropdown). */
  onPick: () => void
  /** Run-segment click. */
  onRun: () => void
  /** Ref forwarded to the picker segment (dropdown anchor + dismissal guard). */
  triggerRef?: Ref<HTMLButtonElement>
}

/**
 * The combined run control.
 * @param props - see {@link RunComboProps}.
 */
export function RunCombo({
  icon,
  name,
  placeholder,
  open,
  runEnabled,
  pickLabel,
  runLabel,
  runTooltipDisabled = false,
  runAriaLabel,
  onPick,
  onRun,
  triggerRef,
}: RunComboProps) {
  return (
    <div className={css.combo}>
      <Tooltip label={pickLabel ?? placeholder} side="bottom" maxWidth={240}>
        <button
          ref={triggerRef}
          type="button"
          className={open ? `${css.pick} ${css.pickOpen}` : css.pick}
          aria-expanded={open}
          onClick={onPick}
        >
          {icon !== undefined ? <span className={css.icon}>{icon}</span> : null}
          <span className={css.name} title={name}>
            {name ?? placeholder}
          </span>
          <IconChevronDownOutline14
            className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
          />
        </button>
      </Tooltip>
      <Tooltip label={runLabel} side="bottom" maxWidth={280} disabled={runTooltipDisabled}>
        <button
          type="button"
          className={css.run}
          aria-label={runAriaLabel}
          disabled={!runEnabled}
          onClick={onRun}
        >
          {/* Standard play triangle (no outer ring), hand-drawn to fill the
             14px box more fully than the official outline icon. */}
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M4 2.5 L11.5 7 L4 11.5 Z" fill="currentColor" />
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}
