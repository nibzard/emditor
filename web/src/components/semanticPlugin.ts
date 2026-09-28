// ABOUTME: ProseMirror plugin that sends the document to the semantic scheduler and marks the semantic findings.
// ABOUTME: It only adds decorations; findings come in after a pause and move with edits until new ones come.

import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import type { Kept } from '../lib/lint'
import { docText } from '../lib/proseText'
import type { SemanticRule } from '../lib/semantic'
import { type CheckRequest, type CheckResponse, type SemanticFinding, SemanticScheduler, type SemanticStatus } from '../lib/semanticScheduler'

/** The rules to check, the Jev model, and kept occurrences; null turns semantic checks off. */
export type SemanticConfig = { rules: SemanticRule[]; model: string; kept: Kept[] } | null

type State = { config: SemanticConfig; findings: SemanticFinding[]; decorations: DecorationSet }
type Meta = { config: SemanticConfig } | { findings: SemanticFinding[]; forText: string }

export const SEMANTIC = new PluginKey<State>('emditor-semantic')

/** Sets the findings of the scheduler. They apply only when `forText` is the current plain text. */
export function setSemanticFindings(tr: Transaction, findings: SemanticFinding[], forText: string) {
  return tr.setMeta(SEMANTIC, { findings, forText } satisfies Meta).setMeta('addToHistory', false)
}

export function setSemanticConfig(tr: Transaction, config: SemanticConfig) {
  return tr.setMeta(SEMANTIC, { config } satisfies Meta).setMeta('addToHistory', false)
}

/** The plugin state and marks only, without the scheduler. */
export function semanticState(
  view?: (view: EditorView) => { update: (view: EditorView, prev: EditorState) => void; destroy: () => void },
) {
  return new Plugin<State>({
    key: SEMANTIC,
    state: {
      init: () => ({ config: null, findings: [], decorations: DecorationSet.empty }),
      apply: (tr, value, _old, state) => {
        const meta = tr.getMeta(SEMANTIC) as Meta | undefined
        if (meta && 'config' in meta) return { ...value, config: meta.config }
        if (meta && 'findings' in meta) {
          const map = docText(state.doc)
          if (map.text !== meta.forText) return value
          const decorations = meta.findings.flatMap((f, i) =>
            f.ranges
              .filter((r) => r.to > r.from)
              .map((r) =>
                Decoration.inline(map.toPos(r.from, 'start'), map.toPos(r.to, 'end'), {
                  class: `lint-mark lint-semantic lint-scope-${f.scope}`,
                  'data-semantic': String(i),
                }),
              ),
          )
          return { ...value, findings: meta.findings, decorations: DecorationSet.create(state.doc, decorations) }
        }
        return tr.docChanged ? { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) } : value
      },
    },
    props: { decorations: (state) => SEMANTIC.getState(state)?.decorations },
    view,
  })
}

type Deps = {
  check: (req: CheckRequest, signal: AbortSignal) => Promise<CheckResponse>
  onStatus: (status: SemanticStatus) => void
  /** A transaction that keeps the selection that the browser shows now. */
  transaction: (view: EditorView) => Transaction
}

const sameFindings = (a: SemanticFinding[], b: SemanticFinding[]) =>
  a.length === b.length && a.every((f, i) => f.key === b[i].key && JSON.stringify(f.ranges) === JSON.stringify(b[i].ranges))

/** The plugin with its scheduler: each change of the document or of the config goes to the scheduler. */
export function semanticPlugin(deps: Deps) {
  return semanticState((view) => {
    let destroyed = false
    let lastConfig: SemanticConfig = null
    let text = ''
    const scheduler = new SemanticScheduler({
      check: deps.check,
      isComposing: () => view.composing,
      onUpdate: () => {
        deps.onStatus(scheduler.status)
        const findings = scheduler.findings()
        const forText = text
        // The scheduler can report during a view update, where a dispatch is not allowed.
        queueMicrotask(() => {
          if (destroyed || sameFindings(findings, SEMANTIC.getState(view.state)?.findings ?? [])) return
          view.dispatch(setSemanticFindings(deps.transaction(view), findings, forText))
        })
      },
    })
    const sync = (v: EditorView, docChanged: boolean) => {
      const config = SEMANTIC.getState(v.state)?.config ?? null
      if (config !== lastConfig) {
        lastConfig = config
        scheduler.setConfig(config?.rules ?? null, config?.model ?? null, config?.kept ?? [])
      }
      if (docChanged) {
        const map = docText(v.state.doc)
        text = map.text
        scheduler.update(map.text, map.blocks)
      }
    }
    sync(view, true)
    return {
      update: (v, prev) => sync(v, v.state.doc !== prev.doc),
      destroy: () => {
        destroyed = true
        scheduler.dispose()
      },
    }
  })
}
