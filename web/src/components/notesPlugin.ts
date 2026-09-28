// ABOUTME: ProseMirror plugin that marks the text of each note, highlight, cut, and rewrite, and reports which ones it found.
// ABOUTME: Anchors follow the text through each edit; a note whose text is gone is reported as detached, not put on equal text.

import { type Node } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import {
  type AttachedNote, colorOf, cutRange, kindOf, locate, type Note, quoteAt, refreshQuotes, sameQuote, type Span,
  type TextQuote, trimSpan, wordsAfterCuts,
} from '../lib/annotations'
import { type DocText, docText } from '../lib/proseText'

/**
 * What the editor found: notes in text order, notes that lost their text, quotes to store again,
 * and the word count that is left when every attached cut is accepted.
 */
export type AnchorReport = {
  attached: string[]
  detached: string[]
  quotes: Map<string, TextQuote>
  /** The word count after the cuts; null when no cut has text in the document. */
  cutWords: number | null
}

type Input = { notes: Note[]; highlight: string | null }

/** A note's place in the document, in ProseMirror positions. */
type Anchor = { from: number; to: number }

/**
 * Where each note sits. `live` holds the anchor of each note with text in the document. `lost` holds the
 * place where a deleted note's text was, or null when its text was never found. `quotes` holds the quote
 * that each of these outcomes was resolved against.
 */
type Anchors = { live: Map<string, Anchor>; lost: Map<string, Anchor | null>; quotes: Map<string, TextQuote> }

const NO_ANCHORS: Anchors = { live: new Map(), lost: new Map(), quotes: new Map() }

type State = Input & { anchors: Anchors; decorations: DecorationSet; report: AnchorReport; spans: Map<string, Span> }

export const NOTES = new PluginKey<State>('emditor-notes')

/** Builds the plugin state from the anchors: the decorations, the text spans, and the report for the pane. */
function build(doc: Node, map: DocText, input: Input, anchors: Anchors): State {
  const seated: (AttachedNote & { pos: Anchor })[] = []
  const detached: string[] = []
  const spans = new Map<string, Span>()
  for (const note of input.notes) {
    if (note.resolved) continue
    const pos = anchors.live.get(note.id)
    if (!pos) {
      detached.push(note.id)
      continue
    }
    const from = map.toOffset(pos.from)
    const span: Span = { from, to: Math.max(from, map.toOffset(pos.to)) }
    seated.push({ note, span, pos })
    spans.set(note.id, span)
  }
  seated.sort((a, b) => a.span.from - b.span.from)
  const cutSpans = seated.filter(({ note }) => kindOf(note) === 'cut').map(({ span }) => span)
  return {
    notes: input.notes,
    highlight: input.highlight,
    anchors,
    spans,
    decorations: DecorationSet.create(
      doc,
      seated.map(({ note, pos }) =>
        Decoration.inline(pos.from, pos.to, {
          class: `${markClass(note)}${note.id === input.highlight ? ' is-active' : ''}`,
          'data-note-id': note.id,
        }),
      ),
    ),
    report: {
      attached: seated.map(({ note }) => note.id),
      detached,
      quotes: refreshQuotes(map.text, seated),
      cutWords: cutSpans.length > 0 ? wordsAfterCuts(map.text, cutSpans) : null,
    },
  }
}

/**
 * Gives each note an anchor. A note whose quote did not change keeps the outcome it has, so an edit that
 * deleted its text does not put it on equal text somewhere else. A note without an outcome, or with a
 * changed quote, is searched for; the context decides between equal passages.
 */
function resolve(map: DocText, notes: Note[], carried: Anchors): Anchors {
  const live = new Map<string, Anchor>()
  const lost = new Map<string, Anchor | null>()
  const quotes = new Map<string, TextQuote>()
  for (const note of notes) {
    if (note.resolved) continue
    const known = carried.quotes.get(note.id)
    if (known && sameQuote(known, note.quote)) {
      quotes.set(note.id, known)
      const pos = carried.live.get(note.id)
      if (pos) live.set(note.id, pos)
      else lost.set(note.id, carried.lost.get(note.id) ?? null)
      continue
    }
    quotes.set(note.id, note.quote)
    const span = locate(map.text, note.quote)
    if (span) live.set(note.id, { from: map.toPos(span.from, 'start'), to: map.toPos(span.to, 'end') })
    else lost.set(note.id, null)
  }
  return { live, lost, quotes }
}

/**
 * Moves each anchor through the changes of a transaction. An anchor whose text was deleted collapses
 * into `lost`. When an edit puts the same passage back between the two ends, for example an undo of
 * the deletion, the note becomes live again.
 */
