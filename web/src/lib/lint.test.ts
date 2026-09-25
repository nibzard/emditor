// ABOUTME: Tests for the writing lint: sentence splits, exact checks, kept occurrences, Markdown blocks, and the rules file.
// ABOUTME: All checks are plain functions of text, so each test gives text and reads the findings.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES, keep, lint, type LintRules, markdownBlocks, parseRules, serializeRules, splitSentences, type TextBlock,
} from './lint'

const prose = (text: string): TextBlock[] => [{ kind: 'prose', from: 0, to: text.length }]
const rules = (patch: Partial<LintRules> = {}): LintRules => ({ ...DEFAULT_RULES, ...patch })
const slices = (text: string, ranges: { from: number; to: number }[]) => ranges.map((r) => text.slice(r.from, r.to))

describe('splitSentences', () => {
  const split = (text: string) => splitSentences(text).map((s) => text.slice(s.start, s.end))

  it('splits at end punctuation and trims white space', () => {
    expect(split('One two.  Three four!  Five?')).toEqual(['One two.', 'Three four!', 'Five?'])
  })

  it('does not split at abbreviations, initials, decimals, or lowercase continuations', () => {
    expect(split('Dr. Smith paid 3.5 dollars. J. R. wrote it. It is approx. five.')).toEqual([
      'Dr. Smith paid 3.5 dollars.',
      'J. R. wrote it.',
      'It is approx. five.',
    ])
  })

  it('splits at new lines and skips parts without letters', () => {
    expect(split('First line\nSecond line\n---')).toEqual(['First line', 'Second line'])
  })
})

describe('lint phrases', () => {
  it('finds each listed phrase with word boundaries, longest first, and ignores case', () => {
    const text = 'We should Circle back around. Synergyish is fine, synergy is not.'
    const found = lint(text, prose(text), rules({ phrases: { enabled: true, list: ['circle back', 'circle back around', 'synergy'], caseSensitive: false } }))
    expect(slices(text, found)).toEqual(['Circle back around', 'synergy'])
    expect(found[0].message).toBe('“Circle back around” is on your list of phrases to avoid.')
    expect(found[1].sentence).toBe('Synergyish is fine, synergy is not.')
    expect(text.slice(found[1].around.from, found[1].around.to)).toBe(found[1].sentence)
  })

  it('respects case when asked', () => {
    const text = 'Synergy and synergy.'
    const found = lint(text, prose(text), rules({ phrases: { enabled: true, list: ['synergy'], caseSensitive: true } }))
    expect(found.map((f) => f.from)).toEqual([12])
  })

  it('handles phrases that start or end with punctuation', () => {
    const text = 'Well... okay. Also -- this.'
    const found = lint(text, prose(text), rules({ phrases: { enabled: true, list: ['...', '--'], caseSensitive: false } }))
    expect(slices(text, found)).toEqual(['...', '--'])
  })
})

describe('lint repeated words', () => {
  it('marks both words, also across a line break, and not across different words', () => {
    const text = 'It was the the best.\nIt it happens. The theme.'
    const found = lint(text, prose(text), rules({ phrases: { ...DEFAULT_RULES.phrases, enabled: false } }))
    expect(slices(text, found)).toEqual(['the the', 'It it'])
    expect(found[0].message).toBe('“the” appears twice in a row.')
  })
})

describe('lint sentence length', () => {
  const long = rules({ phrases: { ...DEFAULT_RULES.phrases, enabled: false }, repeatedWord: { enabled: false }, sentenceLength: { enabled: true, maxWords: 5 } })

  it('marks sentences with more words than the limit', () => {
    const text = 'Short one here. This sentence has far too many words in it.'
    const found = lint(text, prose(text), long)
    expect(slices(text, found)).toEqual(['This sentence has far too many words in it.'])
    expect(found[0].message).toBe('This sentence has 9 words; your limit is 5.')
  })

  it('joins soft line breaks inside a block into one sentence', () => {
    const text = 'This sentence goes on\nover two lines of text.'
    expect(lint(text, prose(text), long)).toHaveLength(1)
  })

  it('does not check headings', () => {
    const text = 'A heading that has many many words'
    expect(lint(text, [{ kind: 'heading', from: 0, to: text.length }], long)).toEqual([])
  })
})

