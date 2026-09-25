// ABOUTME: React access to the folder's document and notes stores and their global save lifecycle.
// ABOUTME: The stores outlive panes, so layout and editor changes never own the only draft.

import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { Note, TextQuote } from '../lib/annotations'
import { DocumentStore } from './documentStore'
import { NotesStore } from './notesStore'

export type { SaveStatus } from './documentStore'

const Context = createContext<DocumentStore | null>(null)
const NotesContext = createContext<NotesStore | null>(null)

export function DocumentProvider({ root, children }: { root: string; children: ReactNode }) {
  const [store] = useState(() => new DocumentStore(root))
  const [notes] = useState(() => new NotesStore())
  useEffect(() => {
    const onSave = () => { void store.saveAll(); void notes.saveAll() }
    const onHidden = () => { if (document.visibilityState === 'hidden') onSave() }
    const onFocus = () => { void store.refresh(); void notes.refresh() }
    const onUnload = (event: BeforeUnloadEvent) => {
      if (store.hasUnsettled() || notes.hasUnsettled()) event.preventDefault()
    }
    window.addEventListener('emditor:save-all', onSave)
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('focus', onFocus)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('emditor:save-all', onSave)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [store, notes])
  return <Context.Provider value={store}><NotesContext.Provider value={notes}>{children}</NotesContext.Provider></Context.Provider>
}

export function useDocumentStore() {
  const store = useContext(Context)
  if (!store) throw new Error('DocumentProvider is missing')
  return store
}

export function useDocumentProblems() {
  const store = useDocumentStore()
  return useSyncExternalStore(store.subscribeProblems, store.getProblems, store.getProblems)
}

export function useDocument(path: string | null) {
  const store = useDocumentStore()
  useEffect(() => {
    if (path) store.open(path)
    return () => { if (path) void store.save(path) }
  }, [store, path])
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(path, listener),
    () => store.getSnapshot(path),
    () => store.getSnapshot(path),
  )
  return {
    ...snapshot,
    edit: (markdown: string) => { if (path) store.edit(path, markdown) },
    save: () => path ? store.save(path) : Promise.resolve(),
    reload: () => path ? store.reload(path) : Promise.resolve(),
    keepMine: () => path ? store.retry(path, true) : Promise.resolve(),
    retry: () => path ? store.retry(path) : Promise.resolve(),
  }
}

export function useNotes(path: string | null) {
  const store = useContext(NotesContext)
  if (!store) throw new Error('DocumentProvider is missing')
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(path, listener),
    () => store.getSnapshot(path),
    () => store.getSnapshot(path),
  )
  return {
    ...snapshot,
    add: (note: Note) => { if (path) store.add(path, note) },
    update: (id: string, patch: Partial<Pick<Note, 'body' | 'resolved' | 'quote' | 'color'>>) => { if (path) store.update(path, id, patch) },
    requote: (quotes: Map<string, TextQuote>) => { if (path) store.requote(path, quotes) },
    remove: (id: string) => { if (path) store.remove(path, id) },
    retry: () => (path ? store.save(path) : Promise.resolve()),
  }
}
