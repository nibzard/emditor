// ABOUTME: Tests for the semantic check scheduler with fake time and a fake check function.
// ABOUTME: They cover the delays, requests for new snapshots only, stale results, retries, batches, and kept findings.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextBlock } from './lint'
import { type CheckRequest, type CheckResponse, SemanticScheduler } from './semanticScheduler'
import { SEMANTIC_PRESETS, type SemanticRule } from './semantic'

const sentenceRule: SemanticRule = { ...SEMANTIC_PRESETS[1], enabled: true }
const sectionRule: SemanticRule = { ...SEMANTIC_PRESETS[3], enabled: true }

function prose(...paragraphs: string[]) {
  let text = ''
  const blocks: TextBlock[] = []
  paragraphs.forEach((p, i) => {
    if (i > 0) text += '\n'
    blocks.push({ kind: 'prose', from: text.length, to: text.length + p.length })
    text += p
  })
  return { text, blocks }
}

type Pending = { req: CheckRequest; signal: AbortSignal; resolve: (r: CheckResponse) => void; reject: (e: unknown) => void }

function setup(rules: SemanticRule[] = [sentenceRule]) {
  const calls: Pending[] = []
  const check = vi.fn((req: CheckRequest, signal: AbortSignal) =>
    new Promise<CheckResponse>((resolve, reject) => calls.push({ req, signal, resolve, reject })))
  const onUpdate = vi.fn()
  const scheduler = new SemanticScheduler({ check, onUpdate })
  scheduler.setConfig(rules, 'jev-test', [])
  /** Answers a call: each target gets `p(text)` for each rule of its scope. */
  const answer = async (call: Pending, p: (text: string) => number) => {
    call.resolve({
      results: call.req.targets.map((t) => ({
        id: t.id,
        status: 'ok' as const,
        probabilities: Object.fromEntries(call.req.rules.filter((r) => r.scope === t.scope).map((r) => [r.id, p(t.text)])),
      })),
    })
    await vi.advanceTimersByTimeAsync(0)
  }
  return { scheduler, check, calls, answer, onUpdate }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SemanticScheduler', () => {
  it('waits for a pause, then checks each sentence and shows the ones above the threshold', async () => {
    const t = setup()
    const doc = prose('Our revolutionary platform empowers you. The cache is 3x faster.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(499)
    expect(t.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].req.targets.map((x) => x.text)).toEqual(['Our revolutionary platform empowers you.', 'The cache is 3x faster.'])
    expect(t.calls[0].req.rules).toEqual([expect.objectContaining({ id: sentenceRule.id, question: sentenceRule.question })])
    expect(t.scheduler.status).toBe('checking')

    await t.answer(t.calls[0], (text) => (text.includes('revolutionary') ? 0.97 : 0.1))
    const [finding] = t.scheduler.findings()
    expect(t.scheduler.findings()).toHaveLength(1)
    expect(finding).toMatchObject({ ruleId: sentenceRule.id, name: sentenceRule.name, message: sentenceRule.explanation, probability: 0.97 })
    expect(doc.text.slice(finding.ranges[0].from, finding.ranges[0].to)).toBe('Our revolutionary platform empowers you.')
    expect(t.scheduler.status).toBe('idle')
    expect(t.onUpdate).toHaveBeenCalled()
  })

  it('checks only the latest text after quick edits', async () => {
    const t = setup()
    const first = prose('One.')
    const second = prose('One two.')
    t.scheduler.update(first.text, first.blocks)
    await vi.advanceTimersByTimeAsync(300)
    t.scheduler.update(second.text, second.blocks)
    await vi.advanceTimersByTimeAsync(500)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].req.targets.map((x) => x.text)).toEqual(['One two.'])
  })

  it('does not ask again for a snapshot that has a result', async () => {
    const t = setup()
    const doc = prose('Same text.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(500)
    await t.answer(t.calls[0], () => 0.1)
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.calls).toHaveLength(1)
  })

  it('never shows a result for text that changed while it was checked, and cancels that request', async () => {
    const t = setup()
    const before = prose('Revolutionary text.')
    const after = prose('Plain text.')
    t.scheduler.update(before.text, before.blocks)
    await vi.advanceTimersByTimeAsync(500)
    t.scheduler.update(after.text, after.blocks)
    expect(t.calls[0].signal.aborted).toBe(true)
    await t.answer(t.calls[0], () => 0.99)
    expect(t.scheduler.findings()).toEqual([])
  })

  it('gives findings at the offsets of the current text when text before them changes', async () => {
    const t = setup()
    const doc = prose('Revolutionary text.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(500)
    await t.answer(t.calls[0], () => 0.99)
    const moved = prose('', 'Revolutionary text.')
    t.scheduler.update(moved.text, moved.blocks)
    expect(t.scheduler.findings()[0].ranges).toEqual([{ from: 1, to: 20 }])
  })

  it('reports unavailable checks and asks again after 10 seconds', async () => {
    const t = setup()
    const doc = prose('Some text.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(500)
    t.calls[0].resolve({ results: [{ id: t.calls[0].req.targets[0].id, status: 'unavailable' }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.scheduler.status).toBe('unavailable')
    await vi.advanceTimersByTimeAsync(9_000)
    expect(t.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(t.calls).toHaveLength(2)
  })

  it('treats a failed request as unavailable', async () => {
    const t = setup()
    const doc = prose('Some text.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(500)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    t.calls[0].reject(new Error('network'))
    await vi.advanceTimersByTimeAsync(0)
    expect(error).toHaveBeenCalledWith('emditor: semantic check failed', expect.any(Error))
    error.mockRestore()
    expect(t.scheduler.status).toBe('unavailable')
    expect(t.scheduler.findings()).toEqual([])
  })

  it('waits 4 seconds for section rules', async () => {
    const t = setup([sectionRule])
    const doc = prose('First point.', 'The same point again.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(3_999)
    expect(t.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.calls[0].req.targets.map((x) => x.scope)).toEqual(['section'])
  })

  it('sends at most 24 targets in each request', async () => {
    const t = setup()
    const doc = prose(Array.from({ length: 30 }, (_, i) => `Sentence number ${i}.`).join(' '))
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(500)
    expect(t.calls.map((c) => c.req.targets.length)).toEqual([24, 6])
  })

  it('hides a kept finding and checks nothing without rules', async () => {
    const t = setup()
    const doc = prose('Revolutionary text.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(500)
    await t.answer(t.calls[0], () => 0.99)
    t.scheduler.setConfig([sentenceRule], 'jev-test', [{ rule: `semantic:${sentenceRule.id}`, match: 'Revolutionary text.', sentence: 'Revolutionary text.' }])
    expect(t.scheduler.findings()).toEqual([])

    t.scheduler.setConfig(null, null, [])
    t.scheduler.update(prose('New text.').text, prose('New text.').blocks)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(t.calls).toHaveLength(1)
  })

  it('shows more findings at strict sensitivity without a new request', async () => {
    const t = setup()
    const doc = prose('Somewhat hyped text.')
    t.scheduler.update(doc.text, doc.blocks)
    await vi.advanceTimersByTimeAsync(500)
    await t.answer(t.calls[0], () => 0.75)
    expect(t.scheduler.findings()).toEqual([])
    t.scheduler.setConfig([{ ...sentenceRule, sensitivity: 'strict' }], 'jev-test', [])
    expect(t.scheduler.findings()).toHaveLength(1)
    expect(t.calls).toHaveLength(1)
  })
})
