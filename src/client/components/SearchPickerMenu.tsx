/**
 * Searchable picker dropdown, shared by the session-header task picker and
 * the hero workspace picker.
 *
 * Visual contract mirrors the official dsh Menu (see Menu.module.css): the
 * floating card (menu surface, radius 12, inverted hairline, shadow-lv3,
 * 4px inset padding), 10px rows with an 8px icon slot and a trailing
 * selection check, small-caps group labels, a pinned footer, portal
 * positioning clamped 12px inside the viewport, and dense row sizing.
 * On top of that it adds a search input (with icon) that filters the
 * selectable rows; group labels vanish when their rows are filtered out.
 * @module @xiaoso/dsh-task-runner/client/SearchPickerMenu
 */

import {
  IconCheckOutline16,
  IconSearchOutline16,
  type MenuEntry,
  type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import css from './SearchPickerMenu.module.css'

/** Re-export the official entry shape so callers build items the same way. */
export type { MenuEntry }

/** Props for the searchable picker. */
export interface SearchPickerMenuProps {
  open: boolean
  /** Anchor rect provider (portal mode, like the official Menu). */
  getAnchorRect: () => DOMRect | null
  /** Group labels + rows; rows are filtered by the search query. */
  items: MenuEntry[]
  /** Pinned entries below the scrollable list (e.g. "add workspace"). */
  footer?: MenuEntry[]
  /** The selected row id (renders a trailing check). */
  selectedId?: string
  /** Row / footer click. */
  onSelect: (id: string) => void
  /** Invoked on outside pointerdown or Escape. */
  onClose: () => void
  /** Search input placeholder. */
  searchPlaceholder: string
  /** Shown when the query matches nothing. */
  emptyText: string
  /** Compact 34px rows (official dense variant). */
  dense?: boolean
  /** Non-selectable entries pinned under the footer (custom content). */
  footerExtra?: ReactNode
  /**
   * Match the card width to the anchor width (for wide in-form fields like
   * the dialog's workspace picker). When false the card uses its own fixed
   * width, which stays compact for the header/hero pickers.
   */
  matchWidth?: boolean
  /**
   * The trigger element (its pointerdown must NOT dismiss the menu: the
   * trigger's own click handler toggles it). Prevents the classic
   * pointerdown-dismiss + click-toggle race that makes the menu flicker
   * shut and open again.
   */
  triggerRef?: { current: HTMLElement | null }
}

const MARGIN = 12

/** One flattened row: its text/icon plus the label of the group it leads. */
interface FlatRow {
  id: string
  text: string
  icon?: ReactNode
  label?: string
}

function flatten(items: MenuEntry[]): FlatRow[] {
  const out: FlatRow[] = []
  let groupLabel: string | undefined
  for (const entry of items) {
    if ('type' in entry && entry.type === 'label') {
      groupLabel = entry.text
      continue
    }
    if ('type' in entry && entry.type === 'separator') continue
    out.push({
      id: entry.id,
      text: typeof entry.label === 'string' ? entry.label : String(entry.label ?? ''),
      icon: entry.icon,
      ...(groupLabel === undefined ? {} : { label: groupLabel }),
    })
    groupLabel = undefined
  }
  return out
}

/** Narrow a MenuEntry to a selectable row (labels/separators are not rows). */
function isRow(entry: MenuEntry): entry is MenuItem {
  return !('type' in entry)
}

/**
 * The searchable picker dropdown. Renders nothing while closed.
 * @param props - see {@link SearchPickerMenuProps}.
 */
export function SearchPickerMenu({
  open,
  getAnchorRect,
  items,
  footer,
  selectedId,
  onSelect,
  onClose,
  searchPlaceholder,
  emptyText,
  dense = true,
  matchWidth = false,
  triggerRef,
}: SearchPickerMenuProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [fixedPos, setFixedPos] = useState<{
    left: number
    top: number
  } | null>(null)
  const [maxHeight, setMaxHeight] = useState<number>(400)
  const [width, setWidth] = useState<number | undefined>(undefined)
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined)

  // Position the portal card just below the anchor (never covering it) and
  // clamp its height to the space between the anchor and the viewport
  // bottom, so the list scrolls internally instead of rising over the
  // trigger. Re-fit on scroll/resize while open (mirrors Menu.tsx).
  useEffect(() => {
    if (!open) {
      setFixedPos(null)
      return
    }
    const place = (): void => {
      const r = getAnchorRect()
      const listEl = listRef.current
      if (r === null || listEl === null) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      // Preferred: open below the anchor, bounded by the space beneath it.
      const yBelow = r.bottom + 4
      const spaceBelow = vh - yBelow - MARGIN
      let y: number
      let maxH: number
      if (spaceBelow >= 120) {
        y = Math.max(yBelow, MARGIN)
        maxH = Math.min(spaceBelow, 520)
      } else {
        // Not enough room below: open ABOVE the anchor instead (the menu
        // never covers the trigger and never spills past the viewport).
        const spaceAbove = r.top - MARGIN - 4
        maxH = Math.max(120, spaceAbove)
        y = r.top - maxH - 4
        if (y < MARGIN) {
          y = MARGIN
          maxH = Math.max(80, r.top - MARGIN - 4)
        }
      }
      setMaxHeight(Math.max(120, maxH))
      if (matchWidth) {
        const w = Math.min(r.width, vw - 2 * MARGIN)
        setWidth(w)
        setMaxWidth(w)
      }
      const lw = matchWidth ? Math.min(r.width, vw - 2 * MARGIN) : listEl.offsetWidth
      const x = Math.min(Math.max(r.left, MARGIN), vw - lw - MARGIN)
      setFixedPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, getAnchorRect, matchWidth])

  // Outside pointerdown / Escape close (mirrors Menu.tsx). Clicks on the
  // trigger are excluded: the trigger's own click handler toggles the menu,
  // and a pointerdown-dismiss here would race it (dismiss then toggle back
  // open), making the menu flicker.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (listRef.current?.contains(event.target) === true) return
      if (triggerRef?.current?.contains(event.target) === true) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, triggerRef])

  // Reset the query when the menu opens.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const needle = query.trim().toLowerCase()

  const rows: FlatRow[] = useMemo(() => {
    const all = flatten(items)
    if (needle.length === 0) return all
    return all.filter((row) => row.text.toLowerCase().includes(needle))
  }, [items, needle])

  if (!open) return null

  // Render rows grouped: a group label appears only before its first row.
  let lastLabel: string | undefined

  return (
    <div
      ref={listRef}
      className={dense ? `${css.card} ${css.dense}` : css.card}
      style={
        fixedPos === null
          ? { visibility: 'hidden', left: 0, top: 0 }
          : {
              left: fixedPos.left,
              top: fixedPos.top,
              maxHeight,
              ...(width === undefined ? {} : { width }),
              ...(maxWidth === undefined ? {} : { maxWidth }),
            }
      }
      role="menu"
    >
      <div className={css.searchWrap}>
        <IconSearchOutline16 className={css.searchIcon} size={13} />
        <input
          className={css.search}
          placeholder={searchPlaceholder}
          value={query}
          // Intentional: the search box must be ready for typing the moment
          // the picker opens (keyboard-first dropdown UX).
          // biome-ignore lint/a11y/noAutofocus: required for instant typing.
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
      </div>
      <div className={css.body}>
        {rows.length === 0 ? <div className={css.empty}>{emptyText}</div> : null}
        {rows.map((row) => {
          const showLabel = row.label !== undefined && row.label !== lastLabel
          if (row.label !== undefined) lastLabel = row.label
          const selected = row.id === selectedId
          return (
            <span key={row.id} className={css.itemWrap}>
              {showLabel ? (
                <div className={css.groupLabel} role="presentation">
                  {row.label}
                </div>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={selected ? `${css.row} ${css.rowSelected}` : css.row}
                onClick={() => {
                  onSelect(row.id)
                }}
              >
                {row.icon !== undefined ? <span className={css.rowIcon}>{row.icon}</span> : null}
                <span className={css.rowName} title={row.text}>
                  {row.text}
                </span>
                {selected ? (
                  <span className={css.check}>
                    <IconCheckOutline16 size={12} />
                  </span>
                ) : null}
              </button>
            </span>
          )
        })}
      </div>
      {footer !== undefined && footer.length > 0 ? (
        <div className={css.footer}>
          {footer.filter(isRow).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={css.row}
              onClick={() => {
                onSelect(entry.id)
              }}
            >
              {entry.icon !== undefined ? <span className={css.rowIcon}>{entry.icon}</span> : null}
              <span className={css.rowName}>{String(entry.label)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
