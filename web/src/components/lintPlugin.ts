// ABOUTME: ProseMirror plugin that runs the writing lint on each change and underlines each finding.
// ABOUTME: It only adds decorations, so findings never go into the Markdown or into copied text.

import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { type Finding, lint, type LintRules } from '../lib/lint'
import { docText } from '../lib/proseText'

type State = { rules: LintRules | null; findings: Finding[]; decorations: DecorationSet }

export const LINT = new PluginKey<State>('emditor-lint')

function compute(doc: Node, rules: LintRules | null): State {
  if (!rules) return { rules, findings: [], decorations: DecorationSet.empty }
  const map = docText(doc)
  const findings = lint(map.text, map.blocks, rules)
  const decorations = findings.map((f, i) =>
    Decoration.inline(map.toPos(f.from, 'start'), map.toPos(f.to, 'end'), { class: `lint-mark lint-${f.rule}`, 'data-lint': String(i) }),
  )
  return { rules, findings, decorations: DecorationSet.create(doc, decorations) }
}

/** Sets the rules to check with; null turns the lint off. */
export function setLintRules(tr: Transaction, rules: LintRules | null) {
  return tr.setMeta(LINT, { rules }).setMeta('addToHistory', false)
}

export function lintPlugin() {
  return new Plugin<State>({
    key: LINT,
    state: {
      init: (_, state) => compute(state.doc, null),
      apply: (tr, value, _old, state) => {
        const meta = tr.getMeta(LINT) as { rules: LintRules | null } | undefined
        if (!meta && !tr.docChanged) return value
        return compute(state.doc, meta ? meta.rules : value.rules)
      },
    },
    props: { decorations: (state) => LINT.getState(state)?.decorations },
  })
}
