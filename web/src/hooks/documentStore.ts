// ABOUTME: Keeps document buffers and save state for the whole folder, independent of panes.
// ABOUTME: Pending or failed writes remain recoverable when a pane closes or changes layout.

import { api, ApiError, type Doc } from '../api'
import { wordCount } from '../lib/text'

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'conflict' | 'error'
export type LoadedDoc = { path: string; content: string; version: number }
export type DocumentSnapshot = { doc: LoadedDoc | null; status: SaveStatus; words: number }
export type DocumentProblem = { path: string; status: 'conflict' | 'error' }

type Draft = { content: string; baseModified?: number }
type Entry = {
  path: string
  snapshot: DocumentSnapshot
  content: string
  baseModified?: number
  revision: number
  acknowledged: number
  queuedRevision: number
  version: number
  pending: number
  blocked: boolean
  timer?: ReturnType<typeof setTimeout>
  chain: Promise<void>
  listeners: Set<() => void>
}

const EMPTY: DocumentSnapshot = { doc: null, status: 'idle', words: 0 }
const SAVE_DELAY_MS = 700

export class DocumentStore {
  private entries = new Map<string, Entry>()
  private drafts = new Map<string, Draft>()
  private allListeners = new Set<() => void>()
  private problems: DocumentProblem[] = []
  private readonly storageKey: string

