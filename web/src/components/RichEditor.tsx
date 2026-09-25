// ABOUTME: Rich (WYSIWYG) editor built on Milkdown with only the CommonMark and GFM schema.
// ABOUTME: It can show only what Markdown can store, gives Markdown text back on each change, and marks notes.

// Marks a transaction that brings in text from another pane, so that it is not sent back as an edit.
const EXTERNAL = new PluginKey<boolean>('emditor-external')
const externalPlugin = $prose(() => new Plugin({
  key: EXTERNAL,
  state: {
    init: () => false,
    apply: (tr, last) => (tr.docChanged ? Boolean(tr.getMeta(EXTERNAL)) : last),
  },
}))

import { type MutableRefObject, useEffect, useRef } from 'react'
import { commandsCtx, defaultValueCtx, Editor, editorViewCtx, parserCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark, imageSchema, toggleEmphasisCommand, toggleLinkCommand, toggleStrongCommand, turnIntoTextCommand, wrapInBulletListCommand, wrapInHeadingCommand } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { HIGHLIGHT_COLORS, type HighlightColor, type Note, type NoteKind, type TextQuote } from '../lib/annotations'
import { resolveAsset } from '../lib/text'
import { acceptCuts, type AnchorReport, notesPlugin, selectionQuote, setNotes } from './notesPlugin'

/** What a new annotation on the selection is: a note, a highlight with a color, or a cut. */
export type Mark = { kind: NoteKind; color?: HighlightColor }

/** A formatting command for the selection or the current block. */
export type Format = 'paragraph' | 'heading1' | 'heading2' | 'bullets' | 'bold' | 'italic'

/** Lets the pane use the editor: formatting, annotations, the selection, and accepted cuts. */
export type RichHandle = {
  format: (format: Format) => void
  link: (href: string) => void
  annotate: (mark: Mark) => void
  selectionQuote: () => TextQuote | null
  /** Deletes the text of the cuts in one undo step. Returns false when none of them has text now. */
  acceptCuts: (ids: string[]) => boolean
}

type Props = {
  docPath: string
  initial: string
  /** The current text of the document; it changes when another pane edits the same document. */
  content: string
  onChange: (markdown: string) => void
  onReady?: () => void
  /** The notes to underline. An empty list shows no notes. */
  notes: Note[]
  /** The note whose text shows as active. */
  highlight: string | null
  /** Adds a note, highlight, or cut to the selected text; null when this cannot be done now. */
  onAnnotate: ((quote: TextQuote, mark: Mark) => void) | null
  onAnchors: (report: AnchorReport) => void
  /** Called with the note under a click in the text, or null for a click on other text. */
  onActivateNote: (id: string | null) => void
  handleRef?: MutableRefObject<RichHandle | null>
  /** Called when text becomes selected or the selection goes away. */
  onSelection?: (selected: boolean) => void
}

