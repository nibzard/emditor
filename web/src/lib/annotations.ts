// ABOUTME: Pure logic for document annotations (notes, highlights, cuts) in a sidecar file next to the Markdown.
// ABOUTME: Text-quote anchors, anchor recovery after edits, the notes file format, cuts, and margin layout.

import { wordCount } from './text'

/** A passage of the document's plain text, with some context on each side to find it again. */
export interface TextQuote {
  exact: string
  prefix: string
  suffix: string
}

/** A comment is a margin note, a highlight marks text with a color, and a cut suggests removing the text. */
export type NoteKind = 'comment' | 'highlight' | 'cut'
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export interface Note {
  id: string
  quote: TextQuote
  body: string
  created: number
  resolved: boolean
  /** Not stored for a comment, so that plain notes stay as they are in the file. */
  kind?: NoteKind
  color?: HighlightColor
}

export interface Span {
  from: number
  to: number
}

const KINDS: NoteKind[] = ['comment', 'highlight', 'cut']

export const kindOf = (note: Note): NoteKind => note.kind ?? 'comment'
export const colorOf = (note: Note): HighlightColor => note.color ?? 'yellow'

export interface AttachedNote {
  note: Note
  span: Span
}

const CONTEXT = 32

/** Makes a quote for the text between from and to. */
export function quoteAt(text: string, from: number, to: number, context = CONTEXT): TextQuote {
  return {
    exact: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - context), from),
    suffix: text.slice(to, to + context),
  }
}

function occurrences(text: string, part: string): number[] {
  const found: number[] = []
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + 1)) found.push(i)
  return found
}

/** How many characters before `at` match the end of the prefix, plus how many after `end` match the suffix. */
function contextScore(text: string, at: number, end: number, quote: TextQuote): number {
  let score = 0
  while (score < quote.prefix.length && text[at - 1 - score] === quote.prefix[quote.prefix.length - 1 - score]) score++
  let after = 0
  while (after < quote.suffix.length && text[end + after] === quote.suffix[after]) after++
  return score + after
}

/**
 * Finds a quote in the text. It first looks for the exact passage and uses the context to choose between
 * repeated passages. When the passage itself was edited, it takes the text between the old context.
 * Returns null when the passage cannot be found.
 */
export function locate(text: string, quote: TextQuote): Span | null {
  if (!quote.exact) return null

  let best: Span | null = null
  let bestScore = -1
  for (const at of occurrences(text, quote.exact)) {
    const score = contextScore(text, at, at + quote.exact.length, quote)
    if (score > bestScore) {
      best = { from: at, to: at + quote.exact.length }
      bestScore = score
    }
  }
  if (best) return best

  // The passage changed. Look for the old prefix and suffix close together, with new text between them.
  if (!quote.prefix && !quote.suffix) return null
  const maxGap = quote.exact.length * 4 + 100
  const starts = quote.prefix ? occurrences(text, quote.prefix).map((i) => i + quote.prefix.length) : [0]
  for (const from of starts) {
    const to = quote.suffix ? text.indexOf(quote.suffix, from) : text.length
    if (to > from && to - from <= maxGap) return { from, to }
  }
  return null
}

/** Moves the ends of a selection past white space. Returns null when nothing but white space is left. */
export function trimSpan(text: string, from: number, to: number): Span | null {
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  return from < to ? { from, to } : null
}

/** Finds each open note in the text. Found notes are in text order; the others are detached. */
export function anchorNotes(text: string, notes: Note[]): { attached: AttachedNote[]; detached: Note[] } {
  const attached: AttachedNote[] = []
  const detached: Note[] = []
  for (const note of notes) {
    if (note.resolved) continue
    const span = locate(text, note.quote)
    if (span) attached.push({ note, span })
    else detached.push(note)
  }
  attached.sort((a, b) => a.span.from - b.span.from)
  return { attached, detached }
}

function sameQuote(a: TextQuote, b: TextQuote): boolean {
  return a.exact === b.exact && a.prefix === b.prefix && a.suffix === b.suffix
}

/**
 * Gives a fresh quote for each attached note whose passage or context is not the same as in the text now.
 * Saving these keeps the anchors close to the text, so that many small edits do not detach a note.
 */
