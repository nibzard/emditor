// ABOUTME: Small text and path helpers for Markdown documents.
// ABOUTME: Titles from file paths, word counts, new-file names, and asset URLs.

const MD_EXT = /\.(md|markdown)$/i

export function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(MD_EXT, '')
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function wordCount(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~[\]|-]/g, ' ')
  return plain.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** Makes a safe relative file name from what the user typed. Returns '' when nothing is left. */
export function normalizeNewPath(input: string): string {
  const cleaned = input
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
  if (!cleaned) return ''
  return MD_EXT.test(cleaned) ? cleaned : `${cleaned}.md`
}

/** Turns an image or link target in a document into a URL that the server can serve. */
export function resolveAsset(docPath: string, src: string): string {
  if (!src || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return src
  const parts = src.startsWith('/') ? [] : dirOf(docPath).split('/').filter(Boolean)
  for (const part of src.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/files/' + parts.map(encodeURIComponent).join('/')
}

/** A short relative time such as "5 min ago" or "3 days ago". */
export function timeAgo(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/** Fuzzy match score of a query against a path. Lower is better; null means no match. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  const t = target.toLowerCase()
  if (!q) return 0
  let from = 0
  let last = -1
  let score = 0
  for (const ch of q) {
    const found = t.indexOf(ch, from)
    if (found < 0) return null
    score += last < 0 ? found : found - last - 1
    last = found
    from = found + 1
  }
  // A whole match inside the file name is the best kind of match.
  if (t.indexOf(q, t.lastIndexOf('/') + 1) >= 0) score -= 100
  return score
}
