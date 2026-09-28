// ABOUTME: Client for the emditor server API.
// ABOUTME: It lists, reads, writes, and creates Markdown files and their notes, keeps the writing rules, and asks for rewrites.

export type FileEntry = { path: string; modified: number; preview: string }
export type Listing = { root: string; path: string; files: FileEntry[] }
export type Doc = { path: string; content: string; modified: number }
/** The notes file of a document. A document without notes has empty content and modified 0. */
export type NotesFile = { content: string; modified: number }
/** What to rewrite: the passage, the text around it, the rules that it breaks, and an optional instruction. */
export type RewriteRequest = { text: string; context: string; rules: string[]; instruction?: string }

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(body.error ?? res.statusText, res.status)
  }
  return res.json()
}

const fileUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`
const notesUrl = (path: string) => `/api/notes?path=${encodeURIComponent(path)}`
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  list: () => request<Listing>('/api/files'),
  read: (path: string) => request<Doc>(fileUrl(path)),
  write: (path: string, content: string, baseModified?: number) =>
    request<{ modified: number }>(fileUrl(path), jsonInit('PUT', { content, baseModified })),
  create: (path: string, content: string) => request<Doc>(fileUrl(path), jsonInit('POST', { content })),
  readNotes: (path: string) => request<NotesFile>(notesUrl(path)),
  writeNotes: (path: string, content: string, baseModified: number) =>
    request<{ modified: number }>(notesUrl(path), jsonInit('PUT', { content, baseModified })),
  readRules: () => request<NotesFile>('/api/rules'),
  writeRules: (content: string, baseModified: number) =>
    request<{ modified: number }>('/api/rules', jsonInit('PUT', { content, baseModified })),
  rewriteStatus: () => request<{ available: boolean; model?: string }>('/api/rewrite'),
  rewrite: (body: RewriteRequest) => request<{ text: string }>('/api/rewrite', jsonInit('POST', body)),
}
