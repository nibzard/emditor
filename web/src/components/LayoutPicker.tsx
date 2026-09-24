// ABOUTME: An Arrange icon control that reveals the full pane layout choices on demand.

import { useEffect, useRef, useState } from 'react'
import { LAYOUTS, type LayoutId } from '../lib/layouts'
import { ArrangeIcon } from './icons'

type Props = { value: LayoutId; onChange: (id: LayoutId) => void }

export function LayoutPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onOutside); document.removeEventListener('keydown', onKey) }
  }, [open])

  return <div className="layout-picker" ref={root}>
    <button className="icon-btn" aria-label="Arrange" data-tip={open ? undefined : 'Arrange'} aria-expanded={open} aria-controls="layout-options"
      onClick={() => setOpen((current) => !current)}><ArrangeIcon /></button>
    {open && <div className="layout-menu" id="layout-options" aria-label="Pane layouts">
      {LAYOUTS.map((layout, index) => <button key={layout.id} className="layout-option" aria-current={layout.id === value ? 'true' : undefined}
        onClick={() => { onChange(layout.id); setOpen(false) }}>
        <span className="layout-glyph" aria-hidden style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}>
          {layout.cells.map((cell, cellIndex) => <span key={cellIndex} style={{ gridColumn: `${cell.col + 1} / span ${cell.w}`, gridRow: `${cell.row + 1} / span ${cell.h}` }} />)}
        </span>
        <span>{layout.label}</span><kbd>⌥{index + 1}</kbd>
      </button>)}
    </div>}
  </div>
}
