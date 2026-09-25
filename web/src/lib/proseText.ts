// ABOUTME: The plain text of a ProseMirror document, with a map between text offsets and document positions.
// ABOUTME: Annotations anchor on this text, so marks and Markdown syntax do not change their quotes.

import type { Node } from '@milkdown/kit/prose/model'

/** A run of text that maps one to one onto document positions. */
type Segment = { offset: number; pos: number; length: number }

export interface DocText {
  text: string
  /** The document position of a text offset. At a boundary, 'start' takes the later run and 'end' the earlier. */
  toPos: (offset: number, side: 'start' | 'end') => number
  /** The text offset of a document position. A position between blocks goes to the start of the next text. */
  toOffset: (pos: number) => number
}

/** Builds the text: text blocks are joined with a new line, and a hard break is a new line. */
export function docText(doc: Node): DocText {
  let text = ''
  const segments: Segment[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (segments.length > 0) text += '\n'
    // An empty run at the start of each block, so that every block has a place in the map.
    segments.push({ offset: text.length, pos: pos + 1, length: 0 })
    node.forEach((child, childOffset) => {
      const at = pos + 1 + childOffset
      if (child.isText) {
        segments.push({ offset: text.length, pos: at, length: child.text!.length })
        text += child.text
      } else if (/break/i.test(child.type.name)) {
        segments.push({ offset: text.length, pos: at, length: 1 })
        text += '\n'
      }
    })
    return false
  })

  const toPos = (offset: number, side: 'start' | 'end') => {
    let found: Segment | undefined
    for (const segment of segments) {
      if (segment.offset > offset) break
      if (offset <= segment.offset + segment.length) {
        found = segment
        if (side === 'end') break
      }
    }
    if (!found) return segments.length ? segments[segments.length - 1].pos + segments[segments.length - 1].length : 0
    return found.pos + (offset - found.offset)
  }

  const toOffset = (pos: number) => {
    for (const segment of segments) {
      if (segment.pos > pos) return segment.offset
      if (pos <= segment.pos + segment.length) return segment.offset + (pos - segment.pos)
    }
    return text.length
  }

  return { text, toPos, toOffset }
}
