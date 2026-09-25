// ABOUTME: One workspace pane: a header, an A4 paper with margin notes, and a rich or source editor for one document.
// ABOUTME: It keeps its scroll position when the mode changes and takes part in scroll lock.

import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type SaveStatus, useDocument, useNotes } from '../hooks/useDocument'
import { kindOf, type Note, type TextQuote, wordsAfterCuts } from '../lib/annotations'
import type { ScrollSync } from '../lib/scrollSync'
import { dirOf, titleFromPath } from '../lib/text'
import { anchorScrollTop, captureViewAnchor, type ViewAnchor } from '../lib/viewportAnchor'
import type { Mode, PaneState } from '../lib/workspace'
import { FormatBar } from './FormatBar'
import { CloseIcon, NotesIcon, RichIcon, SourceIcon, SplitIcon } from './icons'
import { NoteMargin } from './NoteMargin'
import type { AnchorReport } from './notesPlugin'
import { NoteShelf } from './NoteShelf'
import { Paper } from './Paper'
import type { Mark, RichHandle } from './RichEditor'

type Props = {
  pane: PaneState
  focused: boolean
  /** The pane is in the top row of the layout, so it starts under the top bar. */
  topRow: boolean
  focusSignal: number
  searchTarget?: { path: string; line: number; id: number } | null
  sync: ScrollSync
  style: CSSProperties
  onFocus: () => void
  onMode: (mode: Mode) => void
  onClose: () => void
  onPick: () => void
  onSplit: () => void
  showNotes: boolean
  onShowNotes: (show: boolean) => void
}

const NO_NOTES: Note[] = []
/** Fresh quotes wait this long after the last edit, so typing does not rewrite the notes file each time. */
const REQUOTE_DELAY_MS = 1200

// Each editor loads on first use, so the app starts with neither editor in the first download.
const RichEditor = lazy(() => import('./RichEditor').then((m) => ({ default: m.RichEditor })))
const SourceEditor = lazy(() => import('./SourceEditor').then((m) => ({ default: m.SourceEditor })))

const STATUS_LABEL: Partial<Record<SaveStatus, string>> = {
  unsaved: 'Unsaved',
  saving: 'Saving',
  saved: 'Saved',
  error: 'Not saved',
  conflict: 'Changed on disk',
}

