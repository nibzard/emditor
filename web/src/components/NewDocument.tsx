// ABOUTME: A dedicated create flow that never opens an existing fuzzy search result.

import { useState } from 'react'
import type { FileEntry } from '../api'
import { normalizeNewPath } from '../lib/text'
import { Dialog } from './Dialog'

type Props = { files: FileEntry[]; onCreate: (path: string) => Promise<string | null>; onClose: () => void }

export function NewDocument({ files, onCreate, onClose }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const path = normalizeNewPath(name)
  const exists = files.some((file) => file.path.toLowerCase() === path.toLowerCase())

  const create = async () => {
    if (!path || creating) return
    if (exists) { setError('A document with that name already exists.'); return }
    setCreating(true)
    const result = await onCreate(path)
    setCreating(false)
    if (result) setError(result)
  }

  return <Dialog title="New document" onClose={onClose} className="new-document-dialog">{(dismiss) => <>
    <div className="dialog-heading"><h2>New document</h2><button className="text-btn" onClick={dismiss} aria-label="Close new document">Close</button></div>
    <label className="field-label" htmlFor="new-document-name">Document name</label>
    <input id="new-document-name" className="new-document-input" data-autofocus value={name} onChange={(event) => { setName(event.target.value); setError('') }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void create() } }} placeholder="Untitled document" />
    <p className="field-hint">{path || 'Untitled document.md'}</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="btn" disabled={!path || creating} onClick={() => void create()}>{creating ? 'Creating…' : 'Create document'}</button></div>
  </>}
  </Dialog>
}
