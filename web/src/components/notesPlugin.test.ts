// ABOUTME: Tests for the notes plugin on a real ProseMirror state without a view.
// ABOUTME: They cover mark classes, anchor reports, anchor moves after edits, and accepting cuts and rewrites.

import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, type Plugin, type Transaction } from '@milkdown/kit/prose/state'
import { history, redo, undo } from '@milkdown/kit/prose/history'
import { describe, expect, it } from 'vitest'
import { type Note, quoteAt } from '../lib/annotations'
import { docText } from '../lib/proseText'
import { acceptCuts, acceptRewrite, NOTES, notesPlugin, setNotes } from './notesPlugin'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
  },
})

type MarkSpec = { id: string; phrase: string; kind?: Note['kind']; color?: Note['color']; replacement?: string }

function doc(paragraphs: string[]) {
  return schema.nodes.doc.create(null, paragraphs.map((p) => schema.nodes.paragraph.create(null, schema.text(p))))
}

function notesFor(paragraphs: string[], marks: MarkSpec[]): Note[] {
  const text = docText(doc(paragraphs)).text
  return marks.map(({ id, phrase, kind, color, replacement }) => {
    const at = text.indexOf(phrase)
    return { id, quote: quoteAt(text, at, at + phrase.length), body: '', created: 1, resolved: false, kind, color, replacement }
  })
}

function setup(paragraphs: string[], marks: MarkSpec[], plugins: Plugin[] = []) {
  const notes = notesFor(paragraphs, marks)
  let state = EditorState.create({ doc: doc(paragraphs), plugins: [notesPlugin(() => {}), ...plugins] })
  state = state.apply(setNotes(state.tr, { notes, highlight: null }))
  return state
}