function carry(tr: Transaction, anchors: Anchors, map: DocText): Anchors {
  const live = new Map<string, Anchor>()
  const lost = new Map<string, Anchor | null>()
  for (const [id, pos] of anchors.live) {
    const from = tr.mapping.map(pos.from, 1)
    const to = tr.mapping.map(pos.to, -1)
    if (to > from) live.set(id, { from, to })
    else lost.set(id, { from, to })
  }
  for (const [id, pos] of anchors.lost) {
    if (!pos) {
      lost.set(id, null)
      continue
    }
    const from = tr.mapping.map(pos.from, 1)
    const to = tr.mapping.map(pos.to, -1)
    // Text that came back between the two ends takes the note back; any other text does not.
    const back = from > to && map.text.slice(map.toOffset(to), map.toOffset(from)) === anchors.quotes.get(id)?.exact
    if (back) live.set(id, { from: to, to: from })
    else lost.set(id, { from, to })
  }
  return { live, lost, quotes: anchors.quotes }
}

function markClass(note: Note): string {
  const kind = kindOf(note)
  if (kind === 'highlight') return `mark-highlight hl-${colorOf(note)}`
  if (kind === 'rewrite') return 'mark-rewrite'
  return kind === 'cut' ? 'mark-cut' : 'note-anchor'
}

/** A transaction that deletes the text of the given cuts, or null when none of them has text now. */
export function acceptCuts(state: EditorState, ids: string[]): Transaction | null {
  const spans = NOTES.getState(state)?.spans
  if (!spans) return null
  const map = docText(state.doc)
  const ranges = ids
    .map((id) => spans.get(id))
    .filter((span): span is Span => Boolean(span))
    .map((span) => cutRange(map.text, span))
    .sort((a, b) => b.from - a.from)
  if (ranges.length === 0) return null
  const tr = state.tr
  for (const range of ranges) {
    const from = tr.mapping.map(map.toPos(range.from, 'start'))
    const to = tr.mapping.map(map.toPos(range.to, 'end'))
    if (to > from) tr.delete(from, to)
  }
  return tr
}

/** A transaction that puts the replacement of a rewrite in place of its text, or null when the text is gone. */
export function acceptRewrite(state: EditorState, id: string): Transaction | null {
  const plugin = NOTES.getState(state)
  const span = plugin?.spans.get(id)
  const note = plugin?.notes.find((n) => n.id === id)
  if (!span || note?.replacement === undefined) return null
  const map = docText(state.doc)
  const from = map.toPos(span.from, 'start')
  const to = map.toPos(span.to, 'end')
  // Text typed at the start takes the marks there, so a rewrite of bold text stays bold.
  return note.replacement ? state.tr.insertText(note.replacement, from, to) : state.tr.delete(from, to)
}

/** Sets the notes to show or the note to highlight. */
export function setNotes(tr: Transaction, input: Partial<Input>) {
  return tr.setMeta(NOTES, input).setMeta('addToHistory', false)
}

/** The quote of the current selection, or null when the selection has no text. */
export function selectionQuote(doc: Node, from: number, to: number): TextQuote | null {
  const map = docText(doc)
  const span = trimSpan(map.text, map.toOffset(from), map.toOffset(to))
  return span ? quoteAt(map.text, span.from, span.to) : null
}

export function notesPlugin(onReport: (report: AnchorReport) => void) {
  return new Plugin<State>({
    key: NOTES,
    state: {
      init: (_, state) => build(state.doc, docText(state.doc), { notes: [], highlight: null }, NO_ANCHORS),
      apply: (tr, value, _old, state) => {
        const input = tr.getMeta(NOTES) as Partial<Input> | undefined
        if (!input && !tr.docChanged) return value
        const map = docText(state.doc)
        const notes = input?.notes ?? value.notes
        const highlight = input && 'highlight' in input ? input.highlight ?? null : value.highlight
        // Each edit carries the anchors through the transaction. The search runs only for a note without
        // an outcome or with a changed quote, for example on a loaded document or a note moved by hand.
        const carried = tr.docChanged ? carry(tr, value.anchors, map) : value.anchors
        return build(state.doc, map, { notes, highlight }, resolve(map, notes, carried))
      },
    },
    props: { decorations: (state) => NOTES.getState(state)?.decorations },
    view: () => ({
      update: (view, prev) => {
        const report = NOTES.getState(view.state)?.report
        if (report && report !== NOTES.getState(prev)?.report) onReport(report)
      },
    }),
  })
}
