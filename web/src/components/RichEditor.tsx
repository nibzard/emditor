// ABOUTME: Rich (WYSIWYG) editor built on Milkdown with only the CommonMark and GFM schema.
// ABOUTME: It can show only what Markdown can store, and gives Markdown text back on each change.

// Marks a transaction that brings in text from another pane, so that it is not sent back as an edit.
const EXTERNAL = new PluginKey<boolean>('emditor-external')
const externalPlugin = $prose(() => new Plugin({
  key: EXTERNAL,
  state: {
    init: () => false,
    apply: (tr, last) => (tr.docChanged ? Boolean(tr.getMeta(EXTERNAL)) : last),
  },
}))

import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { commandsCtx, defaultValueCtx, Editor, editorViewCtx, parserCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark, imageSchema, toggleEmphasisCommand, toggleLinkCommand, toggleStrongCommand, turnIntoTextCommand, wrapInBulletListCommand, wrapInHeadingCommand } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose, $view } from '@milkdown/kit/utils'
import { resolveAsset } from '../lib/text'
import { BoldIcon, BulletsIcon, Heading1Icon, Heading2Icon, ItalicIcon, LinkIcon, ParagraphIcon } from './icons'

type Props = {
  docPath: string
  initial: string
  /** The current text of the document; it changes when another pane edits the same document. */
  content: string
  onChange: (markdown: string) => void
  onReady?: () => void
}

export function RichEditor({ docPath, initial, content, onChange, onReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const linkId = useId()
  const editorRef = useRef<Editor | null>(null)
  const [selected, setSelected] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  // The last text that this editor sent or received, to tell edits in another pane from its own.
  const seen = useRef(initial)
  const contentRef = useRef(content)
  contentRef.current = content
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onReadyRef.current = onReady

  useEffect(() => {
    // Each editor gets its own host element, so a late destroy never touches a newer editor.
    const host = document.createElement('div')
    host.className = 'md-body'
    rootRef.current!.appendChild(host)
    let editor: Editor | null = null
    let disposed = false
    const updateSelection = () => {
      const selection = window.getSelection()
      setSelected(Boolean(selection && !selection.isCollapsed && selection.anchorNode && host.contains(selection.anchorNode)))
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
      .create()
      .then((created) => {
        if (disposed) {
          void created.destroy()
          return
        }
        editor = created
        editorRef.current = created
        applyExternal(created, contentRef.current, seen)
        updateSelection()
        onReadyRef.current?.()
      })
      .catch((err) => console.error('emditor: rich editor failed to start', err))

    return () => {
      disposed = true
      host.removeEventListener('mousedown', toggleTask)
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

  const command = (key: typeof toggleStrongCommand.key | typeof toggleEmphasisCommand.key | typeof turnIntoTextCommand.key | typeof wrapInBulletListCommand.key | typeof wrapInHeadingCommand.key, level?: number) => {
    editorRef.current?.action((ctx) => ctx.get(commandsCtx).call(key, level))
    editorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus())
  }

  return <div className="rich-editor-wrap">
    <div className="format-toolbar" aria-label="Formatting controls">
      <FormatButton label="Paragraph" onClick={() => command(turnIntoTextCommand.key)}><ParagraphIcon /></FormatButton>
      <FormatButton label="Heading 1" onClick={() => command(wrapInHeadingCommand.key, 1)}><Heading1Icon /></FormatButton>
      <FormatButton label="Heading 2" onClick={() => command(wrapInHeadingCommand.key, 2)}><Heading2Icon /></FormatButton>
      <FormatButton label="Bulleted list" onClick={() => command(wrapInBulletListCommand.key)}><BulletsIcon /></FormatButton>
      {selected && <span className="selection-format-actions">
        <FormatButton label="Bold selected text" onClick={() => command(toggleStrongCommand.key)}><BoldIcon /></FormatButton>
        <FormatButton label="Italicize selected text" onClick={() => command(toggleEmphasisCommand.key)}><ItalicIcon /></FormatButton>
        <FormatButton label="Link" onClick={() => { setLinkOpen(true); setLinkUrl('') }}><LinkIcon /></FormatButton>
      </span>}
      {linkOpen && <span className="link-input-group"><label className="visually-hidden" htmlFor={linkId}>Link URL</label>
        <input id={linkId} autoFocus type="url" placeholder="https://…" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setLinkOpen(false) }} />
        <button type="button" disabled={!linkUrl.trim()} onClick={() => {
          editorRef.current?.action((ctx) => ctx.get(commandsCtx).call(toggleLinkCommand.key, { href: linkUrl.trim() }))
          editorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus())
          setLinkOpen(false)
        }}>Apply link</button>
        <button type="button" onClick={() => setLinkOpen(false)}>Cancel</button></span>}
    </div>
    <div ref={rootRef} className="editor editor-rich" />
  </div>
}

function FormatButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  // Keep the text selection: a mouse press on the button must not move focus out of the editor.
  return <button type="button" className="format-btn" data-tip={label} aria-label={label}
    onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>
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
