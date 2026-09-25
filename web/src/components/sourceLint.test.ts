// ABOUTME: Tests for the source-mode lint on a real CodeMirror state without a view.
// ABOUTME: They cover marks at source offsets, updates after edits, and rules that change.

import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../lib/lint'
import { setSourceLintRules, sourceLint, sourceLintField } from './sourceLint'

const marked = (state: EditorState) => {
  const out: [string, string][] = []
  state.field(sourceLintField).decorations.between(0, state.doc.length, (from, to, deco) => {
    out.push([state.sliceDoc(from, to), deco.spec.attributes.title])
  })
  return out
}

describe('sourceLint', () => {
  it('marks findings at source offsets and skips code', () => {
    const state = EditorState.create({ doc: '# Title\n\nWe need **synergy**.\n\n```\nthe the\n```', extensions: sourceLint(DEFAULT_RULES) })
    expect(marked(state)).toEqual([['synergy', '“synergy” is on your list of phrases to avoid.']])
  })

  it('checks again after each edit', () => {
    let state = EditorState.create({ doc: 'Fine.', extensions: sourceLint(DEFAULT_RULES) })
    state = state.update({ changes: { from: 5, insert: ' It it goes.' } }).state
    expect(marked(state).map(([text]) => text)).toEqual(['It it'])
  })

  it('shows nothing without rules, and checks again when the rules change', () => {
    let state = EditorState.create({ doc: 'the the', extensions: sourceLint(null) })
    expect(marked(state)).toEqual([])
    state = state.update({ effects: setSourceLintRules.of(DEFAULT_RULES) }).state
    expect(marked(state).map(([text]) => text)).toEqual(['the the'])
  })
})
