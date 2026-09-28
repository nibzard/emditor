// ABOUTME: Pure logic for the writing lint: exact checks (phrases to avoid, repeated words, long sentences) on plain text.
// ABOUTME: It also splits Markdown source into blocks, keeps occurrences that the writer accepts, and reads and writes the rules file.

import { parseSemantic, SEMANTIC_PRESETS, type SemanticRule } from './semantic'

export type RuleKey = 'phrases' | 'repeatedWord' | 'sentenceLength'

/**
 * An occurrence that the writer keeps: this rule does not mark this match in this sentence again.
 * For a semantic rule, `rule` is `semantic:<id>`, and `match` and `sentence` are the text of the target.
 */
export interface Kept {
  rule: RuleKey | `semantic:${string}`
  match: string
  sentence: string
}

export interface LintRules {
  phrases: { enabled: boolean; list: string[]; caseSensitive: boolean }
  repeatedWord: { enabled: boolean }
  sentenceLength: { enabled: boolean; maxWords: number }
  /** Rules that Jev checks. */
  semantic: SemanticRule[]
  kept: Kept[]
}

/** A 'code' block is not prose, so no rule checks it. A 'heading' is not checked for sentence length. */
export type BlockKind = 'prose' | 'heading' | 'code'

/** A block of the text, from and to are offsets in the whole text. */
export interface TextBlock {
  kind: BlockKind
  from: number
  to: number
}

export interface Finding {
  rule: RuleKey
  from: number
  to: number
  message: string
  /** The text that the rule marks. */
  match: string
  /** The sentence around the match, to keep this occurrence and to rewrite it. */
  sentence: string
  /** Offsets of the sentence in the whole text. */
  around: { from: number; to: number }
}

export const RULE_NAMES: Record<RuleKey, string> = {
  phrases: 'Phrases to avoid',
  repeatedWord: 'Repeated word',
  sentenceLength: 'Long sentences',
}

export const DEFAULT_RULES: LintRules = {
  phrases: {
    enabled: true,
    list: ['synergy', 'circle back', 'move the needle', 'game-changer', 'at the end of the day', 'low-hanging fruit'],
    caseSensitive: false,
  },
  repeatedWord: { enabled: true },
  sentenceLength: { enabled: false, maxWords: 40 },
  semantic: SEMANTIC_PRESETS,
  kept: [],
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
  'inc', 'ltd', 'co', 'no', 'fig', 'approx', 'dept', 'est', 'u.s', 'u.k', 'a.m', 'p.m',
])

type Range = { start: number; end: number }

/**
 * Splits one block of text into sentence ranges. Offsets index into `text`.
 * White space at the start and end of each range is not included.
 */
export function splitSentences(text: string): Range[] {
  const out: Range[] = []
  let start = 0
  const re = /[.!?…]+["'”’)\]]*(?=\s|$)|\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    if (m[0] !== '\n' && m[0] === '.') {
      const word = /([\p{L}.]+)$/u.exec(text.slice(start, m.index))?.[1]?.toLowerCase() ?? ''
      if (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word)) continue
      // A lowercase word after the period ("approx. five") seldom starts a new sentence.
      if (/^\s+\p{Ll}/u.test(text.slice(end))) continue
      // "3.5" does not match, because of the (?=\s|$) lookahead.
    }
    pushSentence(out, text, start, m[0] === '\n' ? m.index : end)
    start = end
  }
  pushSentence(out, text, start, text.length)
  return out
}

