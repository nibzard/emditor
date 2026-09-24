// ABOUTME: React access to the folder's document store and its global save lifecycle.
// ABOUTME: The store outlives panes, so layout and editor changes never own the only draft.

import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { DocumentStore } from './documentStore'

export type { SaveStatus } from './documentStore'

const Context = createContext<DocumentStore | null>(null)

export function DocumentProvider({ root, children }: { root: string; children: ReactNode }) {
  const [store] = useState(() => new DocumentStore(root))
  useEffect(() => {
    const onSave = () => void store.saveAll()
    const onHidden = () => { if (document.visibilityState === 'hidden') onSave() }
    const onFocus = () => void store.refresh()
    const onUnload = (event: BeforeUnloadEvent) => {
      if (store.hasUnsettled()) event.preventDefault()
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
  }, [store])
  return <Context.Provider value={store}>{children}</Context.Provider>
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