  constructor(
    root: string,
    private readonly client: Pick<typeof api, 'read' | 'write'> = api,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    this.storageKey = `emditor.drafts:${root}`
    try {
      const stored: unknown = JSON.parse(this.storage?.getItem(this.storageKey) ?? 'null')
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [path, draft] of Object.entries(stored)) {
          if (!draft || typeof draft !== 'object' || !('content' in draft) || typeof draft.content !== 'string') continue
          const base = 'baseModified' in draft && typeof draft.baseModified === 'number' ? draft.baseModified : undefined
          this.drafts.set(path, { content: draft.content, baseModified: base })
        }
      }
    } catch {
      // Private browsing and malformed old storage must not prevent opening a folder.
    }
  }

  private persistDrafts() {
    try {
      if (this.drafts.size === 0) this.storage?.removeItem(this.storageKey)
      else this.storage?.setItem(this.storageKey, JSON.stringify(Object.fromEntries(this.drafts)))
    } catch {
      // Saving to disk remains available when browser storage is disabled or full.
    }
  }

  private remember(entry: Entry) {
    if (entry.revision > entry.acknowledged) {
      this.drafts.set(entry.path, { content: entry.content, baseModified: entry.baseModified })
    } else {
      this.drafts.delete(entry.path)
    }
    this.persistDrafts()
  }

  private publish(entry: Entry, snapshot: DocumentSnapshot) {
    entry.snapshot = snapshot
    for (const listener of entry.listeners) listener()
    const problems = [...this.entries.values()]
      .filter((item): item is Entry & { snapshot: DocumentSnapshot & { status: 'conflict' | 'error' } } =>
        item.snapshot.status === 'conflict' || item.snapshot.status === 'error',
      )
      .map((item) => ({ path: item.path, status: item.snapshot.status }))
    if (JSON.stringify(problems) !== JSON.stringify(this.problems)) {
      this.problems = problems
      for (const listener of this.allListeners) listener()
    }
  }

  private entry(path: string): Entry {
    let entry = this.entries.get(path)
    if (entry) return entry
    const draft = this.drafts.get(path)
    const doc = draft ? { path, content: draft.content, version: 1 } : null
    entry = {
      path,
      snapshot: { doc, status: draft ? 'unsaved' : 'idle', words: draft ? wordCount(draft.content) : 0 },
      content: draft?.content ?? '',
      baseModified: draft?.baseModified,
      revision: draft ? 1 : 0,
      acknowledged: 0,
      queuedRevision: 0,
      version: draft ? 1 : 0,
      pending: 0,
      blocked: false,
      chain: Promise.resolve(),
      listeners: new Set(),
    }
    this.entries.set(path, entry)
    void this.loadInitial(entry, Boolean(draft))
    return entry
  }

  private async loadInitial(entry: Entry, hasDraft: boolean) {
    try {
      const disk = await this.client.read(entry.path)
      if (hasDraft) {
        if (disk.modified !== entry.baseModified) {
          entry.blocked = true
          this.publish(entry, { ...entry.snapshot, status: 'conflict' })
        } else {
          this.schedule(entry)
        }
      } else if (entry.revision === 0) {
        this.acceptDisk(entry, disk)
      }
    } catch (err) {
      console.error(`emditor: cannot open ${entry.path}`, err)
      this.publish(entry, { ...entry.snapshot, status: 'error' })
    }
  }

  private acceptDisk(entry: Entry, disk: Doc) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.content = disk.content
    entry.baseModified = disk.modified
    entry.revision += 1
    entry.acknowledged = entry.revision
    entry.queuedRevision = entry.revision
    entry.blocked = false
    entry.version += 1
    this.remember(entry)
    this.publish(entry, {
      doc: { path: entry.path, content: disk.content, version: entry.version },
      status: 'saved',
      words: wordCount(disk.content),
    })
  }

  private schedule(entry: Entry) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.save(entry.path), SAVE_DELAY_MS)
  }

  getSnapshot = (path: string | null): DocumentSnapshot => path ? this.entries.get(path)?.snapshot ?? EMPTY : EMPTY
  getProblems = (): DocumentProblem[] => this.problems
  searchableDrafts = (): { path: string; content: string }[] => [...this.drafts].map(([path, draft]) => ({ path, content: draft.content }))
  subscribeProblems = (listener: () => void) => {
    this.allListeners.add(listener)
    return () => this.allListeners.delete(listener)
  }
  subscribe = (path: string | null, listener: () => void) => {
    if (!path) return () => {}
    const entry = this.entry(path)
    entry.listeners.add(listener)
    listener()
    return () => entry.listeners.delete(listener)
  }

  open(path: string) { this.entry(path) }

  edit(path: string, markdown: string) {
    const entry = this.entry(path)
    if (markdown === entry.content) return
    entry.content = markdown
    entry.revision += 1
    entry.blocked = false
    this.remember(entry)
    this.publish(entry, {
      doc: { path, content: markdown, version: entry.version },
      status: 'unsaved',
      words: wordCount(markdown),
    })
    this.schedule(entry)
  }

  save(path: string, force = false): Promise<void> {
    const entry = this.entries.get(path)
    if (!entry) return Promise.resolve()
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    if (entry.revision <= entry.acknowledged || (entry.blocked && !force)) return entry.chain
    if (entry.revision <= entry.queuedRevision && !force) return entry.chain
    const revision = entry.revision
    const content = entry.content
    entry.queuedRevision = revision
    entry.pending += 1
    this.publish(entry, { ...entry.snapshot, status: 'saving' })
    entry.chain = entry.chain.then(async () => {
      if (entry.blocked && !force) return
      try {
        const saved = await this.client.write(path, content, force ? undefined : entry.baseModified)
        entry.baseModified = saved.modified
        entry.acknowledged = Math.max(entry.acknowledged, revision)
        this.remember(entry)
        this.publish(entry, { ...entry.snapshot, status: entry.revision > entry.acknowledged ? 'unsaved' : 'saved' })
      } catch (err) {
        console.error(`emditor: cannot save ${path}`, err)
        entry.blocked = true
        entry.queuedRevision = entry.acknowledged
        this.remember(entry)
        this.publish(entry, { ...entry.snapshot, status: err instanceof ApiError && err.code === 'conflict' ? 'conflict' : 'error' })
      }
    }).finally(() => {
      entry.pending -= 1
      if (entry.pending === 0 && entry.revision > entry.acknowledged && !entry.blocked && !entry.timer) this.schedule(entry)
    })
    return entry.chain
  }

  saveAll = () => Promise.all([...this.entries.keys()].map((path) => this.save(path))).then(() => {})
  hasUnsettled = () => [...this.entries.values()].some((entry) => entry.revision > entry.acknowledged || entry.pending > 0)

  async refresh() {
    await Promise.all([...this.entries.values()].map(async (entry) => {
      if (entry.revision > entry.acknowledged || entry.pending > 0) return
      const revision = entry.revision
      try {
        const disk = await this.client.read(entry.path)
        if (entry.revision === revision && entry.pending === 0 && disk.modified !== entry.baseModified) this.acceptDisk(entry, disk)
      } catch {
        // A later focus will retry when another program finishes writing the file.
      }
    }))
  }

  async reload(path: string) {
    const entry = this.entries.get(path)
    if (!entry) return
    await entry.chain
    try {
      const disk = await this.client.read(path)
      this.acceptDisk(entry, disk)
    } catch (err) {
      console.error(`emditor: cannot reload ${path}`, err)
      this.publish(entry, { ...entry.snapshot, status: 'error' })
    }
  }

  retry(path: string, force = false) {
    const entry = this.entries.get(path)
    if (!entry) return Promise.resolve()
    entry.blocked = false
    return this.save(path, force)
  }
}
