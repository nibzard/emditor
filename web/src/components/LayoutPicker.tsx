// ABOUTME: Row of small layout glyphs; each glyph draws the pane grid it stands for.
// ABOUTME: The chosen layout has a sliding pill; ⌥1 to ⌥7 choose the same layouts.

import { motion } from 'motion/react'
import { LAYOUTS, type LayoutId } from '../lib/layouts'
import { pillSpring } from './Segmented'

type Props = { value: LayoutId; onChange: (id: LayoutId) => void }

export function LayoutPicker({ value, onChange }: Props) {
  return (
    <div className="seg layout-picker" role="tablist" aria-label="Pane layout">
      {LAYOUTS.map((layout, i) => {
        const active = layout.id === value
        return (
          <button
            key={layout.id}
            role="tab"
            aria-selected={active}
            aria-label={layout.label}
            title={`${layout.label}  ⌥${i + 1}`}
            onClick={() => onChange(layout.id)}
            onMouseDown={(e) => e.preventDefault()}
          >
            {active && <motion.span layoutId="seg-layout" className="seg-pill" transition={pillSpring} />}
            <span
              className="layout-glyph"
              style={{
                gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
              }}
            >
              {layout.cells.map((cell, j) => (
                <span
                  key={j}
                  style={{ gridColumn: `${cell.col + 1} / span ${cell.w}`, gridRow: `${cell.row + 1} / span ${cell.h}` }}
                />
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
