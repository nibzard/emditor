// ABOUTME: One workspace pane: a header, an A4 paper, and a rich or source editor for one document.
// ABOUTME: It keeps its scroll position when the mode changes and takes part in scroll lock.

import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { type SaveStatus, useDocument } from '../hooks/useDocument'
import type { ScrollSync } from '../lib/scrollSync'
import { dirOf, titleFromPath } from '../lib/text'
import type { Mode, PaneState } from '../lib/workspace'
import { CloseIcon, RichIcon, SourceIcon, SplitIcon } from './icons'
import { Paper } from './Paper'

type Props = {
  pane: PaneState
  focused: boolean
  focusSignal: number
  sync: ScrollSync
  style: CSSProperties
  onFocus: () => void
  onMode: (mode: Mode) => void
  onClose: () => void
  onPick: () => void
  onSplit: () => void
}

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

export function Pane({ pane, focused, focusSignal, sync, style, onFocus, onMode, onClose, onPick, onSplit }: Props) {
  const { doc, status, words, edit, reload, keepMine, retry } = useDocument(pane.path)
  const sectionRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(1)

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
      if (el) sync.set(el, ratio.current * (el.scrollHeight - el.clientHeight))
      if (focusedRef.current && document.activeElement === document.body) focusEditor()
    })
  }, [sync, focusEditor])

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
        <span className="pane-tools chrome">
          {doc && (
            <span className="pane-stats">
              {words.toLocaleString()} words · {pages} {pages === 1 ? 'page' : 'pages'}
            </span>
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
              initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.32, ease: [0.2, 0.7, 0.1, 1] }}
            >
              <Paper onPages={setPages}>
                <Suspense fallback={null}>
                  {pane.mode === 'rich' ? (
                    <RichEditor docPath={doc.path} initial={editorSeed.current} content={doc.content} onChange={edit} onReady={onReady} />
                  ) : (
                    <SourceEditor initial={editorSeed.current} content={doc.content} onChange={edit} onReady={onReady} />
                  )}
                </Suspense>
              </Paper>
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
