// ABOUTME: Rich (WYSIWYG) editor built on Milkdown with only the CommonMark and GFM schema.
// ABOUTME: It can show only what Markdown can store, and gives Markdown text back on each change.

import { useEffect, useRef } from 'react'
import { defaultValueCtx, Editor, editorViewCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark, imageSchema } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import type { Node } from '@milkdown/kit/prose/model'
import { $view } from '@milkdown/kit/utils'
import { resolveAsset } from '../lib/text'

type Props = {
  docPath: string
  initial: string
  onChange: (markdown: string) => void
  onReady?: () => void
}

export function RichEditor({ docPath, initial, onChange, onReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
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
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prev) => {
          if (markdown !== prev) onChangeRef.current(markdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(imageView)
      .create()
      .then((created) => {
        if (disposed) {
          void created.destroy()
          return
        }
        editor = created
        onReadyRef.current?.()
      })
      .catch((err) => console.error('emditor: rich editor failed to start', err))

    return () => {
      disposed = true
      host.removeEventListener('mousedown', toggleTask)
      void editor?.destroy()
      host.remove()
    }
  }, [docPath, initial])

  return <div ref={rootRef} className="editor editor-rich" />
}
