// ABOUTME: Tests for semantic rules: presets, the version hash, thresholds with sensitivity, and the rules file.
// ABOUTME: The rules file keeps semantic rules next to the exact rules.

import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, parseRules, serializeRules } from './lint'
import { allowExample, effectiveThreshold, ruleVersion, SEMANTIC_PRESETS, type SemanticRule } from './semantic'

const rule = (patch: Partial<SemanticRule> = {}): SemanticRule => ({ ...SEMANTIC_PRESETS[0], ...patch })

describe('semantic presets', () => {
  it('has the four jevditor rules, all off, with unique ids', () => {
    expect(SEMANTIC_PRESETS.map((r) => [r.name, r.scope, r.enabled])).toEqual([
      ['Avoid LinkedIn voice', 'passage', false],
      ['Not marketing copy', 'sentence', false],
      ['Concrete over vague', 'sentence', false],
      ["Don't explain it twice", 'section', false],
    ])
    expect(new Set(SEMANTIC_PRESETS.map((r) => r.id)).size).toBe(4)
  })

  it('are the semantic rules of the defaults', () => {
    expect(DEFAULT_RULES.semantic).toEqual(SEMANTIC_PRESETS)
  })
})

describe('ruleVersion', () => {
  it('changes when the definition changes', () => {
    expect(ruleVersion(rule())).not.toBe(ruleVersion(rule({ question: 'Other?' })))
    expect(ruleVersion(rule())).not.toBe(ruleVersion(rule({ examples: [] })))
  })

  it('does not change for enabled or sensitivity, which only change what shows', () => {
    expect(ruleVersion(rule({ enabled: true, sensitivity: 'strict' }))).toBe(ruleVersion(rule()))
  })
})

describe('effectiveThreshold', () => {
  it('moves the threshold with the sensitivity and keeps it between 0.5 and 0.99', () => {
    expect(effectiveThreshold(rule({ threshold: 0.85 }))).toBeCloseTo(0.85)
    expect(effectiveThreshold(rule({ threshold: 0.85, sensitivity: 'gentle' }))).toBeCloseTo(0.92)
    expect(effectiveThreshold(rule({ threshold: 0.85, sensitivity: 'strict' }))).toBeCloseTo(0.7)
    expect(effectiveThreshold(rule({ threshold: 0.98, sensitivity: 'gentle' }))).toBe(0.99)
    expect(effectiveThreshold(rule({ threshold: 0.6, sensitivity: 'strict' }))).toBe(0.5)
  })
})

describe('allowExample', () => {
  it('adds the text as an allow example of that rule only, once', () => {
    const rules = { ...DEFAULT_RULES }
    const id = SEMANTIC_PRESETS[1].id
    const once = allowExample(rules, id, 'Plain text.')
    const twice = allowExample(once, id, 'Plain text.')
    const changed = twice.semantic.find((r) => r.id === id)!
    expect(changed.examples.at(-1)).toEqual({ text: 'Plain text.', flag: false })
    expect(changed.examples.filter((e) => e.text === 'Plain text.')).toHaveLength(1)
    expect(twice.semantic.find((r) => r.id === SEMANTIC_PRESETS[0].id)).toEqual(SEMANTIC_PRESETS[0])
  })
})

describe('semantic rules in the rules file', () => {
  it('round-trips', () => {
    const rules = { ...DEFAULT_RULES, semantic: [rule({ enabled: true, sensitivity: 'gentle' }), rule({ id: 'mine', name: 'Mine', scope: 'section' })] }
    expect(parseRules(serializeRules(rules))).toEqual(rules)
  })

  it('gives the presets when the file has no semantic list', () => {
    expect(parseRules(JSON.stringify({ version: 1 })).semantic).toEqual(SEMANTIC_PRESETS)
  })

  it('keeps an empty list, and drops entries with a bad shape or a repeated id', () => {
    expect(parseRules(JSON.stringify({ semantic: [] })).semantic).toEqual([])
    const raw = JSON.stringify({
      semantic: [
        { ...rule({ id: 'a' }), examples: [{ text: 'x', flag: true }, { text: 3 }], sensitivity: 'loud', threshold: 7 },
        { ...rule({ id: 'a' }) },
        { ...rule({ id: 'b' }), scope: 'chapter' },
        { id: 'c' },
      ],
    })
    const parsed = parseRules(raw).semantic
    expect(parsed.map((r) => r.id)).toEqual(['a'])
    expect(parsed[0]).toMatchObject({ examples: [{ text: 'x', flag: true }], sensitivity: 'normal', threshold: 0.85 })
  })

  it('keeps an occurrence kept for a semantic rule', () => {
    const kept = [{ rule: 'semantic:linkedin-voice', match: 'Text.', sentence: 'Text.' }]
    expect(parseRules(JSON.stringify({ kept })).kept).toEqual(kept)
  })
})
