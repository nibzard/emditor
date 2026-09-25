// ABOUTME: Finds the lines of GFM tables in the Markdown source, from the syntax tree.
// ABOUTME: The source editor keeps these lines unwrapped, so that the table columns stay readable.

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/** Line numbers (from 1) of table lines that touch the range from `from` to `to`, in order. */
export function tableLines(state: EditorState, from: number, to: number): number[] {
  const lines = new Set<number>()
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'Table') return
      const first = state.doc.lineAt(Math.max(node.from, from)).number
      const last = state.doc.lineAt(Math.min(node.to, to)).number
      for (let line = first; line <= last; line++) lines.add(line)
      return false
    },
  })
  return [...lines].sort((a, b) => a - b)
}
