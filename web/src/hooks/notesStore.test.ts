// ABOUTME: Tests for the notes store: loading, delayed saves, merging after conflicts, and refreshes.
// ABOUTME: A fake client keeps one notes file in memory with the same conflict rule as the server.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { type Note, parseNotes, serializeNotes } from '../lib/annotations'
import { NotesStore } from './notesStore'

const quote = { exact: 'word', prefix: '', suffix: '' }
const makeNote = (id: string, body = `body ${id}`): Note => ({ id, quote, body, created: 1, resolved: false })

function setup(initial: Note[] = []) {
  let disk = { content: initial.length ? serializeNotes(initial) : '', modified: initial.length ? 5 : 0 }
  const client = {
    readNotes: vi.fn(async () => ({ ...disk })),
    writeNotes: vi.fn(async (_path: string, content: string, base: number) => {
      if (base !== disk.modified) throw new ApiError('conflict', 409)
      disk = { content, modified: disk.modified + 1 }
      return { modified: disk.modified }
    }),
  }
  const store = new NotesStore(client)
  const open = async () => {
    store.subscribe('a.md', () => {})
    await vi.waitFor(() => expect(store.getSnapshot('a.md').loaded).toBe(true))
  }
  return {
    store,
    client,
    open,
    diskNotes: () => parseNotes(disk.content),
    otherWriter: (notes: Note[]) => { disk = { content: serializeNotes(notes), modified: disk.modified + 1 } },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('NotesStore', () => {
  it('loads the notes of a document', async () => {
    const test = setup([makeNote('a')])
    await test.open()
    expect(test.store.getSnapshot('a.md').notes.map((n) => n.id)).toEqual(['a'])
  })

  it('gives no notes when the document has no notes file', async () => {
    const test = setup()
    await test.open()
    expect(test.store.getSnapshot('a.md')).toMatchObject({ notes: [], loaded: true })
  })

  it('saves added, changed, and removed notes', async () => {
    const test = setup()
    await test.open()
    test.store.add('a.md', makeNote('a'))
    test.store.add('a.md', makeNote('b'))
    test.store.update('a.md', 'a', { body: 'changed', resolved: true })
    test.store.remove('a.md', 'b')
    expect(test.store.hasUnsettled()).toBe(true)
    await test.store.save('a.md')
    expect(test.diskNotes()).toEqual([{ ...makeNote('a'), body: 'changed', resolved: true }])
    expect(test.store.getSnapshot('a.md').status).toBe('saved')
    expect(test.store.hasUnsettled()).toBe(false)
  })

  it('saves by itself a short time after a change', async () => {
    vi.useFakeTimers()
    try {
      const test = setup()
      await test.open()
      test.store.add('a.md', makeNote('a'))
      expect(test.client.writeNotes).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(test.diskNotes().map((n) => n.id)).toEqual(['a'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('merges with the notes of another writer after a conflict', async () => {
    const test = setup([makeNote('a'), makeNote('b')])
    await test.open()
    test.store.remove('a.md', 'b')
    test.store.add('a.md', makeNote('mine'))
    test.otherWriter([makeNote('a'), makeNote('b'), makeNote('theirs')])
    await test.store.save('a.md')
    expect(test.diskNotes().map((n) => n.id).sort()).toEqual(['a', 'mine', 'theirs'])
    expect(test.store.getSnapshot('a.md').notes.map((n) => n.id).sort()).toEqual(['a', 'mine', 'theirs'])
  })

  it('keeps unsaved notes and reports an error when the write fails', async () => {
    const test = setup()
    await test.open()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    test.client.writeNotes.mockRejectedValueOnce(new ApiError('boom', 500))
    test.store.add('a.md', makeNote('a'))
    await test.store.save('a.md')
    expect(test.store.getSnapshot('a.md').status).toBe('error')
    expect(test.store.hasUnsettled()).toBe(true)
    expect(error).toHaveBeenCalledOnce()
    await test.store.save('a.md')
    expect(test.diskNotes().map((n) => n.id)).toEqual(['a'])
    expect(test.store.getSnapshot('a.md').status).toBe('saved')
  })

  it('takes notes changed on disk when nothing here is waiting to save', async () => {
    const test = setup([makeNote('a')])
    await test.open()
    test.otherWriter([makeNote('a', 'edited elsewhere')])
    await test.store.refresh()
    expect(test.store.getSnapshot('a.md').notes[0].body).toBe('edited elsewhere')
  })

  it('does not replace notes that wait to save when it refreshes', async () => {
    const test = setup([makeNote('a')])
    await test.open()
    test.store.update('a.md', 'a', { body: 'mine' })
    test.otherWriter([makeNote('a', 'theirs')])
    await test.store.refresh()
    expect(test.store.getSnapshot('a.md').notes[0].body).toBe('mine')
  })

  it('keeps notes added before the file finished loading', async () => {
    const test = setup([makeNote('disk')])
    test.store.subscribe('a.md', () => {})
    test.store.add('a.md', makeNote('early'))
    await vi.waitFor(() => expect(test.store.getSnapshot('a.md').loaded).toBe(true))
    expect(test.store.getSnapshot('a.md').notes.map((n) => n.id).sort()).toEqual(['disk', 'early'])
    await vi.waitFor(() => expect(test.diskNotes().map((n) => n.id).sort()).toEqual(['disk', 'early']))
  })

  it('reports an error when the notes cannot be loaded', async () => {
    const test = setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    test.client.readNotes.mockRejectedValueOnce(new ApiError('boom', 500))
    test.store.subscribe('a.md', () => {})
    await vi.waitFor(() => expect(test.store.getSnapshot('a.md').status).toBe('error'))
    expect(test.store.getSnapshot('a.md').loaded).toBe(false)
    expect(error).toHaveBeenCalledOnce()
  })
})