describe('lint blocks', () => {
  it('skips code blocks and gives offsets in the whole text', () => {
    const text = 'intro\nthe the code\nend end'
    const blocks: TextBlock[] = [
      { kind: 'prose', from: 0, to: 5 },
      { kind: 'code', from: 6, to: 18 },
      { kind: 'prose', from: 19, to: 26 },
    ]
    const found = lint(text, blocks, rules())
    expect(found.map((f) => [f.from, f.to])).toEqual([[19, 26]])
  })

  it('checks nothing when every rule is off', () => {
    const text = 'the the synergy'
    const off = rules({ phrases: { ...DEFAULT_RULES.phrases, enabled: false }, repeatedWord: { enabled: false } })
    expect(lint(text, prose(text), off)).toEqual([])
  })
})

describe('keep', () => {
  it('hides a kept occurrence in its sentence, but not the same match in another sentence', () => {
    const text = 'We need synergy. Synergy wins.'
    const all = lint(text, prose(text), rules())
    expect(all).toHaveLength(2)
    const kept = keep(rules(), all[0])
    expect(slices(text, lint(text, prose(text), kept))).toEqual(['Synergy'])
  })

  it('does not add the same occurrence twice', () => {
    const text = 'the the'
    const [finding] = lint(text, prose(text), rules())
    expect(keep(keep(rules(), finding), finding).kept).toHaveLength(1)
  })
})

describe('markdownBlocks', () => {
  const kinds = (source: string) => markdownBlocks(source).map((b) => [b.kind, source.slice(b.from, b.to)])

  it('finds headings, paragraphs, list items, and fenced code', () => {
    const source = '# Title\n\nOne line\nsame paragraph.\n\n- item one\n- item two\n\n```js\nconst a = 1\n```\nAfter.'
    expect(kinds(source)).toEqual([
      ['heading', '# Title'],
      ['prose', 'One line\nsame paragraph.'],
      ['prose', '- item one'],
      ['prose', '- item two'],
      ['code', '```js\nconst a = 1\n```'],
      ['prose', 'After.'],
    ])
  })

  it('treats front matter and an unclosed fence as code', () => {
    const source = '---\ntitle: x x\n---\nText.\n~~~\nopen'
    expect(kinds(source)).toEqual([
      ['code', '---\ntitle: x x\n---'],
      ['prose', 'Text.'],
      ['code', '~~~\nopen'],
    ])
  })

  it('gives findings at source offsets', () => {
    const source = '# The the title\n\nIt is is here.'
    const found = lint(source, markdownBlocks(source), rules())
    expect(slices(source, found)).toEqual(['The the', 'is is'])
  })
})

describe('rules file', () => {
  it('reads what it writes', () => {
    const custom = keep(rules({ sentenceLength: { enabled: true, maxWords: 30 } }), { rule: 'phrases', match: 'synergy', sentence: 'We need synergy.' })
    expect(parseRules(serializeRules(custom))).toEqual(custom)
  })

  it('gives the defaults for empty or broken input', () => {
    expect(parseRules('')).toEqual(DEFAULT_RULES)
    expect(parseRules('{nope')).toEqual(DEFAULT_RULES)
  })

  it('fills missing or bad fields with defaults and drops bad kept entries', () => {
    const raw = JSON.stringify({
      version: 1,
      phrases: { enabled: false, list: ['a', 3, ' b '] },
      sentenceLength: { maxWords: -4 },
      kept: [{ rule: 'phrases', match: 'a', sentence: 'a.' }, { rule: 'nope', match: 'x', sentence: 'x' }, 7],
    })
    const parsed = parseRules(raw)
    expect(parsed.phrases).toEqual({ enabled: false, list: ['a', 'b'], caseSensitive: false })
    expect(parsed.repeatedWord).toEqual(DEFAULT_RULES.repeatedWord)
    expect(parsed.sentenceLength).toEqual({ enabled: DEFAULT_RULES.sentenceLength.enabled, maxWords: DEFAULT_RULES.sentenceLength.maxWords })
    expect(parsed.kept).toEqual([{ rule: 'phrases', match: 'a', sentence: 'a.' }])
  })
})
