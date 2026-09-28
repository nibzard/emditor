// ABOUTME: Decides when to send which targets to Jev, and which results may show.
// ABOUTME: Results are kept by snapshot; a result shows only while a current target has the same snapshot.

import type { Kept, TextBlock } from './lint'
import { snapshotId, type Target, targetsFor } from './segment'
import { definitionOf, effectiveThreshold, keptRule, type RuleDefinition, SCOPES, type SemanticRule, type SemanticScope } from './semantic'

export type CheckRequest = {
  targets: { id: string; scope: SemanticScope; text: string; context: string }[]
  rules: (RuleDefinition & { id: string })[]
}
export type CheckResult = { id: string; status: 'ok'; probabilities: Record<string, number> } | { id: string; status: 'unavailable' }
export type CheckResponse = { results: CheckResult[] }
export type SemanticStatus = 'idle' | 'checking' | 'unavailable'

/** A semantic finding at the offsets of the current plain text. */
export interface SemanticFinding {
  key: string
  ruleId: string
  name: string
  scope: SemanticScope
  message: string
  text: string
  context: string
  ranges: { from: number; to: number }[]
  probability: number
  threshold: number
}

type Deps = {
  check: (req: CheckRequest, signal: AbortSignal) => Promise<CheckResponse>
  /** Called when the findings or the status change. */
  onUpdate: () => void
  /** True while an input method composes text; no check starts then. */
  isComposing?: () => boolean
  now?: () => number
}

/** The pause before sentence and passage rules are checked. */
export const SHORT_DELAY_MS = 500
/** The pause before section rules are checked. */
export const LONG_DELAY_MS = 4000
/** How long a target that could not be checked waits before it is sent again. */
export const RETRY_MS = 10_000
const MAX_TARGETS_PER_REQUEST = 24
const MAX_RESULTS = 3000

type Current = { target: Target; snapshot: string }

