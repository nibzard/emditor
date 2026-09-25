// ABOUTME: Markdown source editor built on CodeMirror 6.
// ABOUTME: It shows the plain text with quiet syntax colours and no line numbers.

import { useEffect, useRef } from 'react'
import { cursorLineEnd, cursorLineStart, defaultKeymap, history, historyKeymap, indentWithTab, selectLineEnd, selectLineStart } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { Annotation, EditorState, RangeSetBuilder, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, drawSelection, EditorView, type KeyBinding, keymap, placeholder, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { tableLines } from '../lib/sourceTables'

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '650', fontSize: '1.2em' },
  { tag: t.heading2, fontWeight: '650', fontSize: '1.1em' },
  { tag: t.heading, fontWeight: '650' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent-ink)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, color: 'var(--code-ink)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--faint-ink)' },
])

const theme = EditorView.theme({
  '&': { background: 'transparent', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7', overflowX: 'auto', overflowY: 'hidden' },
  '.cm-line.cm-table-line': { whiteSpace: 'pre' },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)', flex: '1 1 0', minWidth: '0' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '1.5px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    background: 'var(--selection) !important',
  },
  '.cm-placeholder': { color: 'var(--faint-ink)' },
})

// Marks a change that brings in text from another pane, so that it is not sent back as an edit.
const external = Annotation.define<boolean>()
const tableLine = Decoration.line({ class: 'cm-table-line' })

function tableDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    for (const line of tableLines(view.state, from, to)) {
      const start = view.state.doc.line(line).from
      builder.add(start, start, tableLine)
    }
  }
  return builder.finish()
}

const tableLinePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = tableDecorations(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = tableDecorations(update.view)
    }
  }
}, { decorations: (plugin) => plugin.decorations })

const whenOnTableLine = (command: (view: EditorView) => boolean) => (view: EditorView) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return tableLines(view.state, line.from, line.to).length > 0 && command(view)
}

const tableLineKeymap: KeyBinding[] = [
  { key: 'Home', run: whenOnTableLine(cursorLineStart), shift: whenOnTableLine(selectLineStart) },
  { key: 'End', run: whenOnTableLine(cursorLineEnd), shift: whenOnTableLine(selectLineEnd) },
  { mac: 'Cmd-ArrowLeft', run: whenOnTableLine(cursorLineStart), shift: whenOnTableLine(selectLineStart) },
  { mac: 'Cmd-ArrowRight', run: whenOnTableLine(cursorLineEnd), shift: whenOnTableLine(selectLineEnd) },
]

const pageMarginScroll = EditorView.scrollMargins.of((view) => {
  const style = getComputedStyle(view.scrollDOM)
  return { left: parseFloat(style.paddingLeft) || 0, right: parseFloat(style.paddingRight) || 0 }
})

type Props = {
  initial: string
  /** The current text of the document; it changes when another pane edits the same document. */
  content: string
  onChange: (markdown: string) => void
  onReady?: () => void
  revealLine?: number
  revealId?: number
}

export function SourceEditor({ initial, content, onChange, onReady, revealLine, revealId }: Props) {
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
          keymap.of([...tableLineKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          tableLinePlugin,
          pageMarginScroll,
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

  useEffect(() => {
    const view = viewRef.current
    if (!view || !revealLine) return
    const line = view.state.doc.line(Math.min(Math.max(1, revealLine), view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
  }, [revealLine, revealId, initial])

  return <div ref={rootRef} className="editor editor-source" />
}
