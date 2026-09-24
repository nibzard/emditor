// ABOUTME: Keyboard and pointer accessible document finder for the current or a new pane.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry } from '../api'
import { dirOf, fuzzyScore, titleFromPath } from '../lib/text'
import { Dialog } from './Dialog'

type Props = { files: FileEntry[]; title: string; onOpen: (path: string, newPane: boolean) => void; onClose: () => void }

export function Palette({ files, title, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const options = useMemo(() => files
    .map((file) => ({ file, score: fuzzyScore(query, file.path) }))
    .filter((result): result is { file: FileEntry; score: number } => result.score !== null)
    .sort((a, b) => query ? a.score - b.score : b.file.modified - a.file.modified)
    .slice(0, 50).map((result) => result.file), [files, query])

  useEffect(() => setActive(0), [query])
  useEffect(() => { listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' }) }, [active])

  return <Dialog title={title} onClose={onClose} className="palette">{(dismiss) => <>
    <label className="visually-hidden" htmlFor="palette-input">Find a document</label>
    <input id="palette-input" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="palette-options"
      aria-activedescendant={options[active] ? `palette-option-${active}` : undefined}
      className="palette-input" placeholder="Find a document…" value={query} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((index) => options.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (options[active]) onOpen(options[active].path, event.shiftKey)
        }
      }} />
    <div className="palette-list" id="palette-options" ref={listRef} role="listbox" aria-label="Documents">
      {options.length === 0 && <div className="palette-none">No matching documents</div>}
      {options.map((file, index) => <div key={file.path} id={`palette-option-${index}`} className="palette-row" role="option" aria-selected={index === active}
        data-active={index === active} onMouseMove={() => setActive(index)} onClick={(event) => onOpen(file.path, event.shiftKey)}>
        <span className="palette-title">{titleFromPath(file.path)}</span><span className="palette-dir">{dirOf(file.path)}</span>
      </div>)}
    </div>
    <div className="palette-foot"><span>{title}</span><span className="spacer" /><span><kbd>↵</kbd> open</span><span><kbd>⇧↵</kbd> open beside</span>
      <button className="text-btn" onClick={dismiss}>Close</button></div>
    </>}
  </Dialog>
}
