// ABOUTME: Tests for the lint plugin on a real ProseMirror state without a view.
// ABOUTME: They cover findings and marks, updates after edits, rules that change, and code blocks.

import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, type LintRules } from '../lib/lint'
import { LINT, lintPlugin, setLintRules } from './lintPlugin'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: { group: 'block', content: 'text*', code: true },
    text: {},
  },
})

function setup(blocks: [string, string][], rules: LintRules | null = DEFAULT_RULES) {
  const doc = schema.nodes.doc.create(null, blocks.map(([type, text]) => schema.nodes[type].create(null, text ? schema.text(text) : null)))
  let state = EditorState.create({ doc, plugins: [lintPlugin()] })
  state = state.apply(setLintRules(state.tr, rules))
  return state
}

const marked = (state: EditorState) =>
  LINT.getState(state)!.decorations.find().map((d) => [state.doc.textBetween(d.from, d.to), (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs])

describe('lintPlugin', () => {
  it('marks each finding with its rule and index', () => {
    const state = setup([['paragraph', 'We need synergy.'], ['paragraph', 'It is is here.']])
    expect(marked(state)).toEqual([
      ['synergy', { class: 'lint-mark lint-phrases', 'data-lint': '0' }],
      ['is is', { class: 'lint-mark lint-repeatedWord', 'data-lint': '1' }],
    ])
    expect(LINT.getState(state)!.findings.map((f) => f.match)).toEqual(['synergy', 'is is'])
  })

  it('checks again after each edit', () => {
    let state = setup([['paragraph', 'Fine text.']])
    expect(marked(state)).toEqual([])
    state = state.apply(state.tr.insertText(' the the', 11))
    expect(marked(state).map(([text]) => text)).toEqual(['the the'])
  })

  it('shows nothing without rules, and checks again when the rules change', () => {
    let state = setup([['paragraph', 'the the synergy']], null)
    expect(marked(state)).toEqual([])
    state = state.apply(setLintRules(state.tr, { ...DEFAULT_RULES, phrases: { ...DEFAULT_RULES.phrases, enabled: false } }))
    expect(marked(state).map(([text]) => text)).toEqual(['the the'])
  })

  it('does not check code blocks', () => {
    const state = setup([['code_block', 'the the'], ['paragraph', 'ok']])
    expect(marked(state)).toEqual([])
  })
})