export function Pane({ pane, focused, topRow, focusSignal, searchTarget, sync, style, onFocus, onMode, onClose, onPick, onSplit, showNotes, onShowNotes }: Props) {
  const { doc, status, words, edit, reload, keepMine, retry } = useDocument(pane.path)
  const notes = useNotes(pane.path)
  const [active, setActive] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [anchors, setAnchors] = useState<{ attached: string[]; detached: string[] }>({ attached: [], detached: [] })
  const richRef = useRef<RichHandle | null>(null)
  const [selected, setSelected] = useState(false)
  const notesOn = showNotes && pane.mode === 'rich' && notes.loaded
  const editorNotes = notesOn ? notes.notes : NO_NOTES
  const byId = useMemo(() => new Map(notes.notes.map((n) => [n.id, n])), [notes.notes])
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((n): n is Note => Boolean(n && !n.resolved))
  const attachedNotes = pick(anchors.attached)
  // A highlight shows in the margin only when it has a note, or while it is active.
  const marginNotes = attachedNotes.filter((n) => kindOf(n) !== 'highlight' || n.body || n.id === active || n.id === editing)
  const cuts = notesOn ? attachedNotes.filter((n) => kindOf(n) === 'cut') : NO_NOTES
  const detachedNotes = pick(anchors.detached)
  const resolvedNotes = notes.notes.filter((n) => n.resolved)
  // Notes and cuts ask for a decision; highlights do not, so they are not in the count.
  const openCount = notes.notes.filter((n) => !n.resolved && kindOf(n) !== 'highlight').length

  useEffect(() => {
    setActive(null)
    setEditing(null)
    setAnchors({ attached: [], detached: [] })
  }, [pane.path])

  const requoteRef = useRef(notes.requote)
  requoteRef.current = notes.requote
  const quoteQueue = useRef<{ quotes: Map<string, TextQuote>; timer?: ReturnType<typeof setTimeout> }>({ quotes: new Map() })
  useEffect(() => () => clearTimeout(quoteQueue.current.timer), [])
  const onAnchors = useCallback((report: AnchorReport) => {
    setAnchors((prev) =>
      prev.attached.join(' ') === report.attached.join(' ') && prev.detached.join(' ') === report.detached.join(' ')
        ? prev
        : { attached: report.attached, detached: report.detached },
    )
    if (report.quotes.size === 0) return
    const queue = quoteQueue.current
    for (const [id, quote] of report.quotes) queue.quotes.set(id, quote)
    clearTimeout(queue.timer)
    queue.timer = setTimeout(() => {
      const quotes = queue.quotes
      queue.quotes = new Map()
      requoteRef.current(quotes)
    }, REQUOTE_DELAY_MS)
  }, [])

  const annotate = notes.loaded
    ? (quote: TextQuote, mark: Mark) => {
        const note: Note = { id: crypto.randomUUID(), quote, body: '', created: Date.now(), resolved: false }
        if (mark.kind !== 'comment') note.kind = mark.kind
        if (mark.kind === 'highlight') note.color = mark.color
        notes.add(note)
        if (mark.kind === 'comment') {
          setActive(note.id)
          setEditing(note.id)
        }
        if (!showNotes) onShowNotes(true)
      }
    : null
  const acceptCuts = (ids: string[]) => {
    if (!richRef.current?.acceptCuts(ids)) return
    for (const id of ids) notes.remove(id)
    setActive(null)
  }
  const editNote = (id: string | null) => {
    setEditing(id)
    if (id) setActive(id)
  }
  const resolveNote = (id: string) => {
    notes.update(id, { resolved: true })
    setActive(null)
  }
  const deleteNote = (id: string) => {
    notes.remove(id)
    setActive((current) => (current === id ? null : current))
  }
  const attachNote = (id: string) => {
    const quote = richRef.current?.selectionQuote()
    if (!quote) return false
    notes.update(id, { quote })
    return true
  }
  const sectionRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(1)
  const visibleAnchor = useRef<ViewAnchor | null>(null)
  const pendingAnchor = useRef<ViewAnchor | null>(null)

  useEffect(() => sync.add(scrollRef.current!), [sync])

  // Keep the reading position when the editor changes. The old editor is still in the DOM
  // during this render, so this is the last moment to read its scroll position.
  const editorKey = `${pane.mode}:${doc?.path}:${doc?.version}`
  const lastKey = useRef(editorKey)
  const editorSeed = useRef(doc?.content ?? '')
  const lastPath = useRef(doc?.path)
  const ratio = useRef(0)
  if (lastKey.current !== editorKey) {
    const el = scrollRef.current
    pendingAnchor.current = el && lastPath.current === doc?.path ? captureViewAnchor(el, lastKey.current) : null
    visibleAnchor.current = null
    ratio.current =
      el && lastPath.current === doc?.path ? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) : 0
    lastKey.current = editorKey
    lastPath.current = doc?.path
    editorSeed.current = doc?.content ?? ''
  }

  const focusEditor = useCallback(() => {
    sectionRef.current?.querySelector<HTMLElement>('.ProseMirror, .cm-content')?.focus({ preventScroll: true })
  }, [])

  const focusedRef = useRef(focused)
  focusedRef.current = focused
  useEffect(() => {
    if (focusedRef.current && focusSignal) focusEditor()
  }, [focusSignal, focusEditor])

  const onReady = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el && !searchTarget) {
        const anchored = pendingAnchor.current ? anchorScrollTop(el, pendingAnchor.current, editorKey) : null
        sync.set(el, anchored ?? ratio.current * (el.scrollHeight - el.clientHeight))
        requestAnimationFrame(() => {
          if (pendingAnchor.current) {
            const settled = anchorScrollTop(el, pendingAnchor.current, editorKey)
            if (settled !== null) sync.set(el, settled)
          }
          pendingAnchor.current = null
          visibleAnchor.current = captureViewAnchor(el, editorKey)
        })
      }
      if (focusedRef.current && document.activeElement === document.body) focusEditor()
    })
  }, [sync, focusEditor, searchTarget, editorKey])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame = 0
    const capture = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { visibleAnchor.current = captureViewAnchor(el, editorKey) })
    }
    const observer = new ResizeObserver(() => {
      if (!pendingAnchor.current && visibleAnchor.current && !searchTarget) {
        const top = anchorScrollTop(el, visibleAnchor.current, editorKey)
        if (top !== null) sync.set(el, top)
      }
      capture()
    })
    el.addEventListener('scroll', capture, { passive: true })
    observer.observe(el)
    const paper = el.querySelector<HTMLElement>('.paper')
    if (paper) observer.observe(paper)
    capture()
    return () => { el.removeEventListener('scroll', capture); observer.disconnect(); cancelAnimationFrame(frame) }
  }, [sync, editorKey, searchTarget])

  const title = pane.path ? titleFromPath(pane.path) : 'Empty'
  const dir = pane.path ? dirOf(pane.path) : ''

  return (
    <motion.section
      ref={sectionRef}
      layout
      transition={{ layout: { type: 'spring', stiffness: 380, damping: 40 } }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pane"
      data-focused={focused}
      data-top-row={topRow}
      style={style}
      onMouseDownCapture={onFocus}
      onFocusCapture={onFocus}
      aria-label={pane.path ? `${title} document` : 'Empty document pane'}
    >
      <header className="pane-head">
        {focused && <motion.span layoutId="pane-focus" className="pane-focus-mark" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        <button className="pane-title" onClick={onPick} title="Open another document here (⌘K)">
          <span className="pane-title-name">{title}</span>
          {dir && <span className="pane-title-dir">{dir}</span>}
        </button>
        <SaveDot status={status} />
        {doc && pane.mode === 'rich' && <FormatBar editor={richRef} selected={selected} canMark={Boolean(annotate)} />}
        <span className="pane-tools chrome">
          {doc && (
            <span className="pane-stats">
              {words.toLocaleString()} words{cuts.length > 0 && ` · ${wordsAfterCuts(words, cuts).toLocaleString()} after cuts`} · {pages} {pages === 1 ? 'page' : 'pages'}
            </span>
          )}
          {pane.path && (
            <button className="icon-btn icon-btn-sm notes-btn" onClick={() => onShowNotes(!showNotes)} aria-pressed={showNotes}
              data-tip={pane.mode === 'rich' ? (showNotes ? 'Hide notes ⌥M' : 'Show notes ⌥M') : 'Notes show in formatted text'}
              aria-label={`${showNotes ? 'Hide' : 'Show'} notes${openCount ? `, ${openCount} open` : ''}`}>
              <NotesIcon />
              {openCount > 0 && <span className="notes-count" aria-hidden>{openCount}</span>}
            </button>
          )}
          {pane.path && (
            <button className="icon-btn icon-btn-sm" onClick={onSplit} data-tip="Split: same document beside"
              aria-label="Open this document again beside">
              <SplitIcon />
            </button>
          )}
          {pane.path && (
            <button className="icon-btn icon-btn-sm pane-mode" onClick={() => onMode(pane.mode === 'rich' ? 'source' : 'rich')}
              data-tip={pane.mode === 'rich' ? 'Markdown source ⌘/' : 'Formatted text ⌘/'}
              aria-label={pane.mode === 'rich' ? 'Show Markdown source' : 'Show formatted text'}>
              {pane.mode === 'rich' ? <SourceIcon /> : <RichIcon />}
            </button>
          )}
          <button className="icon-btn icon-btn-sm" onClick={onClose} data-tip="Close pane ⌥W" aria-label="Close pane">
            <CloseIcon />
          </button>
        </span>
      </header>

      <AnimatePresence initial={false}>
        {(status === 'conflict' || (status === 'error' && doc)) && (
          <motion.div
            className="pane-alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <span>{status === 'conflict' ? 'This file changed on disk. Your draft is still here.' : 'Your draft could not be saved.'}</span>
            {status === 'conflict' ? <>
              <button onClick={() => { if (window.confirm('Discard your draft and load the disk version?')) void reload() }}>Load disk version</button>
              <button onClick={() => void keepMine()}>Keep my draft</button>
            </> : <button onClick={() => void retry()}>Retry save</button>}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pane-scroll" ref={scrollRef}>
        {pane.path ? (
          doc && doc.path === pane.path ? (
            <motion.div
              key={editorKey}
              data-editor-key={editorKey}
              initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.32, ease: [0.2, 0.7, 0.1, 1] }}
            >
              <Paper
                onPages={setPages}
                aside={notesOn && marginNotes.length > 0 ? (
                  <NoteMargin notes={marginNotes} active={active} editing={editing} onActivate={setActive} onHover={setHover}
                    onEdit={editNote} onChange={(id, body) => notes.update(id, { body })} onResolve={resolveNote} onDelete={deleteNote}
                    onColor={(id, color) => notes.update(id, { color })} onAcceptCut={(id) => acceptCuts([id])} />
                ) : null}
              >
                <Suspense fallback={null}>
                  {pane.mode === 'rich' ? (
                    <RichEditor docPath={doc.path} initial={editorSeed.current} content={doc.content} onChange={edit} onReady={onReady}
                      notes={editorNotes} highlight={hover ?? active} onAnnotate={annotate} onAnchors={onAnchors}
                      onActivateNote={setActive} handleRef={richRef} onSelection={setSelected} />
                  ) : (
                    <SourceEditor initial={editorSeed.current} content={doc.content} onChange={edit} onReady={onReady} revealLine={searchTarget?.line} revealId={searchTarget?.id} />
                  )}
                </Suspense>
              </Paper>
              {notesOn && (
                <NoteShelf detached={detachedNotes} resolved={resolvedNotes} cuts={cuts.length} status={notes.status} onAttach={attachNote}
                  onAcceptAllCuts={() => acceptCuts(cuts.map((n) => n.id))}
                  onReopen={(id) => notes.update(id, { resolved: false })} onDelete={deleteNote} onRetry={() => void notes.retry()} />
              )}
            </motion.div>
          ) : status === 'error' ? (
            <div className="pane-empty">
              <p>This document cannot be opened.</p>
              <button className="text-btn" onClick={() => void reload()}>Retry opening</button>
              <button className="text-btn" onClick={onPick}>Open another <kbd>⌘K</kbd></button>
            </div>
          ) : null
        ) : (
          <div className="pane-empty">
            <button className="text-btn" onClick={onPick}>Find a document <kbd>⌘K</kbd></button>
          </div>
        )}
      </div>
    </motion.section>
  )
}

function SaveDot({ status }: { status: SaveStatus }) {
  const label = STATUS_LABEL[status]
  return (
    <span className="save" data-status={status}>
      <motion.span
        className="save-dot"
        animate={status === 'saving' ? { opacity: [1, 0.3, 1] } : { opacity: status === 'idle' ? 0 : 1 }}
        transition={status === 'saving' ? { duration: 0.9, repeat: Infinity } : { duration: 0.3 }}
      />
      <AnimatePresence mode="popLayout">
        {label && (
          <motion.span
            key={label}
            className="save-label"
            initial={{ opacity: 0, x: -3 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
