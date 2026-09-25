// ABOUTME: Tests for the notes plugin on a real ProseMirror state without a view.
// ABOUTME: They cover mark classes, anchor reports, and accepting cuts.

import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { type Note, quoteAt } from '../lib/annotations'
import { docText } from '../lib/proseText'
import { acceptCuts, NOTES, notesPlugin, setNotes } from './notesPlugin'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
  },
})

function setup(paragraphs: string[], marks: { id: string; phrase: string; kind?: Note['kind']; color?: Note['color'] }[]) {
  const doc = schema.nodes.doc.create(null, paragraphs.map((p) => schema.nodes.paragraph.create(null, schema.text(p))))
  const text = docText(doc).text
  const notes: Note[] = marks.map(({ id, phrase, kind, color }) => {
    const at = text.indexOf(phrase)
    return { id, quote: quoteAt(text, at, at + phrase.length), body: '', created: 1, resolved: false, kind, color }
  })
  let state = EditorState.create({ doc, plugins: [notesPlugin(() => {})] })
  state = state.apply(setNotes(state.tr, { notes, highlight: null }))
  return state
}

describe('notesPlugin', () => {
  it('gives each kind of mark its own class', () => {
    const state = setup(['One two three four.'], [
      { id: 'n', phrase: 'One' },
      { id: 'h', phrase: 'two', kind: 'highlight', color: 'green' },
      { id: 'c', phrase: 'three', kind: 'cut' },
    ])
    const classes = NOTES.getState(state)!.decorations.find().map((d) => (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class)
    expect(classes).toEqual(['note-anchor', 'mark-highlight hl-green', 'mark-cut'])
    expect(NOTES.getState(state)!.report.attached).toEqual(['n', 'h', 'c'])
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
})
