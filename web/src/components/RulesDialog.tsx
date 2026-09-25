// ABOUTME: The writing rules of the folder: phrases to avoid, repeated words, long sentences, and kept occurrences.
// ABOUTME: Changes apply when the dialog closes or when a rule is turned on or off; they save to .emditor/rules.json.

import { useState } from 'react'
import { useRules } from '../hooks/useDocument'
import { type LintRules, RULE_NAMES } from '../lib/lint'
import { Dialog } from './Dialog'

type Props = { onClose: () => void }

export function RulesDialog({ onClose }: Props) {
  const { rules, loaded, status, change, retry } = useRules()
  const [phrases, setPhrases] = useState(() => rules.phrases.list.join('\n'))
  const [maxWords, setMaxWords] = useState(() => String(rules.sentenceLength.maxWords))

  const set = (fn: (r: LintRules) => LintRules) => void change(fn)
  const commitPhrases = () => {
    const list = phrases.split('\n').map((p) => p.trim()).filter(Boolean)
    if (list.join('\n') !== rules.phrases.list.join('\n')) set((r) => ({ ...r, phrases: { ...r.phrases, list } }))
  }
  const commitMaxWords = () => {
    const value = Number.parseInt(maxWords, 10)
    if (Number.isInteger(value) && value > 0 && value !== rules.sentenceLength.maxWords) {
      set((r) => ({ ...r, sentenceLength: { ...r.sentenceLength, maxWords: value } }))
    } else setMaxWords(String(rules.sentenceLength.maxWords))
  }
  const close = () => {
    commitPhrases()
    commitMaxWords()
    onClose()
  }

  return (
    <Dialog title="Writing rules" onClose={close} className="sheet-panel rules-panel">
      {(dismiss) => <>
        <header className="rules-head">
          <h2>Writing rules</h2>
          <span className="rules-status">
            {!loaded ? 'Loading…' : status === 'error' ? <>Not saved <button type="button" className="text-btn" onClick={() => void retry()}>Retry</button></> : 'For every document in this folder'}
          </span>
        </header>

        <section className="rule">
          <label className="rule-toggle">
            <input type="checkbox" checked={rules.phrases.enabled}
              onChange={(e) => { const enabled = e.target.checked; set((r) => ({ ...r, phrases: { ...r.phrases, enabled } })) }} />
            {RULE_NAMES.phrases}
          </label>
          <textarea className="rule-phrases" aria-label="Phrases to avoid, one on each line" rows={6} value={phrases}
            onChange={(e) => setPhrases(e.target.value)} onBlur={commitPhrases} />
          <label className="rule-option">
            <input type="checkbox" checked={rules.phrases.caseSensitive}
              onChange={(e) => { const caseSensitive = e.target.checked; set((r) => ({ ...r, phrases: { ...r.phrases, caseSensitive } })) }} />
            Match upper and lower case
          </label>
        </section>

        <section className="rule">
          <label className="rule-toggle">
            <input type="checkbox" checked={rules.repeatedWord.enabled}
              onChange={(e) => { const enabled = e.target.checked; set((r) => ({ ...r, repeatedWord: { enabled } })) }} />
            {RULE_NAMES.repeatedWord}
          </label>
          <p className="rule-help">The same word two times in a row, as in “the the”.</p>

          <label className="rule-toggle">
            <input type="checkbox" checked={rules.sentenceLength.enabled}
              onChange={(e) => { const enabled = e.target.checked; set((r) => ({ ...r, sentenceLength: { ...r.sentenceLength, enabled } })) }} />
            {RULE_NAMES.sentenceLength}
          </label>
          <label className="rule-option">
            More than
            <input type="number" min={1} className="rule-number" value={maxWords}
              onChange={(e) => setMaxWords(e.target.value)} onBlur={commitMaxWords} />
            words
          </label>
        </section>

        <section className="rule rule-kept">
          <h2>Kept occurrences</h2>
          {rules.kept.length === 0 ? (
            <p className="rule-help">None. Use “Keep this” on a mark to stop it in that sentence.</p>
          ) : (
            <ul>
              {rules.kept.map((k) => (
                <li key={JSON.stringify(k)}>
                  <span><strong>{k.match}</strong> · {RULE_NAMES[k.rule]}<br /><em>{k.sentence}</em></span>
                  <button type="button" className="text-btn"
                    onClick={() => set((r) => ({ ...r, kept: r.kept.filter((x) => JSON.stringify(x) !== JSON.stringify(k)) }))}>Undo</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="text-btn rules-done" onClick={dismiss}>Done</button>
        </section>
      </>}
    </Dialog>
  )
}