export function RichEditor({ docPath, initial, content, onChange, onReady, notes, highlight, onAnnotate, onAnchors, onActivateNote, handleRef, onSelection }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const onSelectionRef = useRef(onSelection)
  onSelectionRef.current = onSelection
  // The last selected text. The link field takes the focus, and then the editor has no selection.
  const lastRange = useRef<{ from: number; to: number } | null>(null)
  // The last text that this editor sent or received, to tell edits in another pane from its own.
  const seen = useRef(initial)
  const contentRef = useRef(content)
  contentRef.current = content
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onReadyRef.current = onReady
  const notesRef = useRef({ notes, highlight })
  notesRef.current = { notes, highlight }
  const onAnnotateRef = useRef(onAnnotate)
  const onAnchorsRef = useRef(onAnchors)
  const onActivateNoteRef = useRef(onActivateNote)
  onAnnotateRef.current = onAnnotate
  onAnchorsRef.current = onAnchors
  onActivateNoteRef.current = onActivateNote

  const readSelection = (): TextQuote | null => {
    let quote: TextQuote | null = null
    editorRef.current?.action((ctx) => {
      const { doc, selection } = ctx.get(editorViewCtx).state
      quote = selectionQuote(doc, selection.from, selection.to)
    })
    return quote
  }
  const annotate = (mark: Mark) => {
    const quote = readSelection()
    if (quote && onAnnotateRef.current) onAnnotateRef.current(quote, mark)
  }
  const readSelectionRef = useRef(readSelection)
  const annotateRef = useRef(annotate)
  readSelectionRef.current = readSelection
  annotateRef.current = annotate

  useEffect(() => {
    if (!handleRef) return
    const run = (fn: (view: EditorView) => void) => editorRef.current?.action((ctx) => fn(ctx.get(editorViewCtx)))
    handleRef.current = {
      format: (format) => {
        editorRef.current?.action((ctx) => {
          const commands = ctx.get(commandsCtx)
          switch (format) {
            case 'paragraph': return commands.call(turnIntoTextCommand.key)
            case 'heading1': return commands.call(wrapInHeadingCommand.key, 1)
            case 'heading2': return commands.call(wrapInHeadingCommand.key, 2)
            case 'bullets': return commands.call(wrapInBulletListCommand.key)
            case 'bold': return commands.call(toggleStrongCommand.key)
            case 'italic': return commands.call(toggleEmphasisCommand.key)
          }
        })
        run((view) => view.focus())
      },
      link: (href) => {
        run((view) => {
          const range = lastRange.current
          if (view.state.selection.empty && range && range.to <= view.state.doc.content.size) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)))
          }
        })
        editorRef.current?.action((ctx) => ctx.get(commandsCtx).call(toggleLinkCommand.key, { href }))
        run((view) => view.focus())
      },
      annotate: (mark) => annotateRef.current(mark),
      selectionQuote: () => readSelectionRef.current(),
      acceptCuts: (ids) => {
        let done = false
        editorRef.current?.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const tr = acceptCuts(view.state, ids)
          if (tr) {
            view.dispatch(tr)
            // Back to the text, so that ⌘Z can undo the cut at once.
            view.focus()
            done = true
          }
        })
        return done
      },
    }
    return () => { handleRef.current = null }
  }, [handleRef])

  useEffect(() => {
    // Each editor gets its own host element, so a late destroy never touches a newer editor.
    const host = document.createElement('div')
    host.className = 'md-body'
    rootRef.current!.appendChild(host)
    let editor: Editor | null = null
    let disposed = false
    const updateSelection = () => {
      const selection = window.getSelection()
      const inside = Boolean(selection && !selection.isCollapsed && selection.anchorNode && host.contains(selection.anchorNode))
      if (inside && editor) {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          try {
            const a = view.posAtDOM(selection!.anchorNode!, selection!.anchorOffset)
            const b = view.posAtDOM(selection!.focusNode!, selection!.focusOffset)
            lastRange.current = { from: Math.min(a, b), to: Math.max(a, b) }
          } catch {
            // The selection is in a place that has no document position.
          }
        })
      }
      onSelectionRef.current?.(inside)
    }
    host.addEventListener('mouseup', updateSelection)
    host.addEventListener('keyup', updateSelection)
    document.addEventListener('selectionchange', updateSelection)

    const imageView = $view(imageSchema.node, () => (node: Node) => {
      const img = document.createElement('img')
      const apply = (n: Node) => {
        img.src = resolveAsset(docPath, n.attrs.src)
        img.alt = n.attrs.alt ?? ''
        img.title = n.attrs.title ?? ''
      }
      apply(node)
      return {
        dom: img,
        update: (n: Node) => {
          if (n.type !== node.type) return false
          apply(n)
          return true
        },
      }
    })

    const toggleTask = (e: MouseEvent) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-item-type="task"]')
      if (!li || !editor || e.target !== li) return
      const box = li.getBoundingClientRect()
      if (e.clientX > box.left + parseFloat(getComputedStyle(li).paddingLeft)) return
      e.preventDefault()
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const $pos = view.state.doc.resolve(view.posAtDOM(li, 0))
        for (let depth = $pos.depth; depth > 0; depth--) {
          const node = $pos.node(depth)
          if (node.type.name === 'list_item') {
            view.dispatch(view.state.tr.setNodeMarkup($pos.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked }))
            return
          }
        }
      })
    }
    host.addEventListener('mousedown', toggleTask)

    const onNoteClick = (e: MouseEvent) => {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      const anchor = (e.target as HTMLElement).closest<HTMLElement>('[data-note-id]')
      onActivateNoteRef.current(anchor?.dataset.noteId ?? null)
    }
    host.addEventListener('click', onNoteClick)
    // ⌥⌘M adds a note, ⌥⌘1–4 highlight, and ⌥⌘⌫ marks a cut. KeyboardEvent.code, because ⌥ changes the key on macOS.
    const onNoteKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.altKey || e.ctrlKey) return
      const digit = /^Digit([1-4])$/.exec(e.code)
      const mark: Mark | null = e.code === 'KeyM' ? { kind: 'comment' }
        : e.code === 'Backspace' ? { kind: 'cut' }
          : digit ? { kind: 'highlight', color: HIGHLIGHT_COLORS[Number(digit[1]) - 1] } : null
      if (!mark) return
      e.preventDefault()
      e.stopPropagation()
      annotateRef.current(mark)
    }
    host.addEventListener('keydown', onNoteKey, true)
    const annotations = $prose(() => notesPlugin((report) => onAnchorsRef.current(report)))

    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host)
        ctx.set(defaultValueCtx, initial)
        // Write Markdown in the most common style, so edits do not rewrite every list and rule.
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: '-' as const, rule: '-' as const }))
        ctx.get(listenerCtx).markdownUpdated((listenerContext, markdown, prev) => {
          if (markdown === prev || EXTERNAL.getState(listenerContext.get(editorViewCtx).state)) return
          seen.current = markdown
          onChangeRef.current(markdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(imageView)
      .use(externalPlugin)
      .use(annotations)
      .create()
      .then((created) => {
        if (disposed) {
          void created.destroy()
          return
        }
        editor = created
        editorRef.current = created
        applyExternal(created, contentRef.current, seen)
        created.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.dispatch(setNotes(view.state.tr, notesRef.current))
        })
        updateSelection()
        onReadyRef.current?.()
      })
      .catch((err) => console.error('emditor: rich editor failed to start', err))

    return () => {
      disposed = true
      host.removeEventListener('mousedown', toggleTask)
      host.removeEventListener('click', onNoteClick)
      host.removeEventListener('keydown', onNoteKey, true)
      host.removeEventListener('mouseup', updateSelection)
      host.removeEventListener('keyup', updateSelection)
      document.removeEventListener('selectionchange', updateSelection)
      editorRef.current = null
      void editor?.destroy()
      host.remove()
    }
  }, [docPath, initial])

  useEffect(() => {
    if (editorRef.current) applyExternal(editorRef.current, content, seen)
  }, [content])

  useEffect(() => {
    editorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(setNotes(withDomSelection(view), { notes, highlight }))
    })
  }, [notes, highlight])

  return <div ref={rootRef} className="editor editor-rich" />
}

