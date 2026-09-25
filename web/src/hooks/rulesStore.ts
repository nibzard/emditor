// ABOUTME: Keeps the writing rules of the folder and saves them to the sidecar rules file.
// ABOUTME: After a conflict it applies its changes again on the rules on disk, so no change is lost.

import { api, ApiError } from '../api'
import { DEFAULT_RULES, type LintRules, parseRules, serializeRules } from '../lib/lint'

export type RulesStatus = 'idle' | 'saving' | 'saved' | 'error'
export type RulesSnapshot = { rules: LintRules; loaded: boolean; status: RulesStatus }
type Change = (rules: LintRules) => LintRules

/** A write that meets a conflict applies its changes again and tries again, at most this many times. */
const MAX_ATTEMPTS = 3

export class RulesStore {
  private snapshot: RulesSnapshot = { rules: DEFAULT_RULES, loaded: false, status: 'idle' }
  private baseModified = 0
  /** Changes that the rules file on disk does not have yet, in order. */
  private pending: Change[] = []
  private chain: Promise<void> = Promise.resolve()
  private started = false
  private listeners = new Set<() => void>()

  constructor(private readonly client: Pick<typeof api, 'readRules' | 'writeRules'> = api) {}

  private publish(patch: Partial<RulesSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private start() {
    if (this.started) return
    this.started = true
    this.chain = this.load()
  }

  private async load() {
    try {
      const disk = await this.client.readRules()
      this.baseModified = disk.modified
      this.publish({ rules: this.pending.reduce((rules, change) => change(rules), parseRules(disk.content)), loaded: true })
    } catch (err) {
      console.error('emditor: cannot load the writing rules', err)
      this.publish({ status: 'error' })
    }
  }

  getSnapshot = (): RulesSnapshot => this.snapshot

  subscribe = (listener: () => void) => {
    this.start()
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Applies a change now and saves it. The promise settles when the save is done or failed. */
  change(change: Change): Promise<void> {
    this.start()
    this.pending.push(change)
    this.publish({ rules: change(this.snapshot.rules), status: 'saving' })
    this.chain = this.chain.then(() => this.write())
    return this.chain
  }

  private async write() {
    // Nothing is written before the rules file is loaded, because the write could hide rules on disk.
    if (!this.snapshot.loaded || this.pending.length === 0) return
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const written = this.pending.length
      try {
        const saved = await this.client.writeRules(serializeRules(this.snapshot.rules), this.baseModified)
        this.baseModified = saved.modified
        this.pending = this.pending.slice(written)
        this.publish({ status: this.pending.length ? 'saving' : 'saved' })
        return
      } catch (err) {
        if (err instanceof ApiError && err.code === 'conflict' && attempt < MAX_ATTEMPTS) {
          try {
            const disk = await this.client.readRules()
            this.baseModified = disk.modified
            this.publish({ rules: this.pending.reduce((rules, change) => change(rules), parseRules(disk.content)) })
            continue
          } catch (readErr) {
            err = readErr
          }
        }
        console.error('emditor: cannot save the writing rules', err)
        this.publish({ status: 'error' })
        return
      }
    }
  }

  /** Tries again to save changes that failed. */
  retry(): Promise<void> {
    this.chain = this.chain.then(() => this.write())
    return this.chain
  }

  /** Takes rules that another program changed, when nothing waits to save. */
  async refresh() {
    if (!this.snapshot.loaded || this.pending.length > 0) return
    try {
      const disk = await this.client.readRules()
      if (this.pending.length > 0 || disk.modified === this.baseModified) return
      this.baseModified = disk.modified
      this.publish({ rules: parseRules(disk.content) })
    } catch {
      // A later focus will try again.
    }
  }
}
