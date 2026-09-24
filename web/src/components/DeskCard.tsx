// ABOUTME: Desk cards: an A4 thumbnail of one document, or a stack of documents.
// ABOUTME: Cards move by drag and drop; grouping uses an explicit selection action.

import { AnimatePresence, motion } from 'motion/react'
import { type DragEvent, memo, type MouseEvent, useMemo } from 'react'
import type { DeskItem } from '../lib/desk'
import { renderPreview } from '../lib/preview'
import { dirOf, timeAgo, titleFromPath } from '../lib/text'
import { CloseIcon } from './icons'

export type DropZone = 'before' | 'after'

type Props = {
  item: DeskItem
  index: number
  cursor: boolean
  selected: boolean
  dragging: boolean
  drop: DropZone | null
  openPaths: Set<string>
  onClick: (e: MouseEvent) => void
  onFocus: () => void
  onUnstack: () => void
  onDragStart: () => void
  onDragOver: (zone: DropZone) => void
  onDragLeave: () => void
  onDrop: (zone: DropZone) => void
  onDragEnd: () => void
}

function zoneOf(e: DragEvent<HTMLElement>): DropZone {
  const box = e.currentTarget.getBoundingClientRect()
  const x = (e.clientX - box.left) / box.width
  return x < 0.5 ? 'before' : 'after'
}

const Thumb = memo(function Thumb({ markdown, path }: { markdown: string; path: string }) {
  const html = useMemo(() => renderPreview(markdown, path), [markdown, path])
  return (
    <div className="thumb">
      <div className="thumb-page md-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
})

export function DeskCard(props: Props) {
  const { item, index, cursor, selected, dragging, drop, openPaths } = props
  const top = item.kind === 'doc' ? item.file : item.files[0]
  const isOpen = (item.kind === 'doc' ? [item.file.path] : item.stack.paths).some((p) => openPaths.has(p))
  const sub =
    item.kind === 'stack'
      ? `${item.files.length} documents`
      : [dirOf(item.file.path), timeAgo(item.file.modified)].filter(Boolean).join(' · ')

  return (
    <motion.div
      layout
      layoutId={item.key}
      className={item.kind === 'stack' ? 'card stack' : 'card'}
      data-selected={selected}
      data-dragging={dragging}
      data-drop={drop ?? undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: dragging ? 0.35 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        layout: { type: 'spring', stiffness: 420, damping: 38 },
        default: { delay: Math.min(index, 16) * 0.018, duration: 0.35, ease: [0.2, 0.7, 0.1, 1] },
      }}
    >
      {cursor && <motion.div layoutId="desk-cursor" className="card-cursor" transition={{ type: 'spring', stiffness: 600, damping: 44 }} />}
      <div
        className="card-body"
        role="button"
        tabIndex={0}
        aria-label={item.kind === 'stack' ? `Open stack: ${item.files.length} documents, starting with ${titleFromPath(top.path)}` : `Open ${titleFromPath(top.path)}`}
        draggable
        onClick={props.onClick}
        onFocus={props.onFocus}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', item.key)
          props.onDragStart()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          props.onDragOver(zoneOf(e))
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) props.onDragLeave()
        }}
        onDrop={(e) => {
          e.preventDefault()
          props.onDrop(zoneOf(e))
        }}
        onDragEnd={props.onDragEnd}
      >
        <div className="thumb-wrap">
          {item.kind === 'stack' && (
            <>
              <span className="sheet sheet-1" />
              <span className="sheet sheet-2" />
              <span className="stack-count">{item.files.length}</span>
            </>
          )}
          <Thumb markdown={top.preview} path={top.path} />
          <AnimatePresence>
            {selected && (
              <motion.span
                className="seal"
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 24 }}
              >
                <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
                  <path d="M2.5 6.3l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="card-meta">
          <span className="card-title">
            {isOpen && <span className="open-dot" title="Open in the workspace" />}
            <span className="card-title-text">{titleFromPath(top.path)}</span>
          </span>
          <span className="card-sub">{sub}</span>
        </div>
      </div>
      {item.kind === 'stack' && <button className="unstack-btn" title="Unstack (U)" aria-label={`Unstack ${titleFromPath(top.path)} and ${item.files.length - 1} more documents`}
        onClick={props.onUnstack}><CloseIcon /></button>}
    </motion.div>
  )
}
