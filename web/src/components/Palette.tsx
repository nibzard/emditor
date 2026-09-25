// ABOUTME: Finds documents by name or contents and previews matching passages.

import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type FileEntry, type SearchMatch } from '../api'
import { dirOf, fuzzyScore, titleFromPath } from '../lib/text'
import { Dialog } from './Dialog'

type Props = {
  files: FileEntry[]
  drafts: { path: string; content: string }[]
  title: string
  onOpen: (path: string, newPane: boolean, line?: number) => void
  onClose: () => void
}

function draftHits(drafts: Props['drafts'], query: string): SearchMatch[] {
  const needle = query.toLocaleLowerCase()
  if (needle.length < 2) return []
  return drafts.flatMap(({ path, content }) => {
    const lines = content.split('\n')
    const index = lines.findIndex((line) => line.toLocaleLowerCase().includes(needle))
    if (index < 0) return []
    const line = lines[index]
    const at = line.toLocaleLowerCase().indexOf(needle)
    return [{ path, line: index + 1, excerpt: `${at > 60 ? '…' : ''}${line.slice(Math.max(0, at - 60), at + 160)}${at + 160 < line.length ? '…' : ''}` }]
  })
}

export function Palette({ files, drafts, title, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2 || term.length > 200) { setMatches([]); setSearching(false); return }
    let live = true
    setMatches([])
    setSearching(true)
    setSearchError(false)
    const timer = setTimeout(() => {
      void api.search(term).then((found) => { if (live) setMatches(found) })
        .catch(() => { if (live) setSearchError(true) })
        .finally(() => { if (live) setSearching(false) })
    }, 180)
    return () => { live = false; clearTimeout(timer) }
  }, [query])

  const results = useMemo(() => {
    const unsaved = new Set(drafts.map((draft) => draft.path))
    return [...matches.filter((hit) => !unsaved.has(hit.path)), ...draftHits(drafts, query.trim())]
  }, [matches, drafts, query])
  const hits = useMemo(() => new Map(results.map((hit) => [hit.path, hit])), [results])
  const options = useMemo(() => {
    const byPath = new Map(files.map((file) => [file.path, file]))
    const named = files.map((file) => ({ file, score: fuzzyScore(query, file.path) }))
      .filter((item): item is { file: FileEntry; score: number } => item.score !== null)
      .sort((a, b) => query ? a.score - b.score : b.file.modified - a.file.modified)
      .map(({ file }) => file)
    const seen = new Set(named.map((file) => file.path))
    for (const hit of results) {
      const file = byPath.get(hit.path)
      if (file && !seen.has(file.path)) { named.push(file); seen.add(file.path) }
    }
    return named.slice(0, 50)
  }, [files, query, results])
  const chosen = options[active]
  const chosenHit = chosen && hits.get(chosen.path)
  const chosenDraft = drafts.find((draft) => draft.path === chosen?.path)?.content

  useEffect(() => setActive(0), [query])
  useEffect(() => { listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' }) }, [active])
  useEffect(() => {
    if (!chosen) { setPreview(null); return }
    let live = true
    setPreview(chosenDraft ?? null)
    if (chosenDraft === undefined) void api.read(chosen.path).then((doc) => { if (live) setPreview(doc.content) })
      .catch(() => { if (live) setPreview('Could not load this document.') })
    return () => { live = false }
  }, [chosen?.path, chosenDraft])

  const open = (file: FileEntry, beside: boolean) => onOpen(file.path, beside, hits.get(file.path)?.line)
  const previewLines = preview?.split('\n') ?? []
  const previewStart = chosenHit ? Math.max(0, chosenHit.line - 4) : 0
  const previewText = previewLines.slice(previewStart, previewStart + 9).join('\n')

  return <Dialog title={title} onClose={onClose} className="palette palette-with-preview">{(dismiss) => <>
    <label className="visually-hidden" htmlFor="palette-input">Find a document or phrase</label>
    <input id="palette-input" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="palette-options"
      aria-activedescendant={chosen ? `palette-option-${active}` : undefined}
      className="palette-input" placeholder="Find a document or phrase…" value={query} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((index) => options.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (chosen) open(chosen, event.shiftKey)
        }
      }} />
    <div className="palette-content">
      <div className="palette-list" id="palette-options" ref={listRef} role="listbox" aria-label="Documents">
        {options.length === 0 && <div className="palette-none">{searching ? 'Searching contents…' : searchError ? 'Content search failed' : 'No matching documents'}</div>}
        {options.map((file, index) => <div key={file.path} id={`palette-option-${index}`} className="palette-row" role="option" aria-selected={index === active}
          data-active={index === active} onMouseMove={() => setActive(index)} onClick={(event) => open(file, event.shiftKey)}>
          <span className="palette-title">{titleFromPath(file.path)}</span><span className="palette-dir">{dirOf(file.path)}</span>
          {hits.has(file.path) && <span className="palette-hit">Line {hits.get(file.path)!.line}: {hits.get(file.path)!.excerpt}</span>}
        </div>)}
      </div>
      <section className="palette-preview" aria-label="Document preview">
        {chosen && <>
          <div className="palette-preview-head"><strong>{titleFromPath(chosen.path)}</strong><span>{chosen.path}</span></div>
          <pre>{preview === null ? 'Loading…' : previewText}</pre>
          <div className="palette-preview-actions">
            <button className="text-btn" onClick={() => open(chosen, false)}>{chosenHit ? 'Open match in source' : 'Open'}</button>
            <button className="text-btn" onClick={() => open(chosen, true)}>Open beside</button>
          </div>
        </>}
      </section>
    </div>
    <div className="palette-foot"><span>{title}</span><span className="spacer" /><span><kbd>↵</kbd> open</span><span><kbd>⇧↵</kbd> open beside</span>
      <button className="text-btn" onClick={dismiss}>Close</button></div>
    </>}</Dialog>
}