function pushSentence(out: Range[], text: string, start: number, end: number) {
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  if (end > start && /[\p{L}\p{N}]/u.test(text.slice(start, end))) out.push({ start, end })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Word boundaries that also work for phrases that start or end with punctuation. */
function phrasePattern(phrase: string): string {
  const body = escapeRegExp(phrase).replace(/\s+/g, '\\s+')
  const lead = /^[\p{L}\p{N}_]/u.test(phrase) ? '(?<![\\p{L}\\p{N}_])' : ''
  const tail = /[\p{L}\p{N}_]$/u.test(phrase) ? '(?![\\p{L}\\p{N}_])' : ''
  return lead + body + tail
}

type Hit = { rule: RuleKey; start: number; end: number; message: string }

function phraseHits(text: string, rules: LintRules['phrases']): Hit[] {
  const clean = rules.list.map((p) => p.trim()).filter(Boolean)
  if (clean.length === 0) return []
  // Longest first, so that "circle back around" wins over "circle back".
  clean.sort((a, b) => b.length - a.length)
  const re = new RegExp(clean.map(phrasePattern).join('|'), rules.caseSensitive ? 'gu' : 'giu')
  return [...text.matchAll(re)].map((m) => ({
    rule: 'phrases',
    start: m.index,
    end: m.index + m[0].length,
    message: `“${m[0]}” is on your list of phrases to avoid.`,
  }))
}

function repeatedWordHits(text: string): Hit[] {
  return [...text.matchAll(/(?<![\p{L}\p{N}])([\p{L}\p{N}']+)(\s+)(\1)(?![\p{L}\p{N}])/giu)].map((m) => ({
    rule: 'repeatedWord',
    start: m.index,
    end: m.index + m[0].length,
    message: `“${m[1]}” appears twice in a row.`,
  }))
}

function sentenceLengthHits(text: string, sentences: Range[], maxWords: number): Hit[] {
  const out: Hit[] = []
  for (const s of sentences) {
    const words = text.slice(s.start, s.end).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
    if (words > maxWords) {
      out.push({ rule: 'sentenceLength', ...s, message: `This sentence has ${words} words; your limit is ${maxWords}.` })
    }
  }
  return out
}

const keptKey = (k: Kept) => JSON.stringify([k.rule, k.match, k.sentence])

/** Runs the enabled rules on each prose and heading block. Findings are in text order, with offsets in the whole text. */
export function lint(text: string, blocks: readonly TextBlock[], rules: LintRules): Finding[] {
  const kept = new Set(rules.kept.map(keptKey))
  const out: Finding[] = []
  for (const block of blocks) {
    if (block.kind === 'code') continue
    // A line break inside a block is a soft wrap, so a sentence can go on over it.
    const body = text.slice(block.from, block.to).replace(/\n/g, ' ')
    const sentences = splitSentences(body)
    const hits: Hit[] = []
    if (rules.phrases.enabled) hits.push(...phraseHits(body, rules.phrases))
    if (rules.repeatedWord.enabled) hits.push(...repeatedWordHits(body))
    if (rules.sentenceLength.enabled && block.kind !== 'heading') hits.push(...sentenceLengthHits(body, sentences, rules.sentenceLength.maxWords))
    for (const hit of hits) {
      const around = sentences.find((s) => s.start <= hit.start && hit.start < s.end) ?? { start: hit.start, end: hit.end }
      const finding: Finding = {
        rule: hit.rule,
        from: block.from + hit.start,
        to: block.from + hit.end,
        message: hit.message,
        match: text.slice(block.from + hit.start, block.from + hit.end),
        sentence: body.slice(around.start, Math.max(around.end, hit.end)),
        around: { from: block.from + around.start, to: block.from + Math.max(around.end, hit.end) },
      }
      if (!kept.has(keptKey(finding))) out.push(finding)
    }
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

/** Gives rules that keep this occurrence of the finding. */
export function keep(rules: LintRules, finding: Kept): LintRules {
  const entry: Kept = { rule: finding.rule, match: finding.match, sentence: finding.sentence }
  if (rules.kept.some((k) => keptKey(k) === keptKey(entry))) return rules
  return { ...rules, kept: [...rules.kept, entry] }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}#{1,6}(\s|$)/
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/

/**
 * Splits Markdown source into blocks with source offsets: headings, fenced code, front matter,
 * and prose. A blank line ends a paragraph, and each list item starts a new block.
 */
export function markdownBlocks(source: string): TextBlock[] {
  const lines: { from: number; to: number; text: string }[] = []
  let at = 0
  for (const text of source.split('\n')) {
    lines.push({ from: at, to: at + text.length, text })
    at += text.length + 1
  }

  const out: TextBlock[] = []
  let current: TextBlock | null = null
  const end = () => {
    if (current) out.push(current)
    current = null
  }
  let i = 0
  if (lines[0]?.text === '---') {
    const close = lines.findIndex((l, n) => n > 0 && (l.text === '---' || l.text === '...'))
    if (close > 0) {
      out.push({ kind: 'code', from: 0, to: lines[close].to })
      i = close + 1
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line.text)
    if (fence) {
      end()
      const marker = fence[1]
      let close = i + 1
      while (close < lines.length && !lines[close].text.trimStart().startsWith(marker)) close++
      const last = Math.min(close, lines.length - 1)
      out.push({ kind: 'code', from: line.from, to: lines[last].to })
      i = last
    } else if (!line.text.trim()) {
      end()
    } else if (HEADING.test(line.text)) {
      end()
      out.push({ kind: 'heading', from: line.from, to: line.to })
    } else if (!current || LIST_ITEM.test(line.text)) {
      end()
      current = { kind: 'prose', from: line.from, to: line.to }
    } else {
      current.to = line.to
    }
  }
  end()
  return out
}

const RULE_KEYS: RuleKey[] = ['phrases', 'repeatedWord', 'sentenceLength']

const isKept = (value: unknown): value is Kept => {
  const k = value as Kept
  const rule = typeof k?.rule === 'string' && (RULE_KEYS.includes(k.rule as RuleKey) || /^semantic:.+/.test(k.rule))
  return typeof k === 'object' && k !== null && rule && typeof k.match === 'string' && typeof k.sentence === 'string'
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** Reads a rules file. Empty or broken input gives the defaults, and each missing or bad field takes its default. */
export function parseRules(raw: string): LintRules {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw.trim() ? JSON.parse(raw) : {}
    if (typeof parsed === 'object' && parsed !== null) data = parsed as Record<string, unknown>
  } catch {
    // A broken file gives the defaults.
  }
  const section = (key: string) => (typeof data[key] === 'object' && data[key] !== null ? data[key] as Record<string, unknown> : {})
  const phrases = section('phrases')
  const repeated = section('repeatedWord')
  const length = section('sentenceLength')
  const d = DEFAULT_RULES
  const maxWords = length.maxWords
  return {
    phrases: {
      enabled: bool(phrases.enabled, d.phrases.enabled),
      list: Array.isArray(phrases.list)
        ? phrases.list.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean)
        : d.phrases.list,
      caseSensitive: bool(phrases.caseSensitive, d.phrases.caseSensitive),
    },
    repeatedWord: { enabled: bool(repeated.enabled, d.repeatedWord.enabled) },
    sentenceLength: {
      enabled: bool(length.enabled, d.sentenceLength.enabled),
      maxWords: typeof maxWords === 'number' && Number.isInteger(maxWords) && maxWords > 0 ? maxWords : d.sentenceLength.maxWords,
    },
    semantic: parseSemantic(data.semantic),
    kept: Array.isArray(data.kept)
      ? data.kept.filter(isKept).map(({ rule, match, sentence }) => ({ rule, match, sentence }))
      : [],
  }
}

/** Writes a rules file. The output is stable and readable, so it gives clean diffs in git. */
export function serializeRules(rules: LintRules): string {
  return JSON.stringify({ version: 1, ...rules }, null, 2) + '\n'
}
