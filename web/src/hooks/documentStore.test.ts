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

function setup() {
  let disk = { path: 'draft.md', content: '# First\n', modified: 1 }
  const memory = new Map<string, string>()
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
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

afterEach(() => vi.restoreAllMocks())

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
