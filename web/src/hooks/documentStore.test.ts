// ABOUTME: Covers document drafts across saves, pane lifetimes, and external file refreshes.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { DocumentStore } from './documentStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function memoryStorage(memory: Map<string, string>) {
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
  }
}

function setup() {
  let disk = { path: 'draft.md', content: '# First\n', modified: 1 }
  const memory = new Map<string, string>()
  const storage = memoryStorage(memory)
  const client = {
    read: vi.fn(async () => ({ ...disk })),
    write: vi.fn(async (_path: string, content: string, base?: number) => {
      if (base !== undefined && base !== disk.modified) throw new ApiError('conflict', 409)
      disk = { ...disk, content, modified: disk.modified + 1 }
      return { modified: disk.modified }
    }),
  }
  const store = new DocumentStore('/test-folder', client, storage)
  const open = async () => { store.open('draft.md'); await vi.waitFor(() => expect(store.getSnapshot('draft.md').doc?.content).toBe('# First\n')) }
  return { store, client, storage, memory, open, disk: () => disk, setDisk: (content: string) => { disk = { ...disk, content, modified: disk.modified + 1 } } }
}

function folderSetup(files: Record<string, string>, conflicts = false) {
  const memory = new Map<string, string>()
  const storage = memoryStorage(memory)
  const disk = new Map(Object.entries(files).map(([path, content]) => [path, { content, modified: 1 }]))
  const client = {
    read: vi.fn(async (path: string) => ({ path, ...disk.get(path)! })),
    write: vi.fn(async (path: string, content: string, base?: number) => {
      if (conflicts && base !== undefined && base !== disk.get(path)!.modified) throw new ApiError('conflict', 409)
      const modified = (disk.get(path)?.modified ?? 0) + 1
      disk.set(path, { content, modified })
      return { modified }
    }),
  }
  return { memory, storage, client, diskState: disk }
}

