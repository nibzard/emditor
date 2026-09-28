// ABOUTME: Keeps document buffers and save state for the whole folder, independent of panes.
// ABOUTME: Pending or failed writes remain recoverable when a pane closes or changes layout.

import { api, ApiError, type Doc } from '../api'
import { wordCount } from '../lib/text'

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'conflict' | 'error'
export type LoadedDoc = { path: string; content: string; version: number }
export type DocumentSnapshot = { doc: LoadedDoc | null; status: SaveStatus; words: number }
export type DocumentProblem = { path: string; status: 'conflict' | 'error' }

type Draft = { content: string; baseModified?: number; at: number }
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

// Draft backups in browser storage:
// - Each browser tab owns one key, `emditor.tabdrafts:<encoded folder>:<tab id>`.
//   The value is a map `{ [path]: { content, baseModified?, at } }` with `at` in
//   epoch milliseconds. A store writes and removes only its own key, so one tab
//   cannot discard the draft backup of another tab. The tab id lives in
//   sessionStorage and stays the same through page reloads.
// - Older releases keep one shared key, `emditor.drafts:<folder>`. A store adopts
//   those drafts into its own key on load and then removes the shared key.
// - On load, a store reads every key of this folder. Drafts from fresh keys
//   become recovery copies; the newest `at` per path wins. A key whose newest
//   draft is older than DEAD_TAB_MS comes from a dead tab and is removed.
// - Two tabs that draft the same path keep separate copies; the save conflict
//   check on the file modification time decides which copy reaches the disk.
const DEAD_TAB_MS = 7 * 24 * 60 * 60 * 1000
const TAB_SESSION_KEY = 'emditor.tab'
const KEY_PREFIX = 'emditor.tabdrafts:'

export function tabDraftKey(root: string, tab: string) {
  return `${KEY_PREFIX}${encodeURIComponent(root)}:${tab}`
}

function loadTabId(): string {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const known = sessionStorage.getItem(TAB_SESSION_KEY)
      if (known) return known
      const created = randomId()
      sessionStorage.setItem(TAB_SESSION_KEY, created)
      return created
    }
  } catch {
    // Storage that throws or is absent gives this store an identity for this page life only.
  }
  return randomId()
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

const EMPTY: DocumentSnapshot = { doc: null, status: 'idle', words: 0 }
const SAVE_DELAY_MS = 700

export class DocumentStore {
  private entries = new Map<string, Entry>()
  // `drafts` holds the recovery copies of every fresh tab; `ownDrafts` holds the
  // subset that this tab persists under its own storage key.
  private drafts = new Map<string, Draft>()
  private ownDrafts = new Map<string, Draft>()
  private allListeners = new Set<() => void>()
  private problems: DocumentProblem[] = []
  private readonly legacyKey: string
  private readonly ownKey: string
  private readonly keyPrefix: string

  constructor(
    root: string,
    private readonly client: Pick<typeof api, 'read' | 'write'> = api,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null = typeof localStorage === 'undefined' ? null : localStorage,
    tab: string = loadTabId(),
  ) {
    this.legacyKey = `emditor.drafts:${root}`
    this.keyPrefix = tabDraftKey(root, '')
    this.ownKey = `${this.keyPrefix}${tab}`
    this.loadDrafts()
  }

  private readDrafts(key: string): Map<string, Draft> {
    const drafts = new Map<string, Draft>()
    let stored: unknown
    try {
      stored = JSON.parse(this.storage?.getItem(key) ?? 'null')
    } catch {
      return drafts
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return drafts
    for (const [path, draft] of Object.entries(stored)) {
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) continue
      if (!('content' in draft) || typeof draft.content !== 'string') continue
      const base = 'baseModified' in draft && typeof draft.baseModified === 'number' ? draft.baseModified : undefined
      const at = 'at' in draft && typeof draft.at === 'number' ? draft.at : 0
      drafts.set(path, { content: draft.content, baseModified: base, at })
    }
    return drafts
  }

  private loadDrafts() {
    const storage = this.storage
    if (!storage) return
    try {
      const now = Date.now()
      const own = this.readDrafts(this.ownKey)
      const legacy = this.readDrafts(this.legacyKey)
      for (const [path, draft] of own) this.drafts.set(path, draft)
      for (const [path, draft] of legacy) {
        if (!this.drafts.has(path)) this.drafts.set(path, { ...draft, at: now })
      }
      const foreignKeys: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key && key.startsWith(this.keyPrefix) && key !== this.ownKey) foreignKeys.push(key)
      }
      for (const key of foreignKeys) {
        const drafts = this.readDrafts(key)
        let newest = 0
        for (const draft of drafts.values()) newest = Math.max(newest, draft.at)
        if (newest < now - DEAD_TAB_MS) {
          storage.removeItem(key)
          continue
        }
        for (const [path, draft] of drafts) {
          const known = this.drafts.get(path)
          if (!known || draft.at > known.at) this.drafts.set(path, draft)
        }
      }
      this.ownDrafts = own
      if (legacy.size > 0) {
        for (const [path, draft] of legacy) {
          if (!own.has(path)) own.set(path, { ...draft, at: now })
        }
        this.persistDrafts()
        storage.removeItem(this.legacyKey)
      }
    } catch {
      // Private browsing and malformed old storage must not prevent opening a folder.
    }
  }

  private persistDrafts() {
    try {
      if (this.ownDrafts.size === 0) this.storage?.removeItem(this.ownKey)
      else this.storage?.setItem(this.ownKey, JSON.stringify(Object.fromEntries(this.ownDrafts)))
    } catch {
      // Saving to disk remains available when browser storage is disabled or full.
    }
  }

  private remember(entry: Entry) {
    if (entry.revision > entry.acknowledged) {
      const draft: Draft = { content: entry.content, baseModified: entry.baseModified, at: Date.now() }
      this.drafts.set(entry.path, draft)
      this.ownDrafts.set(entry.path, draft)
    } else {
      this.drafts.delete(entry.path)
      this.ownDrafts.delete(entry.path)
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
    const revision = entry.revision
    try {
      const disk = await this.client.read(path)
      if (entry.revision === revision && entry.pending === 0) this.acceptDisk(entry, disk)
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
