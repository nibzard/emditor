// ABOUTME: React access to the folder's document, notes, and rules stores, their global save lifecycle, and rewrites.
// ABOUTME: The stores outlive panes, so layout and editor changes never own the only draft.

import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import type { Note, TextQuote } from '../lib/annotations'
import { DocumentStore } from './documentStore'
import { NotesStore } from './notesStore'
import { RulesStore } from './rulesStore'

export type { SaveStatus } from './documentStore'

const Context = createContext<DocumentStore | null>(null)
const NotesContext = createContext<NotesStore | null>(null)
const RulesContext = createContext<RulesStore | null>(null)
const RewriteContext = createContext<string | null>(null)
const JevContext = createContext<string | null>(null)

export function DocumentProvider({ root, children }: { root: string; children: ReactNode }) {
  const [store] = useState(() => new DocumentStore(root))
  const [notes] = useState(() => new NotesStore())
  const [rules] = useState(() => new RulesStore())
  const [rewriteModel, setRewriteModel] = useState<string | null>(null)
  const [jevModel, setJevModel] = useState<string | null>(null)
  useEffect(() => {
    api.rewriteStatus().then((status) => setRewriteModel(status.available ? status.model ?? null : null), (err) => console.error('emditor: cannot read the rewrite status', err))
    api.jevStatus().then((status) => setJevModel(status.available ? status.model ?? null : null), (err) => console.error('emditor: cannot read the Jev status', err))
  }, [])
  useEffect(() => {
    const onSave = () => { void store.saveAll(); void notes.saveAll() }
    const onHidden = () => { if (document.visibilityState === 'hidden') onSave() }
    const onFocus = () => { void store.refresh(); void notes.refresh(); void rules.refresh() }
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
  }, [store, notes, rules])
  return (
    <Context.Provider value={store}>
      <NotesContext.Provider value={notes}>
        <RulesContext.Provider value={rules}>
          <RewriteContext.Provider value={rewriteModel}>
            <JevContext.Provider value={jevModel}>{children}</JevContext.Provider>
          </RewriteContext.Provider>
        </RulesContext.Provider>
      </NotesContext.Provider>
    </Context.Provider>
  )
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
    retry: () => (path ? store.retry(path) : Promise.resolve()),
  }
}

export function useRules() {
  const store = useContext(RulesContext)
  if (!store) throw new Error('DocumentProvider is missing')
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { ...snapshot, change: store.change.bind(store), retry: store.retry.bind(store) }
}

/** The model that rewrites passages, or null when rewrites are off. */
export function useRewriteModel() {
  return useContext(RewriteContext)
}

/** The Jev model that checks semantic rules, or null when semantic rules are off. */
export function useJevModel() {
  return useContext(JevContext)
}
