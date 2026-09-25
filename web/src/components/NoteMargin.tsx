// ABOUTME: Margin notes, highlight notes, and cuts next to the A4 sheet, each at the height of its text.
// ABOUTME: When the pane has no room beside the sheet, each one shrinks to a dot in the sheet margin.

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { colorOf, HIGHLIGHT_COLORS, type HighlightColor, kindOf, type Note, stackMargin } from '../lib/annotations'
import { wordCount } from '../lib/text'
import { timeAgo } from '../lib/text'

type Props = {
  /** Open notes, highlights, and cuts that have a place in the text and show in the margin, in text order. */
  notes: Note[]
  active: string | null
  editing: string | null
  onActivate: (id: string | null) => void
  onHover: (id: string | null) => void
  onEdit: (id: string | null) => void
  onChange: (id: string, body: string) => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
  onColor: (id: string, color: HighlightColor) => void
  onAcceptCut: (id: string) => void
}

const CARD_WIDTH = 232
const SIDE_GAP = 22
const STACK_GAP = 10

type Layout = { compact: boolean; anchors: Record<string, number> }

export function NoteMargin({ notes, active, editing, onActivate, onHover, onEdit, onChange, onResolve, onDelete, onColor, onAcceptCut }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  const [layout, setLayout] = useState<Layout>({ compact: false, anchors: {} })
  const [heights, setHeights] = useState<Record<string, number>>({})
  const ids = notes.map((n) => n.id).join(' ')

  const measure = useCallback(() => {
    const root = rootRef.current
    const frame = root?.parentElement
    const scroller = frame?.closest<HTMLElement>('.pane-scroll')
    if (!root || !frame || !scroller) return
    const frameBox = frame.getBoundingClientRect()
    const scrollerBox = scroller.getBoundingClientRect()
    const room = scrollerBox.right - frameBox.right
    const anchors: Record<string, number> = {}
    for (const id of ids ? ids.split(' ') : []) {
      const mark = frame.querySelector(`[data-note-id="${CSS.escape(id)}"]`)
      if (mark) anchors[id] = Math.round(mark.getBoundingClientRect().top - frameBox.top)
    }
    const next = { compact: room < CARD_WIDTH + SIDE_GAP * 2, anchors }
    setLayout((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [ids])

  // Cards change height when their text changes, so read the heights after each render.
  useLayoutEffect(() => {
    const sizes: Record<string, number> = {}
    for (const [id, el] of cards.current) sizes[id] = el.offsetHeight
    setHeights((prev) => (JSON.stringify(prev) === JSON.stringify(sizes) ? prev : sizes))
  })

  useLayoutEffect(() => {
    const root = rootRef.current
    const frame = root?.parentElement
    const scroller = frame?.closest<HTMLElement>('.pane-scroll')
    if (!root || !frame || !scroller) return
    let frameId = 0
    const schedule = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(measure)
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(frame.querySelector('.paper-content') ?? frame, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-note-id'] })
    const sizes = new ResizeObserver(schedule)
    sizes.observe(frame)
    sizes.observe(scroller)
    sizes.observe(root)
    measure()
    return () => {
      cancelAnimationFrame(frameId)
      mutations.disconnect()
      sizes.disconnect()
    }
  }, [measure])

  const placed = notes.filter((n) => layout.anchors[n.id] !== undefined)
  const pinned = placed.findIndex((n) => n.id === active)
  const tops = layout.compact
    ? placed.map((n) => layout.anchors[n.id])
    : stackMargin(placed.map((n) => ({ top: layout.anchors[n.id], height: heights[n.id] ?? 0 })), STACK_GAP, pinned < 0 ? undefined : pinned)

  const cardRef = (id: string) => (el: HTMLElement | null) => {
    if (el) cards.current.set(id, el)
    else cards.current.delete(id)
  }

  return (
    <div ref={rootRef} className="note-margin" data-compact={layout.compact} aria-label="Notes">
      {placed.map((note, i) => {
        const isActive = note.id === active
        if (layout.compact && !isActive) {
          return (
            <button key={note.id} className={`note-dot is-${kindOf(note)} hl-${colorOf(note)}`} style={{ top: tops[i] }} aria-label={dotLabel(note)}
              onClick={() => onActivate(note.id)} onMouseEnter={() => onHover(note.id)} onMouseLeave={() => onHover(null)} />
          )
        }
        return (
          <NoteCard key={note.id} note={note} top={tops[i]} active={isActive} editing={editing === note.id} cardRef={cardRef(note.id)}
            onActivate={() => onActivate(note.id)} onHover={onHover} onEdit={onEdit} onChange={onChange} onResolve={onResolve} onDelete={onDelete}
            onColor={onColor} onAcceptCut={onAcceptCut} />
        )
      })}
    </div>
  )
}

function dotLabel(note: Note): string {
  const kind = kindOf(note)
  if (kind === 'cut') return `Suggested cut: ${note.quote.exact}`
  if (kind === 'highlight') return `Highlight: ${note.body || note.quote.exact}`
  return `Note: ${note.body || 'empty'}`
}

type CardProps = {
  note: Note
  top: number
  active: boolean
  editing: boolean
  cardRef: (el: HTMLElement | null) => void
  onActivate: () => void
  onHover: (id: string | null) => void
  onEdit: (id: string | null) => void
  onChange: (id: string, body: string) => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
  onColor: (id: string, color: HighlightColor) => void
  onAcceptCut: (id: string) => void
}

function NoteCard({ note, top, active, editing, cardRef, onActivate, onHover, onEdit, onChange, onResolve, onDelete, onColor, onAcceptCut }: CardProps) {
  const kind = kindOf(note)
  const frame = (className: string, children: ReactNode) => (
    <article ref={cardRef} className={className} data-active={active} style={{ top }}
      onMouseDown={onActivate} onMouseEnter={() => onHover(note.id)} onMouseLeave={() => onHover(null)}>
      {children}
    </article>
  )

  if (kind === 'cut') {
    const words = wordCount(note.quote.exact)
    return frame('note-card note-cut', (
      <footer className="note-meta">
        <span className="cut-label">Cut · {words} {words === 1 ? 'word' : 'words'}</span>
        <span className="note-actions">
          <button type="button" onClick={() => onAcceptCut(note.id)}>Accept</button>
          <button type="button" onClick={() => onDelete(note.id)}>Reject</button>
        </span>
      </footer>
    ))
  }

  // A comment without text is removed when editing ends; a highlight stays without text.
  const finish = () => {
    onEdit(null)
    if (kind === 'comment' && !note.body.trim()) onDelete(note.id)
  }
  const body = editing ? (
    <textarea
      className="note-input"
      aria-label="Note"
      placeholder="Write a note…"
      value={note.body}
      autoFocus
      rows={2}
      ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }}
      onChange={(e) => onChange(note.id, e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  ) : note.body ? (
    <p className="note-body" onDoubleClick={() => onEdit(note.id)}>{note.body}</p>
  ) : null

  if (kind === 'highlight') {
    return frame(`note-card note-highlight hl-${colorOf(note)}`, <>
      {body}
      {!editing && (
        <footer className="note-meta">
          <span className="hl-colors" role="group" aria-label="Highlight color">
            {HIGHLIGHT_COLORS.map((color) => (
              <button key={color} type="button" className={`hl-swatch hl-${color}`} aria-label={color} aria-pressed={colorOf(note) === color}
                onClick={() => onColor(note.id, color)} />
            ))}
          </span>
          <span className="note-actions">
            <button type="button" onClick={() => onEdit(note.id)}>{note.body ? 'Edit' : 'Add note'}</button>
            <button type="button" onClick={() => onDelete(note.id)}>Remove</button>
          </span>
        </footer>
      )}
    </>)
  }

  return frame('note-card', <>
    {body}
    <footer className="note-meta">
      <time dateTime={new Date(note.created).toISOString()}>{timeAgo(note.created)}</time>
      {!editing && (
        <span className="note-actions">
          <button type="button" onClick={() => onEdit(note.id)}>Edit</button>
          <button type="button" onClick={() => onResolve(note.id)}>Resolve</button>
          <button type="button" onClick={() => onDelete(note.id)}>Delete</button>
        </span>
      )}
    </footer>
  </>)
}
