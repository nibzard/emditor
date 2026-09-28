// ABOUTME: Renders the start of a Markdown document to HTML for desk thumbnails.
// ABOUTME: Raw HTML in the source shows as text, so thumbnails never run document markup.

import { Marked } from 'marked'
import { resolveAsset } from './text'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** A parser whose image renderer resolves links against this document. */
function parserFor(docPath: string) {
  const marked = new Marked({ gfm: true, async: false })
  marked.use({
    renderer: {
      html({ text }) {
        return escapeHtml(text)
      },
      image({ href, text }) {
        return `<img src="${escapeHtml(resolveAsset(docPath, href))}" alt="${escapeHtml(text)}" loading="lazy">`
      },
    },
  })
  return marked
}

export function renderPreview(markdown: string, docPath: string): string {
  return parserFor(docPath).parse(markdown) as string
}
