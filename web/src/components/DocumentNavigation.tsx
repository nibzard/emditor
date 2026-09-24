// ABOUTME: Visible document finding and return path for the writing workspace.

import { useMemo, useState } from 'react'
import type { FileEntry } from '../api'
import type { DocumentProblem } from '../hooks/documentStore'
import { dirOf, timeAgo, titleFromPath } from '../lib/text'
import { DeskIcon, SearchIcon } from './icons'

type Props = {
  files: FileEntry[]
  openPaths: Set<string>
  focusedPath: string | null
  shelf: string[]
  problems: DocumentProblem[]
  onOpen: (path: string) => void
  onDesk: () => void
}

export function DocumentNavigation({ files, openPaths, focusedPath, shelf, problems, onOpen, onDesk }: Props) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => files.filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.modified - a.modified), [files, query])
  const allPaths = new Set(files.map((file) => file.path))
  const problemPaths = new Set(problems.map((problem) => problem.path))

  return <aside className="documents-nav" aria-label="Documents">
    <div className="documents-nav-head"><h2>Documents</h2><button className="icon-btn icon-btn-sm" onClick={onDesk} data-tip="Paper desk ⌥0" aria-label="Paper desk"><DeskIcon /></button></div>
    <label className="visually-hidden" htmlFor="document-filter">Find a document</label>
    <span className="document-filter-wrap"><SearchIcon />
      <input id="document-filter" type="search" className="document-filter" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter" /></span>
    <div className="documents-list" role="navigation" aria-label="Recent documents">
      {results.length === 0 && <p className="documents-empty">No matching documents.</p>}
      {results.map((file) => <button key={file.path} className="document-row" aria-current={focusedPath === file.path ? 'page' : undefined}
        onClick={() => onOpen(file.path)}>
        <span className="document-row-title">{titleFromPath(file.path)}</span>
        <span className="document-row-detail">{problemPaths.has(file.path) ? 'Needs attention · ' : openPaths.has(file.path) ? 'Open · ' : ''}{dirOf(file.path) || timeAgo(file.modified)}</span>
      </button>)}
    </div>
    {shelf.some((path) => allPaths.has(path)) && <div className="documents-shelf"><h3>Previously viewed</h3>
      {shelf.filter((path) => allPaths.has(path)).map((path) => <button key={path} className="document-row" onClick={() => onOpen(path)}>Return to {titleFromPath(path)}</button>)}
    </div>}
  </aside>
}
