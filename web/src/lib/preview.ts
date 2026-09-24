// ABOUTME: Renders the start of a Markdown document to HTML for desk thumbnails.
// ABOUTME: Raw HTML in the source shows as text, so thumbnails never run document markup.

import { Marked } from 'marked'
import { resolveAsset } from './text'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

let currentDoc = ''

const marked = new Marked({ gfm: true, async: false })
marked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    image({ href, text }) {
      return `<img src="${escapeHtml(resolveAsset(currentDoc, href))}" alt="${escapeHtml(text)}" loading="lazy">`
    },
  },
})

export function renderPreview(markdown: string, docPath: string): string {
  currentDoc = docPath
  return marked.parse(markdown) as string
}