/**
 * A transaction that carries the selection that the browser shows now. After a click, ProseMirror reads
 * the new caret a little later; without this, a transaction in that moment puts back the old selection.
 */
function withDomSelection(view: EditorView) {
  const tr = view.state.tr
  const selection = window.getSelection()
  if (!view.hasFocus() || !selection?.anchorNode || !selection.focusNode || !view.dom.contains(selection.anchorNode)) return tr
  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset)
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset)
    return tr.setSelection(TextSelection.create(tr.doc, anchor, head))
  } catch {
    return tr
  }
}

/** Brings in text from another pane. Only the changed part is replaced, so the cursor and the scroll stay. */
function applyExternal(editor: Editor, markdown: string, seen: { current: string }) {
  if (markdown === seen.current) return
  seen.current = markdown
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const next = ctx.get(parserCtx)(markdown)
    if (!next) return
    const old = view.state.doc
    const start = old.content.findDiffStart(next.content)
    if (start === null) return
    let { a: endOld, b: endNext } = old.content.findDiffEnd(next.content)!
    const overlap = start - Math.min(endOld, endNext)
    if (overlap > 0) {
      endOld += overlap
      endNext += overlap
    }
    view.dispatch(view.state.tr.replace(start, endOld, next.slice(start, endNext)).setMeta(EXTERNAL, true).setMeta('addToHistory', false))
  })
}