export function refreshQuotes(text: string, attached: AttachedNote[]): Map<string, TextQuote> {
  const updates = new Map<string, TextQuote>()
  for (const { note, span } of attached) {
    const quote = quoteAt(text, span.from, span.to)
    if (!sameQuote(quote, note.quote)) updates.set(note.id, quote)
  }
  return updates
}

/**
 * Joins the notes on disk with the notes here, after another program changed the notes file.
 * Notes from both sides stay, the version here wins for a note on both sides, and notes deleted here stay deleted.
 */
export function mergeNotes(disk: Note[], local: Note[], deleted: Set<string>): Note[] {
  const localIds = new Set(local.map((n) => n.id))
  return [...local, ...disk.filter((n) => !localIds.has(n.id) && !deleted.has(n.id))]
}

function isQuote(value: unknown): value is TextQuote {
  const q = value as TextQuote
  return (
    typeof q === 'object' &&
    q !== null &&
    typeof q.exact === 'string' &&
    typeof q.prefix === 'string' &&
    typeof q.suffix === 'string'
  )
}

function isNote(value: unknown): value is Note {
  const n = value as Note
  return (
    typeof n === 'object' &&
    n !== null &&
    typeof n.id === 'string' &&
    isQuote(n.quote) &&
    typeof n.body === 'string' &&
    typeof n.created === 'number' &&
    typeof n.resolved === 'boolean'
  )
}

/** Reads a notes file. Empty or broken input gives no notes, and entries with a bad shape are dropped. */
export function parseNotes(raw: string): Note[] {
  if (!raw.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const notes = (data as { notes?: unknown })?.notes
  if (!Array.isArray(notes)) return []
  return notes.filter(isNote).map(({ id, quote, body, created, resolved, kind, color }) => {
    const note: Note = { id, quote: { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix }, body, created, resolved }
    // An unknown kind or color, for example from a newer version, reads as a plain note.
    if (kind !== 'comment' && KINDS.includes(kind as NoteKind)) note.kind = kind
    if (note.kind === 'highlight' && HIGHLIGHT_COLORS.includes(color as HighlightColor)) note.color = color
    return note
  })
}

/** Writes a notes file. The output is stable and readable, so it gives clean diffs in git. */
export function serializeNotes(notes: Note[]): string {
  return JSON.stringify({ version: 1, notes }, null, 2) + '\n'
}

/** The word count of the document when the given cuts are accepted. */
export function wordsAfterCuts(words: number, cuts: Note[]): number {
  return Math.max(0, cuts.reduce((left, cut) => left - wordCount(cut.quote.exact), words))
}

/**
 * The text to delete when a cut is accepted. It also takes one space, so that the words
 * around the cut do not have two spaces between them, or a space before punctuation.
 */
export function cutRange(text: string, { from, to }: Span): Span {
  const before = text[from - 1]
  const after = text[to]
  if (before === ' ' && after === ' ') return { from, to: to + 1 }
  if (before === ' ' && after !== undefined && /[.,;:!?)]/.test(after)) return { from: from - 1, to }
  return { from, to }
}

/**
 * Gives the top of each margin note. A note stays next to its anchor when it can, and moves down
 * below the note above it when they would overlap. A pinned note (the active one) stays exactly at its
 * anchor: the notes above it move up and the notes below it move down. The result is in input order.
 */
export function stackMargin(items: { top: number; height: number }[], gap: number, pinned?: number): number[] {
  const tops = new Array<number>(items.length)
  const order = items.map((_, i) => i).sort((a, b) => items[a].top - items[b].top)
  const at = pinned === undefined ? -1 : order.indexOf(pinned)
  let bottom = -Infinity
  for (let k = Math.max(0, at); k < order.length; k++) {
    const i = order[k]
    tops[i] = k === at ? items[i].top : Math.max(items[i].top, bottom + gap)
    bottom = tops[i] + items[i].height
  }
  for (let k = at - 1; k >= 0; k--) {
    const i = order[k]
    tops[i] = Math.min(items[i].top, tops[order[k + 1]] - gap - items[i].height)
  }
  return tops
}
