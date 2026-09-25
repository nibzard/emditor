// ABOUTME: Keeps a visible document block in place when its layout or editor changes.
// ABOUTME: Matching a short text fingerprint lets rich text and Markdown source share an anchor.

export type ViewAnchor = {
  element: HTMLElement
  top: number
  fingerprint: string
  progress: number
}

const BLOCKS = '.ProseMirror > *, .cm-line'

function editorRoot(scroller: HTMLElement, editorKey: string): HTMLElement | null {
  return Array.from(scroller.querySelectorAll<HTMLElement>('[data-editor-key]'))
    .find((element) => element.dataset.editorKey === editorKey) ?? null
}

export function anchorFingerprint(text: string): string {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 6).join(' ').toLocaleLowerCase()
}

export function sameAnchorText(candidate: string, anchor: string): boolean {
  return candidate === anchor || candidate.startsWith(`${anchor} `) ||
    (candidate.length >= 8 && anchor.startsWith(`${candidate} `))
}

export function captureViewAnchor(scroller: HTMLElement, editorKey: string): ViewAnchor | null {
  const bounds = scroller.getBoundingClientRect()
  const line = bounds.top + Math.min(96, bounds.height * 0.2)
  const blocks = editorRoot(scroller, editorKey)?.querySelectorAll<HTMLElement>(BLOCKS) ?? []
  let chosen: HTMLElement | null = null
  for (const block of blocks) {
    const rect = block.getBoundingClientRect()
    if (rect.bottom < line || rect.top > bounds.bottom) continue
    if (!anchorFingerprint(block.textContent ?? '')) continue
    chosen = block
    break
  }
  if (!chosen) return null
  return {
    element: chosen,
    top: chosen.getBoundingClientRect().top - bounds.top,
    fingerprint: anchorFingerprint(chosen.textContent ?? ''),
    progress: scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight),
  }
}

export function findViewAnchor(scroller: HTMLElement, anchor: ViewAnchor, editorKey: string): HTMLElement | null {
  const root = editorRoot(scroller, editorKey)
  if (!root) return null
  if (anchor.element.isConnected && root.contains(anchor.element)) return anchor.element
  if (anchor.fingerprint.length < 8) return null
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS))
  const matches = blocks.filter((block) => {
    const text = anchorFingerprint(block.textContent ?? '')
    return sameAnchorText(text, anchor.fingerprint)
  })
  if (!matches.length) return null
  const expected = anchor.progress * Math.max(1, scroller.scrollHeight - scroller.clientHeight)
  const position = (block: HTMLElement) => block.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  return matches.reduce((best, block) =>
    Math.abs(position(block) - expected) < Math.abs(position(best) - expected) ? block : best)
}

export function anchorScrollTop(scroller: HTMLElement, anchor: ViewAnchor, editorKey: string): number | null {
  const block = findViewAnchor(scroller, anchor, editorKey)
  if (!block) return null
  return scroller.scrollTop + block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.top
}
