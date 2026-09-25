// ABOUTME: The formatting tools in the pane header: blocks, bold and italic, links, notes, highlights, and cuts.
// ABOUTME: In a narrow pane the tools that do not fit go into a menu; they act on the editor of the pane.

import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from '../lib/annotations'
import {
  AddNoteIcon, BoldIcon, BulletsIcon, CutIcon, Heading1Icon, Heading2Icon, ItalicIcon, LinkIcon, MoreIcon, ParagraphIcon,
} from './icons'
import type { RichHandle } from './RichEditor'

type Props = {
  editor: RefObject<RichHandle | null>
  /** Text is selected, so the tools for selected text can act. */
  selected: boolean
  /** Notes, highlights, and cuts can be added now. */
  canMark: boolean
}

const COLOR_LABEL: Record<HighlightColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' }

export function FormatBar({ editor, selected, canMark }: Props) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const linkId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const act = (fn: (handle: RichHandle) => void) => () => {
    if (editor.current) fn(editor.current)
    setMenuOpen(false)
  }
  const needs = selected ? undefined : 'Select text first'

  // Each group shows in the bar or in the menu, depending on the width of the pane (see the CSS).
  const groups = (place: 'in-bar' | 'in-menu') => <>
    <span className={`fb-group fb-blocks fb-${place}`}>
      <Tool label="Paragraph" onClick={act((h) => h.format('paragraph'))}><ParagraphIcon /></Tool>
      <Tool label="Heading 1" onClick={act((h) => h.format('heading1'))}><Heading1Icon /></Tool>
      <Tool label="Heading 2" onClick={act((h) => h.format('heading2'))}><Heading2Icon /></Tool>
      <Tool label="Bulleted list" onClick={act((h) => h.format('bullets'))}><BulletsIcon /></Tool>
    </span>
    <span className={`fb-group fb-inline fb-${place}`}>
      <Tool label="Bold" disabled={needs} onClick={act((h) => h.format('bold'))}><BoldIcon /></Tool>
      <Tool label="Italic" disabled={needs} onClick={act((h) => h.format('italic'))}><ItalicIcon /></Tool>
      <Tool label="Link" disabled={needs} onClick={() => { setLinkUrl(''); setLinkOpen(true); setMenuOpen(false) }}><LinkIcon /></Tool>
    </span>
    {canMark && (
      <span className={`fb-group fb-marks fb-${place}`}>
        <Tool label="Add a note ⌥⌘M" disabled={needs} onClick={act((h) => h.annotate({ kind: 'comment' }))}><AddNoteIcon /></Tool>
        {HIGHLIGHT_COLORS.map((color, i) => (
          <Tool key={color} label={`Highlight: ${COLOR_LABEL[color]} ⌥⌘${i + 1}`} disabled={needs}
            onClick={act((h) => h.annotate({ kind: 'highlight', color }))}>
            <span className={`hl-swatch hl-${color}`} aria-hidden />
          </Tool>
        ))}
        <Tool label="Suggest a cut ⌥⌘⌫" disabled={needs} onClick={act((h) => h.annotate({ kind: 'cut' }))}><CutIcon /></Tool>
      </span>
    )}
  </>

  return (
    <div ref={rootRef} className="format-bar" role="toolbar" aria-label="Formatting">
      {groups('in-bar')}
      <span className="fb-more">
        <Tool label="More formatting" expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreIcon /></Tool>
        {menuOpen && <div className="fb-menu">{groups('in-menu')}</div>}
      </span>
      {linkOpen && (
        <span className="fb-link">
          <label className="visually-hidden" htmlFor={linkId}>Link URL</label>
          <input id={linkId} autoFocus type="url" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setLinkOpen(false)
              }
              // The link moves the focus back to the editor, so this Enter must not reach it: it would replace the text.
              if (e.key === 'Enter') {
                e.preventDefault()
                if (linkUrl.trim()) {
                  editor.current?.link(linkUrl.trim())
                  setLinkOpen(false)
                }
              }
            }} />
          <button type="button" className="text-btn" disabled={!linkUrl.trim()}
            onClick={() => { editor.current?.link(linkUrl.trim()); setLinkOpen(false) }}>Apply</button>
          <button type="button" className="text-btn" onClick={() => setLinkOpen(false)}>Cancel</button>
        </span>
      )}
    </div>
  )
}

type ToolProps = { label: string; onClick: () => void; children: ReactNode; disabled?: string; expanded?: boolean }

function Tool({ label, onClick, children, disabled, expanded }: ToolProps) {
  // Keep the text selection: a mouse press on a tool must not move focus out of the editor.
  return (
    <button type="button" className="format-btn" data-tip={disabled ? `${label} · ${disabled}` : label} aria-label={label}
      aria-disabled={disabled ? true : undefined} aria-expanded={expanded}
      onMouseDown={(e) => e.preventDefault()} onClick={() => { if (!disabled) onClick() }}>
      {children}
    </button>
  )
}
