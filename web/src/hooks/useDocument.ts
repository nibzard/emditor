// ABOUTME: Loads one Markdown file and saves changes to it automatically.
// ABOUTME: It detects changes on disk, reports conflicts, and saves before the file closes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { wordCount } from '../lib/text'

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'conflict' | 'error'

export type LoadedDoc = { path: string; content: string; version: number }

const SAVE_DELAY_MS = 700

/** Event name that makes every open document save now. */
export const SAVE_ALL_EVENT = 'emditor:save-all'

export function useDocument(path: string | null) {
  const [doc, setDoc] = useState<LoadedDoc | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [words, setWords] = useState(0)

  const pathRef = useRef<string | null>(null)
  const content = useRef('')
  const dirty = useRef(false)
  const bases = useRef(new Map<string, number>())
  const timer = useRef<number | undefined>(undefined)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const version = useRef(0)

  /** Saves the current text. It takes a snapshot now, and writes after earlier saves finish. */
  const save = useCallback((force = false) => {
    window.clearTimeout(timer.current)
    const p = pathRef.current
    if (!p || !dirty.current) return chain.current
    const text = content.current
    dirty.current = false
    chain.current = chain.current.then(async () => {
      if (pathRef.current === p) setStatus('saving')
      try {
        const saved = await api.write(p, text, force ? undefined : bases.current.get(p))
        bases.current.set(p, saved.modified)
        if (pathRef.current === p) setStatus(dirty.current ? 'unsaved' : 'saved')
      } catch (err) {
        console.error(`emditor: cannot save ${p}`, err)
        if (pathRef.current === p) {
          dirty.current = true
          setStatus(err instanceof ApiError && err.code === 'conflict' ? 'conflict' : 'error')
        }
      }
    })
    return chain.current
  }, [])

  const load = useCallback(async (p: string) => {
    const loaded = await api.read(p)
    if (pathRef.current !== p) return
    content.current = loaded.content
    dirty.current = false
    bases.current.set(p, loaded.modified)
    setWords(wordCount(loaded.content))
    setStatus('idle')
    version.current += 1
    setDoc({ path: p, content: loaded.content, version: version.current })
  }, [])

  useEffect(() => {
    pathRef.current = path
    dirty.current = false
    setStatus('idle')
    if (!path) {
      setDoc(null)
      return
    }
    load(path).catch((err) => {
      console.error(`emditor: cannot open ${path}`, err)
      if (pathRef.current === path) {
        setDoc(null)
        setStatus('error')
      }
    })
    // The cleanup runs before the next path is set, so this saves the file that closes.
    return () => void save()
  }, [path, load, save])

  const edit = useCallback(
    (markdown: string) => {
      content.current = markdown
      dirty.current = true
      setStatus('unsaved')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setWords(wordCount(content.current))
        void save()
      }, SAVE_DELAY_MS)
    },
    [save],
  )

  /** Loads the file again when it changed on disk and there are no unsaved edits. */
  const refreshIfChanged = useCallback(async () => {
    const p = pathRef.current
    if (!p || dirty.current) return
    try {
      const onDisk = await api.read(p)
      if (pathRef.current === p && !dirty.current && onDisk.modified !== bases.current.get(p)) await load(p)
    } catch {
      // The file can be gone or busy. The next focus tries again.
    }
  }, [load])

  const reload = useCallback(() => {
    if (pathRef.current) void load(pathRef.current)
  }, [load])

  const keepMine = useCallback(() => {
    dirty.current = true
    void save(true)
  }, [save])

  useEffect(() => {
    const flush = () => void save()
    const onHidden = () => document.visibilityState === 'hidden' && flush()
    const onFocus = () => void refreshIfChanged()
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault()
    }
    window.addEventListener(SAVE_ALL_EVENT, flush)
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('focus', onFocus)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener(SAVE_ALL_EVENT, flush)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [save, refreshIfChanged])

  return { doc, status, words, edit, save, reload, keepMine }
}