export class SemanticScheduler {
  private rules: SemanticRule[] = []
  private model: string | null = null
  private kept = new Set<string>()
  private text = ''
  private blocks: readonly TextBlock[] = []
  private targets: Current[] = []
  private results = new Map<string, Record<string, number>>()
  private failedUntil = new Map<string, number>()
  private inflight = new Set<{ snapshots: Set<string>; abort: AbortController }>()
  private timers: Partial<Record<'short' | 'long' | 'retry', ReturnType<typeof setTimeout>>> = {}
  private unavailable = false
  private disposed = false
  private readonly now: () => number
  status: SemanticStatus = 'idle'

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now
  }

  /** Sets the rules and the model; null turns semantic checks off. Only enabled rules are checked. */
  setConfig(rules: SemanticRule[] | null, model: string | null, kept: Kept[]) {
    this.rules = rules && model ? rules.filter((r) => r.enabled) : []
    this.model = model
    this.kept = new Set(kept.filter((k) => k.rule.startsWith('semantic:')).map((k) => `${k.rule}\u0000${k.match}`))
    this.recompute()
  }

  /** Call after each change of the document. */
  update(text: string, blocks: readonly TextBlock[]) {
    this.text = text
    this.blocks = blocks
    this.recompute()
  }

  dispose() {
    this.disposed = true
    for (const req of this.inflight) req.abort.abort()
    this.inflight.clear()
    for (const timer of Object.values(this.timers)) clearTimeout(timer)
  }

  private rulesFor(scope: SemanticScope) {
    return this.rules.filter((r) => r.scope === scope)
  }

  private recompute() {
    if (this.disposed) return
    const targets: Current[] = []
    for (const scope of SCOPES) {
      const rules = this.rulesFor(scope)
      if (!rules.length || !this.model) continue
      for (const target of targetsFor(this.text, this.blocks, scope)) targets.push({ target, snapshot: snapshotId(target, rules, this.model) })
    }
    this.targets = targets
    const live = new Set(targets.map((t) => t.snapshot))
    // Cancelling saves requests. It is the snapshot match that keeps the results correct.
    for (const req of this.inflight) {
      if (![...req.snapshots].some((s) => live.has(s))) {
        req.abort.abort()
        this.inflight.delete(req)
      }
    }
    this.schedule()
    this.emit()
  }

  private pending(scopes: readonly SemanticScope[]): Current[] {
    const now = this.now()
    const busy = new Set([...this.inflight].flatMap((r) => [...r.snapshots]))
    const seen = new Set<string>()
    return this.targets.filter((t) => {
      if (!scopes.includes(t.target.scope) || seen.has(t.snapshot)) return false
      seen.add(t.snapshot)
      if (this.results.has(t.snapshot) || busy.has(t.snapshot)) return false
      return (this.failedUntil.get(t.snapshot) ?? 0) <= now
    })
  }

  private schedule() {
    clearTimeout(this.timers.short)
    clearTimeout(this.timers.long)
    if (this.pending(['sentence', 'passage']).length) {
      this.timers.short = setTimeout(() => this.flush(['sentence', 'passage']), SHORT_DELAY_MS)
    }
    if (this.pending(['section']).length) {
      this.timers.long = setTimeout(() => this.flush(['section']), LONG_DELAY_MS)
    }
  }

  private flush(scopes: SemanticScope[]) {
    if (this.disposed) return
    if (this.deps.isComposing?.()) {
      this.timers.short = setTimeout(() => this.flush(scopes), 300)
      return
    }
    const pending = this.pending(scopes)
    for (let i = 0; i < pending.length; i += MAX_TARGETS_PER_REQUEST) void this.send(pending.slice(i, i + MAX_TARGETS_PER_REQUEST))
  }

  private async send(batch: Current[]) {
    const abort = new AbortController()
    const req = { snapshots: new Set(batch.map((t) => t.snapshot)), abort }
    this.inflight.add(req)
    this.emit()
    const scopes = new Set(batch.map((t) => t.target.scope))
    const body: CheckRequest = {
      targets: batch.map(({ target, snapshot }) => ({ id: snapshot, scope: target.scope, text: target.text, context: target.context })),
      rules: this.rules.filter((r) => scopes.has(r.scope)).map((r) => ({ id: r.id, ...definitionOf(r) })),
    }
    let failed = false
    try {
      const { results } = await this.deps.check(body, abort.signal)
      for (const r of results) {
        if (r.status === 'ok') {
          this.results.set(r.id, r.probabilities)
          this.failedUntil.delete(r.id)
        } else {
          failed = true
          this.failedUntil.set(r.id, this.now() + RETRY_MS)
        }
      }
      while (this.results.size > MAX_RESULTS) this.results.delete(this.results.keys().next().value!)
    } catch (err) {
      if (abort.signal.aborted) return
      console.error('emditor: semantic check failed', err)
      failed = true
      for (const s of req.snapshots) this.failedUntil.set(s, this.now() + RETRY_MS)
    } finally {
      this.inflight.delete(req)
    }
    if (this.disposed) return
    this.unavailable = failed
    if (failed) {
      clearTimeout(this.timers.retry)
      this.timers.retry = setTimeout(() => this.flush(SCOPES), RETRY_MS)
    }
    this.emit()
  }

  private emit() {
    this.status = this.inflight.size ? 'checking' : this.unavailable ? 'unavailable' : 'idle'
    this.deps.onUpdate()
  }

  /** The findings of the current targets, in text order. */
  findings(): SemanticFinding[] {
    const out: SemanticFinding[] = []
    for (const { target, snapshot } of this.targets) {
      const probabilities = this.results.get(snapshot)
      if (!probabilities) continue
      for (const rule of this.rulesFor(target.scope)) {
        const probability = probabilities[rule.id]
        const threshold = effectiveThreshold(rule)
        if (probability === undefined || probability < threshold) continue
        if (this.kept.has(`${keptRule(rule.id)}\u0000${target.text}`)) continue
        out.push({
          key: `${rule.id}:${snapshot}`,
          ruleId: rule.id,
          name: rule.name,
          scope: target.scope,
          message: rule.explanation || `This ${target.scope} may match your rule “${rule.name}”.`,
          text: target.text,
          context: target.context,
          ranges: target.ranges,
          probability,
          threshold,
        })
      }
    }
    return out.sort((a, b) => a.ranges[0].from - b.ranges[0].from)
  }
}
