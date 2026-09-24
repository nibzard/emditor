// ABOUTME: Client for the emditor server API.
// ABOUTME: It lists, reads, writes, and creates Markdown files in the served folder.

export type FileEntry = { path: string; modified: number; size: number; preview: string }
export type Listing = { root: string; path: string; files: FileEntry[] }
export type Doc = { path: string; content: string; modified: number }

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
}
