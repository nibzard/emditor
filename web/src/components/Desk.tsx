// ABOUTME: The desk: every Markdown file in the folder as an A4 thumbnail, plus stacks of files.
// ABOUTME: Sort, select, stack, reorder, and open documents with the mouse or the keyboard.

import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { type CSSProperties, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { Listing } from '../api'
import { useStoredState } from '../hooks/useStoredState'
import { type DeskItem, type DeskState, itemPaths, moveBy, moveItem, type SortMode, stackItems, unstack } from '../lib/desk'
import { DeskCard, type DropZone } from './DeskCard'
import { Enso } from './Enso'
import { MinusIcon, PlusIcon } from './icons'
import { Segmented } from './Segmented'

const THUMB_SIZES = [128, 164, 212, 268]
const SORTS: SortMode[] = ['recent', 'name', 'manual']
const PAGE_WIDTH_PX = 794

type Props = {
  listing: Listing
  items: DeskItem[]
  desk: DeskState
  setDesk: (next: DeskState) => void
  active: boolean
  openPaths: Set<string>
  onOpen: (path: string, where: 'slot' | 'new') => void
  onOpenMany: (paths: string[]) => void
  onNew: () => void
  onBack: () => void
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

export function Desk({ listing, items, desk, setDesk, active, openPaths, onOpen, onOpenMany, onNew, onBack }: Props) {
  const [size, setSize] = useStoredState('emditor.thumbSize', 1)
  const [cursor, setCursor] = useState(0)
  const [keyboard, setKeyboard] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ key: string; zone: DropZone } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const thumbWidth = THUMB_SIZES[Math.max(0, Math.min(THUMB_SIZES.length - 1, size))]
  const current = items[Math.min(cursor, items.length - 1)]

  const openItems = useCallback(
    (chosen: DeskItem[], newPane: boolean) => {
      const paths = chosen.flatMap(itemPaths)
      if (paths.length === 1) onOpen(paths[0], newPane ? 'new' : 'slot')
      else if (paths.length > 1) onOpenMany(paths)
    },
    [onOpen, onOpenMany],
  )

  const stackChosen = useCallback(() => {
    const keys = items.filter((i) => selected.has(i.key) || i === current).map((i) => i.key)
    if (keys.length < 2) return
    setDesk(stackItems(desk, items, keys))
    setSelected(new Set())
  }, [items, selected, current, desk, setDesk])

  const columns = useCallback(() => {
    const cards = gridRef.current?.children
    if (!cards || cards.length === 0) return 1
    const firstTop = (cards[0] as HTMLElement).offsetTop
    let count = 0
    for (const card of cards) {
      if ((card as HTMLElement).offsetTop !== firstTop) break
      count += 1
    }
    return Math.max(1, count)
  }, [])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey) return
      const move = (delta: number) => {
        e.preventDefault()
        setKeyboard(true)
        if (e.altKey && current) {
          setDesk(moveBy(desk, items, current.key, delta))
          setCursor((c) => Math.max(0, Math.min(items.length - 1, c + delta)))
        } else {
          setCursor((c) => Math.max(0, Math.min(items.length - 1, c + delta)))
        }
      }
      if (e.metaKey) {
        if (e.key === 'a') {
          e.preventDefault()
          setSelected(new Set(items.map((i) => i.key)))
        }
        return
      }
      switch (e.key) {
        case 'ArrowRight':
          return move(1)
        case 'ArrowLeft':
          return move(-1)
        case 'ArrowDown':
          return move(columns())
        case 'ArrowUp':
          return move(-columns())
        case 'Enter': {
          e.preventDefault()
          const chosen = selected.size > 0 ? items.filter((i) => selected.has(i.key)) : current ? [current] : []
          openItems(chosen, e.shiftKey)
          return
        }
        case ' ':
          e.preventDefault()
          if (!current) return
          setKeyboard(true)
          setSelected((s) => {
            const next = new Set(s)
            if (next.has(current.key)) next.delete(current.key)
            else next.add(current.key)
            return next
          })
          return
        case 'g':
          return stackChosen()
        case 'u':
          if (current?.kind === 'stack') setDesk(unstack(desk, items, current.key))
          return
        case 's':
          setDesk({ ...desk, sort: SORTS[(SORTS.indexOf(desk.sort) + 1) % SORTS.length] })
          return
        case 'n':
          e.preventDefault()
          return onNew()
        case '=':
        case '+':
          return setSize((s) => Math.min(THUMB_SIZES.length - 1, s + 1))
        case '-':
          return setSize((s) => Math.max(0, s - 1))
        case 'Escape':
          if (selected.size > 0) setSelected(new Set())
          else onBack()
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, items, current, selected, desk, setDesk, openItems, stackChosen, columns, onNew, onBack, setSize])

  useEffect(() => {
    if (!keyboard) return
    const card = gridRef.current?.children[cursor] as HTMLElement | undefined
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [cursor, keyboard])

  useEffect(() => {
    const onMouse = () => setKeyboard(false)
    window.addEventListener('mousemove', onMouse)
    return () => window.removeEventListener('mousemove', onMouse)
  }, [])

  const onCardClick = (item: DeskItem, index: number) => (e: MouseEvent) => {
    setCursor(index)
    if (e.metaKey || e.ctrlKey) {
      setSelected((s) => {
        const next = new Set(s)
        if (next.has(item.key)) next.delete(item.key)
        else next.add(item.key)
        return next
      })
      return
    }
    openItems([item], e.shiftKey)
  }

  const onDrop = (target: DeskItem, zone: DropZone) => {
    if (dragKey && dragKey !== target.key) {
      setDesk(zone === 'stack' ? stackItems(desk, items, [target.key, dragKey]) : moveItem(desk, items, dragKey, target.key, zone))
    }
    setDragKey(null)
    setDropHint(null)
  }

  const style = { '--thumb-w': `${thumbWidth}px`, '--thumb-scale': thumbWidth / PAGE_WIDTH_PX } as CSSProperties

  return (
    <div className="desk" style={style} data-keyboard={keyboard}>
      <header className="desk-head">
        <div className="desk-heading">
          <h1 className="desk-title">{listing.root}</h1>
          <span className="desk-count">
            {listing.files.length} {listing.files.length === 1 ? 'document' : 'documents'}
            {selected.size > 0 && <span className="desk-selected"> · {selected.size} selected</span>}
          </span>
        </div>
        <div className="desk-tools">
          <Segmented
            id="sort"
            value={desk.sort}
            onChange={(sort) => setDesk({ ...desk, sort })}
            options={[
              { value: 'recent', label: 'Recent', title: 'Sort by last change (S)' },
              { value: 'name', label: 'Name', title: 'Sort by name (S)' },
              { value: 'manual', label: 'Manual', title: 'Your own order: drag, or ⌥ + arrows (S)' },
            ]}
          />
          <span className="tool-group">
            <button className="icon-btn" onClick={() => setSize((s) => Math.max(0, s - 1))} title="Smaller (−)" aria-label="Smaller thumbnails">
              <MinusIcon />
            </button>
            <button className="icon-btn" onClick={() => setSize((s) => Math.min(THUMB_SIZES.length - 1, s + 1))} title="Larger (+)" aria-label="Larger thumbnails">
              <PlusIcon />
            </button>
          </span>
          <button className="btn" onClick={onNew} title="New document (N)">
            New
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="desk-empty">
          <Enso />
          <p>No Markdown files in this folder yet.</p>
          <button className="btn" onClick={onNew}>
            Write the first one
          </button>
        </div>
      ) : (
        <LayoutGroup id="desk">
          <div className="desk-grid" ref={gridRef}>
            <AnimatePresence initial={true}>
              {items.map((item, i) => (
                <DeskCard
                  key={item.key}
                  item={item}
                  index={i}
                  cursor={keyboard && i === cursor}
                  selected={selected.has(item.key)}
                  dragging={dragKey === item.key}
                  drop={dropHint?.key === item.key ? dropHint.zone : null}
                  openPaths={openPaths}
                  onClick={onCardClick(item, i)}
                  onUnstack={() => setDesk(unstack(desk, items, item.key))}
                  onDragStart={() => setDragKey(item.key)}
                  onDragOver={(zone) => dragKey && dragKey !== item.key && setDropHint({ key: item.key, zone })}
                  onDragLeave={() => setDropHint((h) => (h?.key === item.key ? null : h))}
                  onDrop={(zone) => onDrop(item, zone)}
                  onDragEnd={() => {
                    setDragKey(null)
                    setDropHint(null)
                  }}
                />
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      )}

      <motion.footer className="hints chrome" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>⇧↵</kbd> new pane</span>
        <span><kbd>␣</kbd> select</span>
        <span><kbd>G</kbd> stack</span>
        <span><kbd>U</kbd> unstack</span>
        <span><kbd>⌥←→</kbd> move</span>
        <span><kbd>?</kbd> all keys</span>
      </motion.footer>
    </div>
  )
}
