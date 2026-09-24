// ABOUTME: Quick-open palette: find a document by fuzzy name, or create a new one.
// ABOUTME: Enter opens in the target pane, Shift+Enter opens in a new pane.

import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry } from '../api'
import { dirOf, fuzzyScore, normalizeNewPath, titleFromPath } from '../lib/text'

type Option = { kind: 'open' | 'create'; path: string }

type Props = {
  files: FileEntry[]
  title: string
  onOpen: (path: string, newPane: boolean) => void
  onCreate: (path: string, newPane: boolean) => void
  onClose: () => void
}

export function Palette({ files, title, onOpen, onCreate, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const options = useMemo<Option[]>(() => {
    const ranked = files
      .map((f) => ({ f, score: fuzzyScore(query, f.path) }))
      .filter((r): r is { f: FileEntry; score: number } => r.score !== null)
      .sort((a, b) => (query ? a.score - b.score : b.f.modified - a.f.modified))
      .slice(0, 50)
      .map((r): Option => ({ kind: 'open', path: r.f.path }))
    const newPath = normalizeNewPath(query)
    const exists = files.some((f) => f.path.toLowerCase() === newPath.toLowerCase())
    return newPath && !exists ? [...ranked, { kind: 'create', path: newPath }] : ranked
  }, [files, query])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (option: Option | undefined, newPane: boolean) => {
    if (!option) return
    if (option.kind === 'open') onOpen(option.path, newPane)
    else onCreate(option.path, newPane)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
    if (down || up) {
      e.preventDefault()
      setActive((a) => (options.length ? (a + (down ? 1 : -1) + options.length) % options.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(options[active], e.shiftKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <motion.div
      className="scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="palette"
        initial={{ opacity: 0, y: -8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
        role="dialog"
        aria-label={title}
      >
        <input
          autoFocus
          className="palette-input"
          placeholder="Find or create a document…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        <div className="palette-list" ref={listRef}>
          {options.length === 0 && <div className="palette-none">No documents</div>}
          {options.map((option, i) => (
            <div
              key={`${option.kind}:${option.path}`}
              className="palette-row"
              data-active={i === active}
              onMouseMove={() => setActive(i)}
              onClick={(e) => choose(option, e.shiftKey)}
            >
              {i === active && <motion.span layoutId="palette-hl" className="palette-hl" transition={{ type: 'spring', stiffness: 700, damping: 45 }} />}
              {option.kind === 'open' ? (
                <>
                  <span className="palette-title">{titleFromPath(option.path)}</span>
                  <span className="palette-dir">{dirOf(option.path)}</span>
                </>
              ) : (
                <span className="palette-title palette-create">
                  Create <em>{option.path}</em>
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>{title}</span>
          <span className="spacer" />
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⇧↵</kbd> new pane</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </motion.div>
    </motion.div>
  )
}
