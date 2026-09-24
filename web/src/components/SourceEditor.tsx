// ABOUTME: Markdown source editor built on CodeMirror 6.
// ABOUTME: It shows the plain text with quiet syntax colours and no line numbers.

import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Annotation, EditorState, Transaction } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '650', fontSize: '1.2em' },
  { tag: t.heading2, fontWeight: '650', fontSize: '1.1em' },
  { tag: t.heading, fontWeight: '650' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, color: 'var(--code-ink)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--faint-ink)' },
])

const theme = EditorView.theme({
  '&': { background: 'transparent', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7', overflow: 'visible' },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '1.5px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    background: 'var(--selection) !important',
  },
  '.cm-placeholder': { color: 'var(--faint-ink)' },
})

// Marks a change that brings in text from another pane, so that it is not sent back as an edit.
const external = Annotation.define<boolean>()

type Props = {
  initial: string
  /** The current text of the document; it changes when another pane edits the same document. */
  content: string
  onChange: (markdown: string) => void
  onReady?: () => void
}

export function SourceEditor({ initial, content, onChange, onReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onReadyRef.current = onReady

  useEffect(() => {
    const view = new EditorView({
      parent: rootRef.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          placeholder('Start writing…'),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    onReadyRef.current?.()
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [initial])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const old = view.state.doc.toString()
    if (old === content) return
    // Replace only the changed part, so the cursor and the scroll stay.
    let start = 0
    while (start < old.length && start < content.length && old[start] === content[start]) start++
    let endOld = old.length
    let endNew = content.length
    while (endOld > start && endNew > start && old[endOld - 1] === content[endNew - 1]) {
      endOld--
      endNew--
    }
    view.dispatch({ changes: { from: start, to: endOld, insert: content.slice(start, endNew) }, annotations: [external.of(true), Transaction.addToHistory.of(false)] })
  }, [content])

  return <div ref={rootRef} className="editor editor-source" />
}