function draftKey(tab: string) {
  return `emditor.tabdrafts:${encodeURIComponent('/test-folder')}:${tab}`
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('DocumentStore', () => {
  it('keeps the latest text available when an editor mode is remounted after save', async () => {
    const test = setup()
    await test.open()
    test.store.edit('draft.md', '# First\n\nMore text\n')
    await test.store.save('draft.md')
    expect(test.disk().content).toBe('# First\n\nMore text\n')
    expect(test.store.getSnapshot('draft.md').doc?.content).toBe('# First\n\nMore text\n')
    test.store.edit('draft.md', '# First\n\nMore text\n\nAnother edit\n')
    await test.store.save('draft.md')
    expect(test.disk().content).toContain('More text')
    expect(test.disk().content).toContain('Another edit')
  })

  it('protects the draft while a write is waiting for acknowledgment', async () => {
    const test = setup()
    await test.open()
    const write = deferred<{ modified: number }>()
    test.client.write.mockImplementationOnce(() => write.promise)
    test.store.edit('draft.md', '# Pending\n')
    const saving = test.store.save('draft.md')
    expect(test.store.hasUnsettled()).toBe(true)
    expect(test.store.getSnapshot('draft.md').status).toBe('saving')
    write.resolve({ modified: 2 })
    await saving
    expect(test.store.hasUnsettled()).toBe(false)
  })

  it('retains a failed draft after its pane unsubscribes and restores it after reload', async () => {
    const test = setup()
    await test.open()
    const unsubscribe = test.store.subscribe('draft.md', () => {})
    test.store.edit('draft.md', '# Kept draft\n')
    unsubscribe()
    test.client.write.mockRejectedValueOnce(new Error('disk unavailable'))
    await test.store.save('draft.md')
    expect(test.store.getSnapshot('draft.md').status).toBe('error')
    expect(test.store.getSnapshot('draft.md').doc?.content).toBe('# Kept draft\n')
    expect(test.memory.size).toBe(1)

    const restored = new DocumentStore('/test-folder', test.client, test.storage)
    restored.open('draft.md')
    await vi.waitFor(() => expect(restored.getSnapshot('draft.md').doc?.content).toBe('# Kept draft\n'))
    expect(restored.hasUnsettled()).toBe(true)
  })

  it('keeps typing that starts while an external refresh request is in flight', async () => {
    const test = setup()
    await test.open()
    const read = deferred<{ path: string; content: string; modified: number }>()
    test.client.read.mockImplementationOnce(() => read.promise)
    const refresh = test.store.refresh()
    test.store.edit('draft.md', '# Local edit\n')
    read.resolve({ path: 'draft.md', content: '# Disk edit\n', modified: 2 })
    await refresh
    expect(test.store.getSnapshot('draft.md').doc?.content).toBe('# Local edit\n')
    expect(test.store.getSnapshot('draft.md').status).toBe('unsaved')
  })

  it('keeps typing that starts while a reload request is in flight', async () => {
    const test = setup()
    await test.open()
    const read = deferred<{ path: string; content: string; modified: number }>()
    test.client.read.mockImplementationOnce(() => read.promise)
    const reload = test.store.reload('draft.md')
    await vi.waitFor(() => expect(test.client.read).toHaveBeenCalledTimes(2))
    test.store.edit('draft.md', '# Local edit\n')
    read.resolve({ path: 'draft.md', content: '# Disk version\n', modified: 2 })
    await reload
    expect(test.store.getSnapshot('draft.md').doc?.content).toBe('# Local edit\n')
    expect(test.store.getSnapshot('draft.md').status).toBe('unsaved')
    expect(test.store.hasUnsettled()).toBe(true)
  })

  it('keeps one tab draft backup when another tab saves its own file', async () => {
    const test = folderSetup({ 'a.md': '# A\n', 'b.md': '# B\n' })
    const tabA = new DocumentStore('/test-folder', test.client, test.storage, 'tab-a')
    const tabB = new DocumentStore('/test-folder', test.client, test.storage, 'tab-b')
    tabA.open('a.md')
    await vi.waitFor(() => expect(tabA.getSnapshot('a.md').doc?.content).toBe('# A\n'))
    tabA.edit('a.md', '# A edited\n')
    tabB.open('b.md')
    await vi.waitFor(() => expect(tabB.getSnapshot('b.md').doc?.content).toBe('# B\n'))
    tabB.edit('b.md', '# B edited\n')
    await tabB.save('b.md')
    expect(tabB.hasUnsettled()).toBe(false)
    expect(tabA.hasUnsettled()).toBe(true)
    expect([...test.memory.values()].some((value) => value.includes('# A edited'))).toBe(true)

    const recovery = new DocumentStore('/test-folder', test.client, test.storage, 'tab-c')
    recovery.open('a.md')
    await vi.waitFor(() => expect(recovery.getSnapshot('a.md').doc?.content).toBe('# A edited\n'))
    expect(recovery.hasUnsettled()).toBe(true)
  })

  it('adopts the shared draft backup from an older release into the tab key', async () => {
    const test = setup()
    test.memory.set('emditor.drafts:/test-folder', JSON.stringify({ 'draft.md': { content: '# Legacy draft\n' } }))
    const store = new DocumentStore('/test-folder', test.client, test.storage, 'tab-a')
    store.open('draft.md')
    await vi.waitFor(() => expect(store.getSnapshot('draft.md').doc?.content).toBe('# Legacy draft\n'))
    expect(store.hasUnsettled()).toBe(true)
    expect(test.memory.has('emditor.drafts:/test-folder')).toBe(false)
    expect(test.memory.has(draftKey('tab-a'))).toBe(true)
  })

  it('removes draft backups from tabs that stopped writing long ago', () => {
    const test = setup()
    const now = Date.now()
    test.memory.set(draftKey('gone-tab'), JSON.stringify({ 'old.md': { content: '# Old\n', at: now - 8 * 24 * 60 * 60 * 1000 } }))
    test.memory.set(draftKey('live-tab'), JSON.stringify({ 'live.md': { content: '# Live\n', at: now } }))
    new DocumentStore('/test-folder', test.client, test.storage, 'tab-a')
    expect(test.memory.has(draftKey('gone-tab'))).toBe(false)
    expect(test.memory.has(draftKey('live-tab'))).toBe(true)
  })

  it('keeps both copies when two tabs draft the same path', async () => {
    const test = folderSetup({ 'a.md': '# Base\n' }, true)
    const tabA = new DocumentStore('/test-folder', test.client, test.storage, 'tab-a')
    const tabB = new DocumentStore('/test-folder', test.client, test.storage, 'tab-b')
    tabA.open('a.md')
    await vi.waitFor(() => expect(tabA.getSnapshot('a.md').doc?.content).toBe('# Base\n'))
    tabB.open('a.md')
    await vi.waitFor(() => expect(tabB.getSnapshot('a.md').doc?.content).toBe('# Base\n'))
    tabA.edit('a.md', '# From A\n')
    tabB.edit('a.md', '# From B\n')
    await tabA.save('a.md')
    await tabB.save('a.md')
    expect(test.diskState.get('a.md')!.content).toBe('# From A\n')
    expect(tabB.getSnapshot('a.md').status).toBe('conflict')
    expect(tabB.getSnapshot('a.md').doc?.content).toBe('# From B\n')
    const stored = JSON.parse(test.memory.get(draftKey('tab-b')) ?? '{}') as Record<string, { content: string }>
    expect(stored['a.md']?.content).toBe('# From B\n')
  })

  it('keeps the shared backup of an older release when browser storage refuses the adoption write', () => {
    const memory = new Map<string, string>([['emditor.drafts:/test-folder', JSON.stringify({ 'old.md': { content: '# Legacy\n' } })]])
    let quota = true
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (quota) throw new DOMException('quota exceeded', 'QuotaExceededError')
        memory.set(key, value)
      },
      removeItem: (key: string) => { memory.delete(key) },
      get length() { return memory.size },
      key: (index: number) => [...memory.keys()][index] ?? null,
    }
    const client = {
      read: vi.fn(async (path: string) => ({ path, content: '# Disk\n', modified: 1 })),
      write: vi.fn(async () => ({ modified: 2 })),
    }
    const store = new DocumentStore('/test-folder', client, storage, 'tab-a')
    expect(memory.has('emditor.drafts:/test-folder')).toBe(true)
    quota = false
    store.edit('old.md', '# Edited\n')
    const stored = JSON.parse(memory.get(draftKey('tab-a')) ?? '{}') as Record<string, { content: string }>
    expect(stored['old.md']?.content).toBe('# Edited\n')
    expect(memory.has('emditor.drafts:/test-folder')).toBe(false)
  })

  it('reuses the tab identity in session storage so a reload keeps the draft key', async () => {
    const test = setup()
    const session = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => { session.set(key, value) },
    })
    const first = new DocumentStore('/test-folder', test.client, test.storage)
    first.open('draft.md')
    await vi.waitFor(() => expect(first.getSnapshot('draft.md').doc?.content).toBe('# First\n'))
    first.edit('draft.md', '# Before reload\n')

    const reloaded = new DocumentStore('/test-folder', test.client, test.storage)
    reloaded.open('draft.md')
    await vi.waitFor(() => expect(reloaded.getSnapshot('draft.md').doc?.content).toBe('# Before reload\n'))
    expect(reloaded.hasUnsettled()).toBe(true)
    const tabKeys = [...test.memory.keys()].filter((key) => key.startsWith('emditor.tabdrafts:'))
    expect(tabKeys).toHaveLength(1)
    await reloaded.save('draft.md')
    expect(test.memory.has(tabKeys[0])).toBe(false)
  })

  it('holds a conflicting draft until the user chooses recovery', async () => {
    const test = setup()
    await test.open()
    test.store.edit('draft.md', '# My draft\n')
    test.setDisk('# Another program\n')
    await test.store.save('draft.md')
    expect(test.store.getSnapshot('draft.md').status).toBe('conflict')
    expect(test.store.getSnapshot('draft.md').doc?.content).toBe('# My draft\n')
    expect(test.disk().content).toBe('# Another program\n')
    await test.store.retry('draft.md', true)
    expect(test.disk().content).toBe('# My draft\n')
  })
})
