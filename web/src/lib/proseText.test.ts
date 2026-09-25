// ABOUTME: Tests for the plain text of a ProseMirror document and its position map.
// ABOUTME: They use a small schema with paragraphs, headings, marks, and hard breaks.

import { Schema } from '@milkdown/kit/prose/model'
import { describe, expect, it } from 'vitest'
import { docText } from './proseText'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
    hardbreak: { group: 'inline', inline: true },
  },
  marks: { strong: {} },
})

const { doc, paragraph: p, heading: h, blockquote: q, hardbreak } = schema.nodes
const t = (value: string, strong = false) => schema.text(value, strong ? [schema.marks.strong.create()] : [])

// <h>Title</h> <p>One **bold** end</p> <q><p>Line<br>two</p></q>
const sample = doc.create(null, [
  h.create(null, t('Title')),
  p.create(null, [t('One '), t('bold', true), t(' end')]),
  q.create(null, p.create(null, [t('Line'), hardbreak.create(), t('two')])),
])

describe('docText', () => {
  it('joins text blocks with new lines and turns hard breaks into new lines', () => {
    expect(docText(sample).text).toBe('Title\nOne bold end\nLine\ntwo')
  })

  it('maps text offsets to document positions and back', () => {
    const map = docText(sample)
    for (const word of ['Title', 'bold', 'end', 'two']) {
      const from = map.text.indexOf(word)
      const start = map.toPos(from, 'start')
      const end = map.toPos(from + word.length, 'end')
      expect(sample.textBetween(start, end)).toBe(word)
      expect(map.toOffset(start)).toBe(from)
      expect(map.toOffset(end)).toBe(from + word.length)
    }
  })

  it('maps the start of a block to the inside of that block', () => {
    const map = docText(sample)
    const from = map.text.indexOf('One')
    const pos = map.toPos(from, 'start')
    expect(sample.resolve(pos).parent.type.name).toBe('paragraph')
    expect(sample.textBetween(pos, map.toPos(from + 4, 'end'))).toBe('One ')
  })

  it('maps a position between blocks to the next text', () => {
    const map = docText(sample)
    expect(map.toOffset(0)).toBe(0)
    expect(map.toOffset(sample.content.size)).toBe(map.text.length)
  })

  it('handles an empty document', () => {
    const empty = doc.create(null, p.create())
    const map = docText(empty)
    expect(map.text).toBe('')
    expect(map.toOffset(1)).toBe(0)
    expect(map.toPos(0, 'start')).toBe(1)
  })
})
