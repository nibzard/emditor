// ABOUTME: Keeps the notes of each open document and saves them to the sidecar notes file.
// ABOUTME: It merges against the loaded state after a conflict, and a notes file it cannot read stays as it is.

import { api, ApiError } from '../api'
import { type LoadedNotes, mergeNotes, type Note, type NotesFileError, parseNotes, serializeNotes, type TextQuote } from '../lib/annotations'

export type NotesStatus = 'idle' | 'saving' | 'saved' | 'error'
/** Why the notes of a document could not be read: the read failed, or the file cannot be read as notes. */
export type NotesLoadError = NotesFileError | 'read-failed'
export type NotesSnapshot = { notes: Note[]; loaded: boolean; status: NotesStatus; loadError: NotesLoadError | null }

type Entry = {
  path: string
  snapshot: NotesSnapshot
  notes: Note[]
  /** The notes as they were on disk when they were last read or written. This is the base of every merge. */
  base: Note[]
  baseModified: number
  revision: number
  acknowledged: number
  loaded: boolean
  loadError: NotesLoadError | null
  /** Reads of this document that are in flight, so the same file is not read twice at once. */
  reading: number
  pending: number
  timer?: ReturnType<typeof setTimeout>
  chain: Promise<void>
  listeners: Set<() => void>
}

const EMPTY: NotesSnapshot = { notes: [], loaded: false, status: 'idle', loadError: null }
const SAVE_DELAY_MS = 500
/** A write that meets a conflict merges and tries again, at most this many times. */
const MAX_ATTEMPTS = 3

export class NotesStore {
  private entries = new Map<string, Entry>()

  constructor(private readonly client: Pick<typeof api, 'readNotes' | 'writeNotes'> = api) {}

  private publish(entry: Entry, status: NotesStatus = entry.snapshot.status) {
    entry.snapshot = { notes: entry.notes, loaded: entry.loaded, status, loadError: entry.loadError }
    for (const listener of entry.listeners) listener()
  }

  private entry(path: string): Entry {
    let entry = this.entries.get(path)
    if (entry) return entry
    entry = {
      path,
      snapshot: EMPTY,
      notes: [],
      base: [],
      baseModified: 0,
      revision: 0,
      acknowledged: 0,
      loaded: false,
      loadError: null,
      reading: 0,
      pending: 0,
      chain: Promise.resolve(),
      listeners: new Set(),
    }
    this.entries.set(path, entry)
    void this.load(entry)
    return entry
  }

  /**
   * Reads what the server gave for the notes file. A missing file has empty content and modified 0, and is a
   * valid empty list. Any other content that does not parse keeps the file as it is, because a write could
   * destroy it.
   */
  private parseDisk(content: string, modified: number): LoadedNotes {
    return content === '' && modified === 0 ? { notes: [], error: null } : parseNotes(content)
  }

  private async load(entry: Entry) {
    entry.reading += 1
    try {
      const disk = await this.client.readNotes(entry.path)
      const parsed = this.parseDisk(disk.content, disk.modified)
      if (parsed.error) {
        entry.loadError = parsed.error
        this.publish(entry, 'error')
        return
      }
      entry.notes = entry.revision > 0 ? mergeNotes(entry.base, parsed.notes, entry.notes) : parsed.notes
      entry.base = parsed.notes
      entry.baseModified = disk.modified
      entry.loaded = true
      entry.loadError = null
      this.publish(entry, entry.revision > entry.acknowledged ? 'saving' : 'idle')
      if (entry.revision > entry.acknowledged) await this.save(entry.path)
    } catch (err) {
      console.error(`emditor: cannot load the notes of ${entry.path}`, err)
      entry.loadError = 'read-failed'
      this.publish(entry, 'error')
    } finally {
      entry.reading -= 1
    }
  }

