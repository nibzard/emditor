// ABOUTME: Markdown source editor built on CodeMirror 6.
// ABOUTME: It shows the plain text with quiet syntax colours and no line numbers.

import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
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

type Props = {
  initial: string
  onChange: (markdown: string) => void
  onReady?: () => void
}

export function SourceEditor({ initial, onChange, onReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
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
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    onReadyRef.current?.()
    return () => view.destroy()
  }, [initial])

  return <div ref={rootRef} className="editor editor-source" />
}
