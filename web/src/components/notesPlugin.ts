// ABOUTME: ProseMirror plugin that marks the text of each note, highlight, cut, and rewrite, and reports which ones it found.
// ABOUTME: It only adds decorations; the Markdown changes only when a cut or a rewrite is accepted.

import { type Node } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { anchorNotes, colorOf, cutRange, kindOf, type Note, quoteAt, refreshQuotes, type Span, type TextQuote, trimSpan } from '../lib/annotations'
import { docText } from '../lib/proseText'

/** What the editor found: notes in text order, notes that lost their text, and quotes to store again. */
export type AnchorReport = { attached: string[]; detached: string[]; quotes: Map<string, TextQuote> }

type Input = { notes: Note[]; highlight: string | null }
type State = Input & { decorations: DecorationSet; report: AnchorReport; spans: Map<string, Span> }

export const NOTES = new PluginKey<State>('emditor-notes')

function compute(doc: Node, { notes, highlight }: Input): State {
  const map = docText(doc)
  const { attached, detached } = anchorNotes(map.text, notes)
  const decorations = attached.map(({ note, span }) =>
    Decoration.inline(map.toPos(span.from, 'start'), map.toPos(span.to, 'end'), {
      class: `${markClass(note)}${note.id === highlight ? ' is-active' : ''}`,
      'data-note-id': note.id,
    }),
  )
  return {
    notes,
    highlight,
    spans: new Map(attached.map((a) => [a.note.id, a.span])),
    decorations: DecorationSet.create(doc, decorations),
    report: {
      attached: attached.map((a) => a.note.id),
      detached: detached.map((n) => n.id),
      quotes: refreshQuotes(map.text, attached),
    },
  }
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
      init: (_, state) => compute(state.doc, { notes: [], highlight: null }),
      apply: (tr, value, _old, state) => {
        const input = tr.getMeta(NOTES) as Partial<Input> | undefined
        if (!input && !tr.docChanged) return value
        return compute(state.doc, { notes: input?.notes ?? value.notes, highlight: input && 'highlight' in input ? input.highlight ?? null : value.highlight })
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