  private change(path: string, notes: (current: Note[]) => Note[]) {
    const entry = this.entry(path)
    entry.notes = notes(entry.notes)
    entry.revision += 1
    this.publish(entry)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.save(path), SAVE_DELAY_MS)
  }

  getSnapshot = (path: string | null): NotesSnapshot => (path ? this.entries.get(path)?.snapshot ?? EMPTY : EMPTY)

  subscribe = (path: string | null, listener: () => void) => {
    if (!path) return () => {}
    const entry = this.entry(path)
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  add(path: string, note: Note) {
    this.change(path, (notes) => [...notes, note])
  }

  update(path: string, id: string, patch: Partial<Pick<Note, 'body' | 'resolved' | 'quote' | 'color'>>) {
    this.change(path, (notes) => notes.map((n) => (n.id === id ? { ...n, ...patch } : n)))
  }

  /** Stores fresh quotes for many notes in one change. */
  requote(path: string, quotes: Map<string, TextQuote>) {
    if (quotes.size === 0) return
    this.change(path, (notes) => notes.map((n) => (quotes.has(n.id) ? { ...n, quote: quotes.get(n.id)! } : n)))
  }

  remove(path: string, id: string) {
    this.change(path, (notes) => notes.filter((n) => n.id !== id))
  }

  save(path: string): Promise<void> {
    const entry = this.entries.get(path)
    if (!entry) return Promise.resolve()
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    // Nothing is written before the notes file is read, or while it cannot be read, because the write
    // could hide or destroy the notes that are in it. A later read saves what is waiting.
    if (entry.revision <= entry.acknowledged || !entry.loaded || entry.loadError) return entry.chain
    entry.pending += 1
    this.publish(entry, 'saving')
    entry.chain = entry.chain
      .then(() => this.write(entry))
      .finally(() => {
        entry.pending -= 1
      })
    return entry.chain
  }

  /** Reads the notes file again, for example after it could not be read, and saves what is waiting. */
  retry(path: string): Promise<void> {
    const entry = this.entries.get(path)
    if (!entry) return Promise.resolve()
    if (entry.loaded && !entry.loadError) return this.save(path)
    return this.load(entry)
  }

  private async write(entry: Entry) {
    if (entry.revision <= entry.acknowledged) return
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const revision = entry.revision
      // The notes that go into this write are also the base of the next merge. A change that lands while the
      // write is in flight is not on disk yet, so it must not become the base.
      const written = entry.notes
      try {
        const saved = await this.client.writeNotes(entry.path, serializeNotes(written), entry.baseModified)
        entry.baseModified = saved.modified
        entry.base = written
        entry.acknowledged = Math.max(entry.acknowledged, revision)
        this.publish(entry, entry.revision > entry.acknowledged ? 'saving' : 'saved')
        if (entry.revision > entry.acknowledged) void this.save(entry.path)
        return
      } catch (err) {
        if (err instanceof ApiError && err.code === 'conflict' && attempt < MAX_ATTEMPTS) {
          try {
            const disk = await this.client.readNotes(entry.path)
            const parsed = this.parseDisk(disk.content, disk.modified)
            if (parsed.error) {
              entry.loadError = parsed.error
              this.publish(entry, 'error')
              return
            }
            entry.notes = mergeNotes(entry.base, parsed.notes, entry.notes)
            entry.base = parsed.notes
            entry.baseModified = disk.modified
            this.publish(entry)
            continue
          } catch (readErr) {
            err = readErr
          }
        }
        console.error(`emditor: cannot save the notes of ${entry.path}`, err)
        this.publish(entry, 'error')
        return
      }
    }
  }

  saveAll = () => Promise.all([...this.entries.keys()].map((path) => this.save(path))).then(() => {})

  hasUnsettled = () => [...this.entries.values()].some((e) => e.revision > e.acknowledged || e.pending > 0)

  /** Takes notes that another program changed, and gives a failed first read another chance. */
  async refresh() {
    await Promise.all([...this.entries.values()].map(async (entry) => {
      if (entry.reading > 0 || entry.revision > entry.acknowledged || entry.pending > 0) return
      if (!entry.loaded || entry.loadError) {
        await this.load(entry)
        return
      }
      const revision = entry.revision
      try {
        const disk = await this.client.readNotes(entry.path)
        if (entry.revision !== revision || entry.pending > 0 || disk.modified === entry.baseModified) return
        const parsed = this.parseDisk(disk.content, disk.modified)
        if (parsed.error) {
          // The notes that are here stay as they are, and nothing is written over the damaged file.
          entry.loadError = parsed.error
          this.publish(entry, 'error')
          return
        }
        entry.notes = mergeNotes(entry.base, parsed.notes, entry.notes)
        entry.base = parsed.notes
        entry.baseModified = disk.modified
        entry.loadError = null
        this.publish(entry)
      } catch {
        // A later focus will try again.
      }
    }))
  }
}
