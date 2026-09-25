// ABOUTME: Tests for the rules store: loading, saves, replay of changes after a conflict, and refreshes.
// ABOUTME: A fake client keeps one rules file in memory with the same conflict rule as the server.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { DEFAULT_RULES, keep, type LintRules, parseRules, serializeRules } from '../lib/lint'
import { RulesStore } from './rulesStore'

const kept = { rule: 'phrases' as const, match: 'synergy', sentence: 'We need synergy.' }

function setup(initial: LintRules | null = null) {
  let disk = { content: initial ? serializeRules(initial) : '', modified: initial ? 5 : 0 }
  const client = {
    readRules: vi.fn(async () => ({ ...disk })),
    writeRules: vi.fn(async (content: string, base: number) => {
      if (base !== disk.modified) throw new ApiError('conflict', 409)
      disk = { content, modified: disk.modified + 1 }
      return { modified: disk.modified }
    }),
  }
  const store = new RulesStore(client)
  const open = async () => {
    store.subscribe(() => {})
    await vi.waitFor(() => expect(store.getSnapshot().loaded).toBe(true))
  }
  return {
    store,
    client,
    open,
    diskRules: () => parseRules(disk.content),
    otherWriter: (rules: LintRules) => { disk = { content: serializeRules(rules), modified: disk.modified + 1 } },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('RulesStore', () => {
  it('gives the default rules when the folder has no rules file', async () => {
    const test = setup()
    await test.open()
    expect(test.store.getSnapshot()).toMatchObject({ rules: DEFAULT_RULES, loaded: true })
  })

  it('loads the rules file', async () => {
    const test = setup({ ...DEFAULT_RULES, repeatedWord: { enabled: false } })
    await test.open()
    expect(test.store.getSnapshot().rules.repeatedWord.enabled).toBe(false)
  })

  it('shows a change at once and saves it', async () => {
    const test = setup()
    await test.open()
    const saved = test.store.change((rules) => keep(rules, kept))
    expect(test.store.getSnapshot().rules.kept).toEqual([kept])
    await saved
    expect(test.diskRules().kept).toEqual([kept])
    expect(test.store.getSnapshot().status).toBe('saved')
  })

  it('replays its changes on the rules on disk after a conflict', async () => {
    const test = setup(DEFAULT_RULES)
    await test.open()
    test.otherWriter(keep(DEFAULT_RULES, kept))
    await test.store.change((rules) => ({ ...rules, sentenceLength: { enabled: true, maxWords: 25 } }))
    const disk = test.diskRules()
    expect(disk.kept).toEqual([kept])
    expect(disk.sentenceLength).toEqual({ enabled: true, maxWords: 25 })
    expect(test.store.getSnapshot().rules).toEqual(disk)
  })

  it('reports an error when saving fails', async () => {
    const test = setup()
    await test.open()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    test.client.writeRules.mockRejectedValueOnce(new ApiError('boom', 500))
    await test.store.change((rules) => keep(rules, kept))
    expect(test.store.getSnapshot().status).toBe('error')
    expect(error).toHaveBeenCalledWith('emditor: cannot save the writing rules', expect.any(ApiError))
  })

  it('takes rules that another program changed when nothing waits to save', async () => {
    const test = setup(DEFAULT_RULES)
    await test.open()
    test.otherWriter({ ...DEFAULT_RULES, repeatedWord: { enabled: false } })
    await test.store.refresh()
    expect(test.store.getSnapshot().rules.repeatedWord.enabled).toBe(false)
  })
})
