// ABOUTME: CodeMirror extension that runs the writing lint on the Markdown source and underlines each finding.
// ABOUTME: The message of each finding shows as the title of its mark.

import { type EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { lint, type LintRules, markdownBlocks } from '../lib/lint'

type Value = { rules: LintRules | null; decorations: DecorationSet }

/** Sets the rules to check with; null turns the lint off. */
export const setSourceLintRules = StateEffect.define<LintRules | null>()

function compute(state: EditorState, rules: LintRules | null): Value {
  if (!rules) return { rules, decorations: Decoration.none }
  const text = state.doc.toString()
  const marks = lint(text, markdownBlocks(text), rules)
    .filter((f) => f.to > f.from)
    .map((f) => Decoration.mark({ class: `lint-mark lint-${f.rule}`, attributes: { title: f.message } }).range(f.from, f.to))
  return { rules, decorations: Decoration.set(marks, true) }
}

export const sourceLintField = StateField.define<Value>({
  create: () => ({ rules: null, decorations: Decoration.none }),
  update: (value, tr) => {
    let rules = value.rules
    let changed = tr.docChanged
    for (const effect of tr.effects) {
      if (effect.is(setSourceLintRules)) {
        rules = effect.value
        changed = true
      }
    }
    return changed ? compute(tr.state, rules) : value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

/** The lint field, first set to the given rules. */
export function sourceLint(rules: LintRules | null) {
  return sourceLintField.init((state) => compute(state, rules))
}
