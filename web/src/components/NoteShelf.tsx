// ABOUTME: The shelf under the sheet: accept all cuts, notes without a place in the text, and resolved notes.
// ABOUTME: A detached note can go back on the text that is selected; a resolved note can open again.

import { type ReactNode, useState } from 'react'
import { kindOf, type Note } from '../lib/annotations'
import type { NotesStatus } from '../hooks/notesStore'

type Props = {
  detached: Note[]
  resolved: Note[]
  /** The number of suggested cuts in the text. */
  cuts: number
  status: NotesStatus
  /** Moves a note to the selected text. Returns false when no text is selected. */
  onAttach: (id: string) => boolean
  onReopen: (id: string) => void
  onDelete: (id: string) => void
  onRetry: () => void
  onAcceptAllCuts: () => void
}

export function NoteShelf({ detached, resolved, cuts, status, onAttach, onReopen, onDelete, onRetry, onAcceptAllCuts }: Props) {
  const [hint, setHint] = useState<string | null>(null)
  if (!detached.length && !resolved.length && !cuts && status !== 'error') return null

  return (
    <section className="note-shelf" aria-label="Other notes">
      {status === 'error' && (
        <p className="note-shelf-error">
          The notes could not be saved. <button type="button" className="text-btn" onClick={onRetry}>Retry</button>
        </p>
      )}
      {cuts > 0 && (
        <p className="note-shelf-cuts">
          {cuts} suggested {cuts === 1 ? 'cut' : 'cuts'}
          <button type="button" className="text-btn" onClick={onAcceptAllCuts}>Accept all cuts</button>
        </p>
      )}
      {detached.length > 0 && (
        <>
          <h3>Marks that lost their text</h3>
          {hint && <p className="note-shelf-hint">{hint}</p>}
          {detached.map((note) => (
            <ShelfNote key={note.id} note={note}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => {
                setHint(onAttach(note.id) ? null : 'Select text in the document, then attach the note again.')
              }}>Attach to selection</button>
              <button type="button" onClick={() => onDelete(note.id)}>Delete</button>
            </ShelfNote>
          ))}
        </>
      )}
      {resolved.length > 0 && (
        <details>
          <summary>{resolved.length} resolved {resolved.length === 1 ? 'note' : 'notes'}</summary>
          {resolved.map((note) => (
            <ShelfNote key={note.id} note={note}>
              <button type="button" onClick={() => onReopen(note.id)}>Reopen</button>
              <button type="button" onClick={() => onDelete(note.id)}>Delete</button>
            </ShelfNote>
          ))}
        </details>
      )}
    </section>
  )
}

function ShelfNote({ note, children }: { note: Note; children: ReactNode }) {
  return (
    <div className="shelf-note" data-kind={kindOf(note)}>
      <blockquote>{note.quote.exact}</blockquote>
      {note.body && <p>{note.body}</p>}
      <span className="note-actions">{children}</span>
    </div>
  )
}
