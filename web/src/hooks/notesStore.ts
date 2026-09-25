// ABOUTME: Keeps the notes of each open document and saves them to the sidecar notes file.
// ABOUTME: After a conflict it merges with the notes on disk and tries again, so no note is lost.

import { api, ApiError } from '../api'
import { mergeNotes, type Note, parseNotes, serializeNotes, type TextQuote } from '../lib/annotations'

export type NotesStatus = 'idle' | 'saving' | 'saved' | 'error'
export type NotesSnapshot = { notes: Note[]; loaded: boolean; status: NotesStatus }

type Entry = {
  path: string
  snapshot: NotesSnapshot
  notes: Note[]
  baseModified: number
  /** Notes deleted here that the notes file on disk can still have. */
  deleted: Set<string>
  revision: number
  acknowledged: number
  loaded: boolean
  pending: number
  timer?: ReturnType<typeof setTimeout>
  chain: Promise<void>
  listeners: Set<() => void>
}

const EMPTY: NotesSnapshot = { notes: [], loaded: false, status: 'idle' }
const SAVE_DELAY_MS = 500
/** A write that meets a conflict merges and tries again, at most this many times. */
const MAX_ATTEMPTS = 3

export class NotesStore {
  private entries = new Map<string, Entry>()

  constructor(private readonly client: Pick<typeof api, 'readNotes' | 'writeNotes'> = api) {}

  private publish(entry: Entry, status: NotesStatus = entry.snapshot.status) {
    entry.snapshot = { notes: entry.notes, loaded: entry.loaded, status }
    for (const listener of entry.listeners) listener()
  }

  private entry(path: string): Entry {
    let entry = this.entries.get(path)
    if (entry) return entry
    entry = {
      path,
      snapshot: EMPTY,
      notes: [],
      baseModified: 0,
      deleted: new Set(),
      revision: 0,
      acknowledged: 0,
      loaded: false,
      pending: 0,
      chain: Promise.resolve(),
      listeners: new Set(),
    }
    this.entries.set(path, entry)
    void this.load(entry)
    return entry
  }

  private async load(entry: Entry) {
    try {
      const disk = await this.client.readNotes(entry.path)
      const notes = parseNotes(disk.content)
      entry.notes = entry.revision > 0 ? mergeNotes(notes, entry.notes, entry.deleted) : notes
      entry.baseModified = disk.modified
      entry.loaded = true
      this.publish(entry)
      if (entry.revision > entry.acknowledged) void this.save(entry.path)
    } catch (err) {
      console.error(`emditor: cannot load the notes of ${entry.path}`, err)
      this.publish(entry, 'error')
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
    this.entry(path).deleted.add(id)
    this.change(path, (notes) => notes.filter((n) => n.id !== id))
  }

  save(path: string): Promise<void> {
    const entry = this.entries.get(path)
    if (!entry) return Promise.resolve()
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    if (entry.revision <= entry.acknowledged) return entry.chain
    entry.pending += 1
    this.publish(entry, 'saving')
    entry.chain = entry.chain
      .then(() => this.write(entry))
      .finally(() => {
        entry.pending -= 1
      })
    return entry.chain
  }

  private async write(entry: Entry) {
    // Nothing is written before the notes file is loaded, because the write could hide notes on disk.
    if (!entry.loaded || entry.revision <= entry.acknowledged) return
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const revision = entry.revision
      const deleted = new Set(entry.deleted)
      try {
        const saved = await this.client.writeNotes(entry.path, serializeNotes(entry.notes), entry.baseModified)
        entry.baseModified = saved.modified
        entry.acknowledged = Math.max(entry.acknowledged, revision)
        for (const id of deleted) entry.deleted.delete(id)
        this.publish(entry, entry.revision > entry.acknowledged ? 'saving' : 'saved')
        if (entry.revision > entry.acknowledged) void this.save(entry.path)
        return
      } catch (err) {
        if (err instanceof ApiError && err.code === 'conflict' && attempt < MAX_ATTEMPTS) {
          try {
            const disk = await this.client.readNotes(entry.path)
            entry.notes = mergeNotes(parseNotes(disk.content), entry.notes, entry.deleted)
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

  /** Takes notes that another program changed, for each document that has nothing waiting to save. */
  async refresh() {
    await Promise.all([...this.entries.values()].map(async (entry) => {
      if (!entry.loaded || entry.revision > entry.acknowledged || entry.pending > 0) return
      const revision = entry.revision
      try {
        const disk = await this.client.readNotes(entry.path)
        if (entry.revision !== revision || entry.pending > 0 || disk.modified === entry.baseModified) return
        entry.notes = parseNotes(disk.content)
        entry.baseModified = disk.modified
        entry.deleted.clear()
        this.publish(entry)
      } catch {
        // A later focus will try again.
      }
    }))
  }
}
