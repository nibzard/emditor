// ABOUTME: Tests for the semantic plugin state on a real ProseMirror state without a view.
// ABOUTME: They cover marks for each range, findings for other text, and marks that follow edits.

import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import type { SemanticFinding } from '../lib/semanticScheduler'
import { docText } from '../lib/proseText'
import { findingsAt, SEMANTIC, semanticState, setSemanticFindings } from './semanticPlugin'

const schema = new Schema({
  nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {} },
})

function setup(paragraphs: string[]) {
  const doc = schema.nodes.doc.create(null, paragraphs.map((p) => schema.nodes.paragraph.create(null, schema.text(p))))
  return EditorState.create({ doc, plugins: [semanticState()] })
}

function finding(text: string, phrase: string, scope: SemanticFinding['scope'] = 'sentence'): SemanticFinding {
  const from = text.indexOf(phrase)
  return {
    key: `k:${phrase}`, ruleId: 'r', name: 'Rule', scope, message: 'Maybe.', text: phrase, context: '',
    ranges: [{ from, to: from + phrase.length }], probability: 0.9, threshold: 0.85,
  }
}

const marks = (state: EditorState) =>
  SEMANTIC.getState(state)!.decorations.find().map((d) => [state.doc.textBetween(d.from, d.to), (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs])

describe('semanticPlugin state', () => {
  it('marks each range of each finding with its scope', () => {
    let state = setup(['One hyped sentence.', 'Two.'])
    const text = docText(state.doc).text
    const passage: SemanticFinding = { ...finding(text, 'One hyped sentence.', 'passage'), ranges: [{ from: 0, to: 19 }, { from: 20, to: 24 }] }
    state = state.apply(setSemanticFindings(state.tr, [passage], text))
    expect(marks(state)).toEqual([
      ['One hyped sentence.', { class: 'lint-mark lint-semantic lint-scope-passage', 'data-semantic': '' }],
      ['Two.', { class: 'lint-mark lint-semantic lint-scope-passage', 'data-semantic': '' }],
    ])
    expect(SEMANTIC.getState(state)!.findings).toEqual([passage])
  })

  it('ignores findings that were made for other text', () => {
    let state = setup(['Hyped.'])
    state = state.apply(setSemanticFindings(state.tr, [finding('Hyped.', 'Hyped.')], 'Other text.'))
    expect(marks(state)).toEqual([])
  })

  it('moves the marks with edits until new findings come', () => {
    let state = setup(['Hyped.'])
    state = state.apply(setSemanticFindings(state.tr, [finding('Hyped.', 'Hyped.')], 'Hyped.'))
    state = state.apply(state.tr.insertText('New. ', 1))
    expect(marks(state).map(([t]) => t)).toEqual(['Hyped.'])
  })

  it('finds the findings at an offset, the sentence before the passage', () => {
    const text = 'One hyped sentence. Two.'
    const sentence = finding(text, 'One hyped sentence.')
    const passage = { ...finding(text, text, 'passage'), key: 'p' }
    expect(findingsAt([passage, sentence], 3).map((f) => f.scope)).toEqual(['sentence', 'passage'])
    expect(findingsAt([passage, sentence], 21).map((f) => f.scope)).toEqual(['passage'])
    expect(findingsAt([passage, sentence], 99)).toEqual([])
  })
})
