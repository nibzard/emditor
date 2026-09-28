// ABOUTME: The semantic rules part of the rules dialog: turn each rule on or off, set its sensitivity, and edit or add rules.
// ABOUTME: A definition changes only when the writer saves it, because each change makes a new version that Jev checks again.

import { useState } from 'react'
import type { LintRules } from '../lib/lint'
import { DEFAULT_THRESHOLD, SCOPES, SENSITIVITIES, type SemanticRule } from '../lib/semantic'

type Props = {
  rules: LintRules
  set: (fn: (r: LintRules) => LintRules) => void
  /** The Jev model, or null when semantic rules are off. */
  jevModel: string | null
}

const replace = (list: SemanticRule[], next: SemanticRule) => list.map((r) => (r.id === next.id ? next : r))

export function SemanticRules({ rules, set, jevModel }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const update = (id: string, patch: Partial<SemanticRule>) =>
    set((r) => ({ ...r, semantic: r.semantic.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  const add = () => {
    const rule: SemanticRule = {
      id: crypto.randomUUID().slice(0, 8), enabled: false, sensitivity: 'normal', name: 'New rule', scope: 'sentence',
      question: '', flagWhen: '', allowWhen: '', boundaryCases: '', examples: [], explanation: '', threshold: DEFAULT_THRESHOLD,
    }
    set((r) => ({ ...r, semantic: [...r.semantic, rule] }))
    setEditing(rule.id)
  }

  return (
    <section className="rule rule-semantic">
      <h2>Semantic rules</h2>
      <p className="rule-help rule-help-flush">
        {jevModel
          ? `Checked by Jev (${jevModel}) in formatted text. A check sends the text of the rule's scope to TypeSafe, so each rule starts off.`
          : 'Off. Start emditor with TYPESAFE_API_KEY to check these rules with Jev.'}
      </p>
      <ul className="semantic-list">
        {rules.semantic.map((rule) => (
          <li key={rule.id}>
            <div className="semantic-row">
              <label className="rule-toggle">
                <input type="checkbox" checked={rule.enabled} disabled={!jevModel || !rule.question.trim()}
                  onChange={(e) => update(rule.id, { enabled: e.target.checked })} />
                {rule.name}
              </label>
              <span className="semantic-scope">{rule.scope}</span>
              <select aria-label={`Sensitivity of ${rule.name}`} value={rule.sensitivity}
                onChange={(e) => update(rule.id, { sensitivity: e.target.value as SemanticRule['sensitivity'] })}>
                {SENSITIVITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" className="text-btn" onClick={() => setEditing(editing === rule.id ? null : rule.id)}>
                {editing === rule.id ? 'Close' : 'Edit'}
              </button>
            </div>
            {editing === rule.id && (
              <RuleEditor rule={rule} onCancel={() => setEditing(null)}
                onSave={(next) => { set((r) => ({ ...r, semantic: replace(r.semantic, next) })); setEditing(null) }}
                onDelete={() => { set((r) => ({ ...r, semantic: r.semantic.filter((x) => x.id !== rule.id) })); setEditing(null) }} />
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="text-btn rules-add" onClick={add}>Add a rule</button>
    </section>
  )
}

type EditorProps = { rule: SemanticRule; onSave: (rule: SemanticRule) => void; onCancel: () => void; onDelete: () => void }

function RuleEditor({ rule, onSave, onCancel, onDelete }: EditorProps) {
  const [draft, setDraft] = useState(rule)
  const field = (key: 'name' | 'question' | 'flagWhen' | 'allowWhen' | 'boundaryCases' | 'explanation', label: string, rows = 2) => (
    <label className="semantic-field">
      <span>{label}</span>
      {rows === 1
        ? <input value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        : <textarea rows={rows} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
    </label>
  )
  const valid = draft.name.trim() && draft.question.trim()

  return (
    <div className="semantic-editor">
      {field('name', 'Name', 1)}
      <label className="semantic-field">
        <span>Scope</span>
        <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as SemanticRule['scope'] })}>
          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {field('question', 'Question (yes means flag)')}
      {field('flagWhen', 'Flag when')}
      {field('allowWhen', 'Allow when')}
      {field('boundaryCases', 'Boundary cases')}
      {field('explanation', 'Card text')}
      <label className="semantic-field">
        <span>Threshold</span>
        <input type="number" min={0.5} max={0.99} step={0.01} value={draft.threshold}
          onChange={(e) => setDraft({ ...draft, threshold: Math.min(0.99, Math.max(0.5, Number(e.target.value) || DEFAULT_THRESHOLD)) })} />
      </label>
      <div className="semantic-field">
        <span>Examples</span>
        {draft.examples.length === 0 ? <p className="rule-help rule-help-flush">None. Use “Allow writing like this” on a mark to add one.</p> : (
          <ul className="semantic-examples">
            {draft.examples.map((example, i) => (
              <li key={i}>
                <span className="semantic-flag">{example.flag ? 'Flag' : 'Allow'}</span>
                <span className="semantic-example">{example.text}</span>
                <button type="button" className="text-btn" onClick={() => setDraft({ ...draft, examples: draft.examples.filter((_, k) => k !== i) })}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="semantic-actions">
        <button type="button" className="text-btn" onClick={onDelete}>Delete rule</button>
        <span className="spacer" />
        <button type="button" className="text-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="text-btn rules-done" disabled={!valid} onClick={() => onSave(draft)}>Save</button>
      </footer>
    </div>
  )
}