describe('notesPlugin', () => {
  it('gives each kind of mark its own class', () => {
    const state = setup(['One two three four.'], [
      { id: 'n', phrase: 'One' },
      { id: 'h', phrase: 'two', kind: 'highlight', color: 'green' },
      { id: 'c', phrase: 'three', kind: 'cut' },
      { id: 'r', phrase: 'four', kind: 'rewrite', replacement: '4' },
    ])
    const classes = NOTES.getState(state)!.decorations.find().map((d) => (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class)
    expect(classes).toEqual(['note-anchor', 'mark-highlight hl-green', 'mark-cut', 'mark-rewrite'])
    expect(NOTES.getState(state)!.report.attached).toEqual(['n', 'h', 'c', 'r'])
  })

  it('deletes the text of accepted cuts and the extra space, in one transaction', () => {
    const state = setup(['A worse one, quickly, and then keep going.', 'Second very long paragraph.'], [
      { id: 'a', phrase: 'quickly,', kind: 'cut' },
      { id: 'b', phrase: 'very long', kind: 'cut' },
    ])
    const tr = acceptCuts(state, ['a', 'b'])!
    const next = state.apply(tr)
    expect(docText(next.doc).text).toBe('A worse one, and then keep going.\nSecond paragraph.')
  })

  it('does nothing for a cut that has no text now', () => {
    const state = setup(['Some text.'], [{ id: 'gone', phrase: 'missing', kind: 'cut' }])
    expect(acceptCuts(state, ['gone'])).toBeNull()
  })

  it('puts the replacement of a rewrite in place of its text', () => {
    const state = setup(['We should circle back soon.'], [{ id: 'r', phrase: 'should circle back', kind: 'rewrite', replacement: 'will talk again' }])
    const next = state.apply(acceptRewrite(state, 'r')!)
    expect(docText(next.doc).text).toBe('We will talk again soon.')
  })

  it('does nothing for a rewrite that has no text now', () => {
    const state = setup(['Some text.'], [{ id: 'gone', phrase: 'missing', kind: 'rewrite', replacement: 'x' }])
    expect(acceptRewrite(state, 'gone')).toBeNull()
  })
})

/** The text that a note is anchored on, read from the plugin state. */
function spanText(state: EditorState, id: string): string {
  const span = NOTES.getState(state)!.spans.get(id)!
  return docText(state.doc).text.slice(span.from, span.to)
}

/** Runs an undo or redo command and gives the state that it produced. */
function applyCommand(state: EditorState, run: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) {
  let next = state
  run(state, (tr) => {
    next = state.apply(tr)
  })
  return next
}

describe('notesPlugin anchors', () => {
  const CATS = 'The cat sat. The cat slept.'
  const at = (phrase: string) => CATS.indexOf(phrase)

  it('detaches a note when its text is deleted, and leaves equal text elsewhere alone', () => {
    const state = setup([CATS], [{ id: 'n', phrase: 'cat' }])
    const from = at('cat')
    const next = state.apply(state.tr.delete(1 + from, 1 + from + 'cat'.length))
    expect(docText(next.doc).text).toBe('The  sat. The cat slept.')
    expect(NOTES.getState(next)!.report.attached).toEqual([])
    expect(NOTES.getState(next)!.report.detached).toEqual(['n'])
    expect(NOTES.getState(next)!.decorations.find()).toEqual([])
  })

  it('keeps a detached note detached when the notes are set again', () => {
    const state = setup([CATS], [{ id: 'n', phrase: 'cat' }])
    const from = at('cat')
    const deleted = state.apply(state.tr.delete(1 + from, 1 + from + 'cat'.length))
    const again = deleted.apply(setNotes(deleted.tr, { notes: NOTES.getState(deleted)!.notes, highlight: 'n' }))
    expect(NOTES.getState(again)!.report.attached).toEqual([])
    expect(NOTES.getState(again)!.report.detached).toEqual(['n'])
    expect(NOTES.getState(again)!.decorations.find()).toEqual([])
  })

  it('keeps the anchor when text is typed inside and around the quote', () => {
    const state = setup([CATS], [{ id: 'n', phrase: 'cat sat' }])
    const from = at('cat sat')
    const inside = state.apply(state.tr.insertText(' big', 1 + from + 'cat'.length))
    expect(spanText(inside, 'n')).toBe('cat big sat')
    const around = inside.apply(inside.tr.insertText('And ', 1))
    expect(spanText(around, 'n')).toBe('cat big sat')
    expect(NOTES.getState(around)!.report.detached).toEqual([])
  })

  it('keeps the anchor through undo and redo of an edit inside the quote', () => {
    const state = setup([CATS], [{ id: 'n', phrase: 'cat sat' }], [history()])
    const from = at('cat sat')
    const typed = state.apply(state.tr.insertText(' big', 1 + from + 'cat'.length))
    expect(spanText(typed, 'n')).toBe('cat big sat')
    const undone = applyCommand(typed, undo)
    expect(spanText(undone, 'n')).toBe('cat sat')
    const redone = applyCommand(undone, redo)
    expect(spanText(redone, 'n')).toBe('cat big sat')
  })

  it('takes a detached note back when an undo brings its text back', () => {
    const state = setup([CATS], [{ id: 'n', phrase: 'cat' }], [history()])
    const from = at('cat')
    const deleted = state.apply(state.tr.delete(1 + from, 1 + from + 'cat'.length))
    expect(NOTES.getState(deleted)!.report.detached).toEqual(['n'])
    const undone = applyCommand(deleted, undo)
    expect(NOTES.getState(undone)!.report.attached).toEqual(['n'])
    expect(spanText(undone, 'n')).toBe('cat')
    const redone = applyCommand(undone, redo)
    expect(NOTES.getState(redone)!.report.detached).toEqual(['n'])
  })

  it('anchors a note again on a replaced document, using its context', () => {
    const notes = notesFor([CATS], [{ id: 'n', phrase: 'cat' }])
    let state = EditorState.create({ doc: doc(['An opening sentence was written here. ' + CATS]), plugins: [notesPlugin(() => {})] })
    state = state.apply(setNotes(state.tr, { notes, highlight: null }))
    expect(NOTES.getState(state)!.report.attached).toEqual(['n'])
    expect(spanText(state, 'n')).toBe('cat')
    expect(NOTES.getState(state)!.spans.get('n')!.from).toBe(docText(state.doc).text.indexOf('cat'))
  })

  it('keeps the anchor in place when its text is typed over, and reports the new passage', () => {
    const state = setup([CATS], [{ id: 'n', phrase: 'cat' }])
    const from = at('cat')
    const next = state.apply(state.tr.replaceWith(1 + from, 1 + from + 'cat'.length, schema.text('dog')))
    expect(docText(next.doc).text).toBe('The dog sat. The cat slept.')
    expect(NOTES.getState(next)!.report.attached).toEqual(['n'])
    expect(spanText(next, 'n')).toBe('dog')
    expect(NOTES.getState(next)!.report.quotes.get('n')?.exact).toBe('dog')
  })
})
