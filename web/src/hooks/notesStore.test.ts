// ABOUTME: Tests for the notes store: loading, load errors, delayed saves, merging after conflicts, and refreshes.
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
    diskNotes: () => parseNotes(disk.content).notes ?? [],
    diskBytes: () => disk.content,
    /** Puts bytes on the file that emditor did not write, the way a damaged or newer file gets there. */
    damage: (content: string) => { disk = { content, modified: disk.modified + 7 } },
    otherWriter: (notes: Note[]) => { disk = { content: serializeNotes(notes), modified: disk.modified + 1 } },
    /** Removes the sidecar the way another writer can, so the server reports it as missing. */
    removeFile: () => { disk = { content: '', modified: 0 } },
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

  it('keeps a change from another writer for a note that was not touched here', async () => {
    const test = setup([makeNote('a'), makeNote('b')])
    await test.open()
    test.store.update('a.md', 'b', { body: 'mine b' })
    test.otherWriter([makeNote('a', 'edited elsewhere'), makeNote('b')])
    await test.store.save('a.md')
    expect(test.diskNotes().find((n) => n.id === 'a')?.body).toBe('edited elsewhere')
    expect(test.diskNotes().find((n) => n.id === 'b')?.body).toBe('mine b')
  })

  it('does not bring back a note that another writer removed', async () => {
    const test = setup([makeNote('a'), makeNote('b')])
    await test.open()
    test.store.update('a.md', 'b', { body: 'mine b' })
    test.otherWriter([makeNote('b')])
    await test.store.save('a.md')
    expect(test.diskNotes().map((n) => n.id)).toEqual(['b'])
    expect(test.diskNotes().find((n) => n.id === 'b')?.body).toBe('mine b')
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
    expect(test.store.getSnapshot('a.md').loadError).toBe('read-failed')
    expect(error).toHaveBeenCalledOnce()
  })

  it('keeps a damaged notes file as it is and reports the damage', async () => {
    const test = setup()
    const bytes = '{"version": 1,\n  "notes": [{"id": "a", "qu'
    test.damage(bytes)
    test.store.subscribe('a.md', () => {})
    await vi.waitFor(() => expect(test.store.getSnapshot('a.md').loadError).toBe('malformed'))
    const snapshot = test.store.getSnapshot('a.md')
    expect(snapshot.loaded).toBe(false)
    expect(snapshot.notes).toEqual([])
    test.store.add('a.md', makeNote('mine'))
    await test.store.save('a.md')
    expect(test.client.writeNotes).not.toHaveBeenCalled()
    expect(test.diskBytes()).toBe(bytes)
    expect(test.store.hasUnsettled()).toBe(true)
  })

  it('does not read or overwrite a notes file of another version', async () => {
    const test = setup()
    const bytes = serializeNotes([makeNote('a')]).replace('"version": 1', '"version": 2')
    test.damage(bytes)
    test.store.subscribe('a.md', () => {})
    await vi.waitFor(() => expect(test.store.getSnapshot('a.md').loadError).toBe('unsupported-version'))
    expect(test.store.getSnapshot('a.md').loaded).toBe(false)
    test.store.add('a.md', makeNote('mine'))
    await test.store.save('a.md')
    expect(test.client.writeNotes).not.toHaveBeenCalled()
    expect(test.diskBytes()).toBe(bytes)
  })

  it('reads the file a second time when the user retries after a failed load', async () => {
    const test = setup([makeNote('a')])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    test.client.readNotes.mockRejectedValueOnce(new ApiError('boom', 500))
    test.store.subscribe('a.md', () => {})
    await vi.waitFor(() => expect(test.store.getSnapshot('a.md').loadError).toBe('read-failed'))
    expect(test.client.readNotes).toHaveBeenCalledTimes(1)
    test.store.add('a.md', makeNote('mine'))
    await test.store.retry('a.md')
    expect(test.client.readNotes).toHaveBeenCalledTimes(2)
    const snapshot = test.store.getSnapshot('a.md')
    expect(snapshot.loaded).toBe(true)
    expect(snapshot.loadError).toBe(null)
    expect(snapshot.status).toBe('saved')
    expect(test.diskNotes().map((n) => n.id).sort()).toEqual(['a', 'mine'])
  })

  it('tries a failed first load again when the window takes the focus again', async () => {
    const test = setup([makeNote('a')])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    test.client.readNotes.mockRejectedValueOnce(new ApiError('boom', 500))
    test.store.subscribe('a.md', () => {})
    await vi.waitFor(() => expect(test.store.getSnapshot('a.md').loadError).toBe('read-failed'))
    await test.store.refresh()
    expect(test.client.readNotes).toHaveBeenCalledTimes(2)
    const snapshot = test.store.getSnapshot('a.md')
    expect(snapshot.loaded).toBe(true)
    expect(snapshot.notes.map((n) => n.id)).toEqual(['a'])
  })

  it('reports the damage when a refresh meets a notes file that another program broke', async () => {
    const test = setup([makeNote('a')])
    await test.open()
    test.damage('{not json')
    await test.store.refresh()
    const snapshot = test.store.getSnapshot('a.md')
    expect(snapshot.loadError).toBe('malformed')
    expect(snapshot.loaded).toBe(true)
    expect(snapshot.notes.map((n) => n.id)).toEqual(['a'])
    test.store.update('a.md', 'a', { body: 'mine' })
    await test.store.save('a.md')
    expect(test.client.writeNotes).not.toHaveBeenCalled()
    expect(test.diskBytes()).toBe('{not json')
  })

  it('keeps a damaged file as it is when a save meets the damage in a conflict', async () => {
    const test = setup([makeNote('a')])
    await test.open()
    test.store.update('a.md', 'a', { body: 'mine' })
    test.damage('{not json')
    await test.store.save('a.md')
    expect(test.store.getSnapshot('a.md').loadError).toBe('malformed')
    expect(test.client.writeNotes).toHaveBeenCalledTimes(1)
    expect(test.diskBytes()).toBe('{not json')
  })

  it('treats a notes file that another writer removed as empty when it saves', async () => {
    const test = setup([makeNote('a'), makeNote('b')])
    await test.open()
    test.store.update('a.md', 'a', { body: 'mine a' })
    test.removeFile()
    await test.store.save('a.md')
    const snapshot = test.store.getSnapshot('a.md')
    expect(snapshot.loadError).toBe(null)
    expect(snapshot.status).toBe('saved')
    expect(test.diskNotes().map((n) => n.id)).toEqual(['a'])
    expect(test.diskNotes().find((n) => n.id === 'a')?.body).toBe('mine a')
  })

  it('takes a notes file that another writer removed as empty notes on a refresh', async () => {
    const test = setup([makeNote('a')])
    await test.open()
    test.removeFile()
    await test.store.refresh()
    const snapshot = test.store.getSnapshot('a.md')
    expect(snapshot.loadError).toBe(null)
    expect(snapshot.notes).toEqual([])
  })

  it('clears the error state after a retried load succeeds and nothing waits to save', async () => {
    const test = setup([makeNote('a')])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    test.client.readNotes.mockRejectedValueOnce(new ApiError('boom', 500))
    test.store.subscribe('a.md', () => {})
    await vi.waitFor(() => expect(test.store.getSnapshot('a.md').loadError).toBe('read-failed'))
    await test.store.retry('a.md')
    const snapshot = test.store.getSnapshot('a.md')
    expect(snapshot.loaded).toBe(true)
    expect(snapshot.loadError).toBe(null)
    expect(snapshot.status).toBe('idle')
  })

  it('keeps a change made while a write was in flight when the next save meets a conflict', async () => {
    const test = setup([makeNote('a')])
    await test.open()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const plain = test.client.writeNotes.getMockImplementation()!
    test.client.writeNotes.mockImplementationOnce(async (path: string, content: string, base: number) => {
      const saved = await plain(path, content, base)
      await gate
      return saved
    })
    test.store.update('a.md', 'a', { body: 'mine' })
    const first = test.store.save('a.md')
    await vi.waitFor(() => expect(test.diskNotes().find((n) => n.id === 'a')?.body).toBe('mine'))
    test.store.update('a.md', 'a', { body: 'mine 2' })
    test.otherWriter([makeNote('a', 'theirs')])
    release()
    await first
    await test.store.save('a.md')
    expect(test.diskNotes().find((n) => n.id === 'a')?.body).toBe('mine 2')
    expect(test.store.getSnapshot('a.md').status).toBe('saved')
    expect(test.store.hasUnsettled()).toBe(false)
  })
})
