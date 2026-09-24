// ABOUTME: The workspace grid that places panes in the chosen layout.
// ABOUTME: Panes keep their identity across layout changes, so editors do not restart.

import { LayoutGroup } from 'motion/react'
import { type Dispatch, useEffect, useMemo } from 'react'
import { getLayout } from '../lib/layouts'
import { ScrollSync } from '../lib/scrollSync'
import type { Work, WorkAction } from '../lib/workspace'
import { Pane } from './Pane'

type Props = {
  work: Work
  dispatch: Dispatch<WorkAction>
  focusSignal: number
  onPick: (index: number) => void
  onSplit: (path: string) => void
}

export function Workspace({ work, dispatch, focusSignal, onPick, onSplit }: Props) {
  const sync = useMemo(() => new ScrollSync(), [])
  useEffect(() => {
    sync.enabled = work.lock
  }, [sync, work.lock])

  const layout = getLayout(work.layout)
  return (
    <LayoutGroup id="workspace">
      <div
        className="workspace"
        data-layout={layout.id}
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        }}
      >
        {work.panes.map((pane, i) => {
          const cell = layout.cells[i]
          if (!cell) return null
          return (
            <Pane
              key={pane.id}
              pane={pane}
              focused={i === work.focus}
              focusSignal={focusSignal}
              sync={sync}
              style={{ gridColumn: `${cell.col + 1} / span ${cell.w}`, gridRow: `${cell.row + 1} / span ${cell.h}` }}
              onFocus={() => i !== work.focus && dispatch({ type: 'focus', index: i })}
              onMode={(mode) => dispatch({ type: 'mode', index: i, mode })}
              onClose={() => dispatch({ type: 'close', index: i })}
              onPick={() => onPick(i)}
              onSplit={() => pane.path && onSplit(pane.path)}
            />
          )
        })}
      </div>
    </LayoutGroup>
  )
}
