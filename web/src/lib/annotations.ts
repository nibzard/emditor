// ABOUTME: Pure logic for document annotations (notes, highlights, cuts, rewrites) in a sidecar file next to the Markdown.
// ABOUTME: Text-quote anchors, anchor recovery after edits, the notes file format, cuts, rewrite diffs, and margin layout.

import { wordCount } from './text'

/** A passage of the document's plain text, with some context on each side to find it again. */
export interface TextQuote {
  exact: string
  prefix: string
  suffix: string
}

/**
 * A comment is a margin note, a highlight marks text with a color, a cut suggests removing the text,
 * and a rewrite suggests replacing the text with its replacement.
 */
export type NoteKind = 'comment' | 'highlight' | 'cut' | 'rewrite'
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
  /** The text that a rewrite puts in place of the quote. */
  replacement?: string
}

export interface Span {
  from: number
  to: number
}

const KINDS: NoteKind[] = ['comment', 'highlight', 'cut', 'rewrite']

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

/**
 * Finds a quote inside one part of the text, between from and to. When the part holds the passage more
 * than once, the context decides between the equal passages, as in `locate`. Returns null when the part
 * does not hold the passage. Only the exact passage counts, so a part with changed text gives null.
 */
export function locateWithin(text: string, from: number, to: number, quote: TextQuote): Span | null {
  if (!quote.exact) return null
  let best: Span | null = null
  let bestScore = -1
  for (let at = text.indexOf(quote.exact, from); at >= 0 && at + quote.exact.length <= to; at = text.indexOf(quote.exact, at + 1)) {
    const score = contextScore(text, at, at + quote.exact.length, quote)
    if (score > bestScore) {
      best = { from: at, to: at + quote.exact.length }
      bestScore = score
    }
  }
  return best
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

/** Whether two quotes carry the same passage and the same context. */
export function sameQuote(a: TextQuote, b: TextQuote): boolean {
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

/** Why a notes file that exists could not be read: its content is broken, or another version of emditor wrote it. */
export type NotesFileError = 'malformed' | 'unsupported-version'
export type LoadedNotes = { notes: Note[]; error: null } | { notes: null; error: NotesFileError }

/** Whether two states of one note hold the same data. */
function sameNote(a: Note, b: Note): boolean {
  return (
    a.id === b.id &&
    a.body === b.body &&
    a.created === b.created &&
    a.resolved === b.resolved &&
    a.kind === b.kind &&
    a.color === b.color &&
    a.replacement === b.replacement &&
    sameQuote(a.quote, b.quote)
  )
}

/**
 * Joins three states of one notes file: the state that both sides started from (`base`), the state on disk
 * now, and the state here. A note changed here wins over any state on disk. A note untouched here takes the
 * disk state, so a change or a removal on disk survives. A note removed here stays removed, also when disk
 * changed it, because the removal was the last choice made here. Notes added on either side stay, and the
 * notes that stay keep the order they have here.
 */
export function mergeNotes(base: Note[], disk: Note[], local: Note[]): Note[] {
  const baseById = new Map(base.map((n) => [n.id, n]))
  const diskById = new Map(disk.map((n) => [n.id, n]))
  const out: Note[] = []
  for (const note of local) {
    const ancestor = baseById.get(note.id)
    // A note that was added or changed here stays as it is here.
    if (!ancestor || !sameNote(ancestor, note)) out.push(note)
    // A note untouched here takes the disk state, which also removes it when disk removed it.
    else if (diskById.has(note.id)) out.push(diskById.get(note.id)!)
  }
  const localIds = new Set(local.map((n) => n.id))
  for (const note of disk) {
    // A note of the base state that is not here was removed here, so it stays removed. The rest was added on disk.
    if (!localIds.has(note.id) && !baseById.has(note.id)) out.push(note)
  }
  return out
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

/**
 * Reads the content of a notes file that exists. Whitespace-only or broken content is an error instead of an
 * empty list, so a damaged file is never treated as a file without notes and then overwritten. Entries with a
 * bad shape are dropped. A document without a notes file has empty content and modified 0; the caller tells
 * that case apart before it calls this.
 */
export function parseNotes(raw: string): LoadedNotes {
  if (!raw.trim()) return { notes: null, error: 'malformed' }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { notes: null, error: 'malformed' }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { notes: null, error: 'malformed' }
  const file = data as { version?: unknown; notes?: unknown }
  if (file.version !== 1) return { notes: null, error: 'unsupported-version' }
  if (!Array.isArray(file.notes)) return { notes: null, error: 'malformed' }
  const notes = file.notes.filter(isNote).map(({ id, quote, body, created, resolved, kind, color, replacement }) => {
    const note: Note = { id, quote: { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix }, body, created, resolved }
    // An unknown kind or color, for example from a newer version, reads as a plain note.
    if (kind !== 'comment' && KINDS.includes(kind as NoteKind)) note.kind = kind
    if (note.kind === 'highlight' && HIGHLIGHT_COLORS.includes(color as HighlightColor)) note.color = color
    // A rewrite without its replacement cannot be accepted, so it reads as a plain note.
    if (note.kind === 'rewrite') {
      if (typeof replacement === 'string') note.replacement = replacement
      else delete note.kind
    }
    return note
  })
  return { notes, error: null }
}

/** Writes a notes file. The output is stable and readable, so it gives clean diffs in git. */
export function serializeNotes(notes: Note[]): string {
  return JSON.stringify({ version: 1, notes }, null, 2) + '\n'
}

/**
 * The word count of the text when the given cut ranges are accepted. The ranges are joined into one
 * union first, so two cuts over the same words remove those words once.
 */
export function wordsAfterCuts(text: string, cuts: Span[]): number {
  const ranges = cuts.filter((cut) => cut.to > cut.from).sort((a, b) => a.from - b.from)
  const kept: string[] = []
  let at = 0
  for (const { from, to } of ranges) {
    if (from > at) kept.push(text.slice(at, from))
    at = Math.max(at, to)
  }
  if (at < text.length) kept.push(text.slice(at))
  return wordCount(kept.join('\n'))
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

export type DiffPart = { kind: 'same' | 'add' | 'del'; text: string }

/** A word diff (longest common subsequence). The passages are short, so O(n·m) is fine. */
export function diffWords(a: string, b: string): DiffPart[] {
  const x = a.match(/\s+|[^\s]+/g) ?? []
  const y = b.match(/\s+|[^\s]+/g) ?? []
  if (x.length * y.length > 400_000) return [{ kind: 'del', text: a }, { kind: 'add', text: b }]
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last?.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('same', x[i++])
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', x[i++])
    else push('add', y[j++])
  }
  while (i < x.length) push('del', x[i++])
  while (j < y.length) push('add', y[j++])
  return joinChanges(out)
}

/** Joins changes that only a space keeps apart, so that "circle back" → "talk again" reads as one change. */
function joinChanges(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  let del = ''
  let add = ''
  const flush = () => {
    if (del) out.push({ kind: 'del', text: del })
    if (add) out.push({ kind: 'add', text: add })
    del = ''
    add = ''
  }
  parts.forEach((part, k) => {
    if (part.kind === 'del') del += part.text
    else if (part.kind === 'add') add += part.text
    else if ((del || add) && /^\s+$/.test(part.text) && parts[k + 1] && parts[k + 1].kind !== 'same') {
      del += part.text
      add += part.text
    } else {
      flush()
      out.push(part)
    }
  })
  flush()
  return out
}

/** The text before and after a span, each side cut to the limit, for a rewrite request. */
export function contextAround(text: string, { from, to }: Span, limit = 600): string {
  const before = text.slice(0, from).trim()
  const after = text.slice(to).trim()
  const parts: string[] = []
  if (before) parts.push(`[before] ${before.length > limit ? '…' + before.slice(-limit) : before}`)
  if (after) parts.push(`[after] ${after.length > limit ? after.slice(0, limit) + '…' : after}`)
  return parts.join('\n')
}
