// ABOUTME: Lifecycle tests that mount the real Milkdown rich editor in jsdom against a document store.
// ABOUTME: They pin that the last edit reaches the store before the editor can go away.

// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { DocumentStore, tabDraftKey } from '../hooks/documentStore'
import { RichEditor, type RichHandle } from './RichEditor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FOLDER = '/test-folder'

/** The served folder: one file per path, with a modification time that grows on each write. */
function fakeFolder() {
  const disk = new Map<string, { path: string; content: string; modified: number }>([
    ['a.md', { path: 'a.md', content: 'First line\n', modified: 1 }],
    ['b.md', { path: 'b.md', content: 'Second file\n', modified: 1 }],
    // Milkdown writes a rule of three stars as three dashes, so this file does not survive a round trip.
    ['hr.md', { path: 'hr.md', content: 'x\n\n***\ny\n', modified: 1 }],
  ])
  return {
    disk,
    content: (path: string) => disk.get(path)!.content,
    client: {
      read: vi.fn(async (path: string) => ({ ...disk.get(path)! })),
      write: vi.fn(async (path: string, content: string, base?: number) => {
        const current = disk.get(path)!
        if (base !== undefined && base !== current.modified) throw new ApiError('conflict', 409)
        const modified = current.modified + 1
        disk.set(path, { path, content, modified })
        return { modified }
      }),
    },
  }
}

/** A store over the folder, with the drafts of the local backup held in memory. */
function setup() {
  const folder = fakeFolder()
  const memory = new Map<string, string>()
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size },
  }
  const store = new DocumentStore(FOLDER, folder.client, storage, 'rich-editor-test')
  const open = async (path: string) => {
    store.open(path)
    await vi.waitFor(() => expect(store.getSnapshot(path).doc?.content).toBe(folder.content(path)))
  }
  const backup = (path: string) => {
    const stored = JSON.parse(memory.get(tabDraftKey(FOLDER, 'rich-editor-test')) ?? '{}') as Record<string, { content: string }>
    return stored[path]?.content
  }
  return { folder, store, open, backup }
}

type Mounted = {
  handle: { current: RichHandle | null }
  /** Shows another document in the same place, as a pane does when it is pointed elsewhere. */
  show: (path: string, initial: string, content: string) => Promise<void>
  /** Renders the same document again with new text from the store. */
  showAgain: (path: string, initial: string, content: string) => Promise<void>
  /** Takes the editor off the page at once. */
  unmount: () => void
}

const live: { root: Root; container: HTMLElement }[] = []

/** Puts one editor on the page and waits until the editor says that it is ready. */
async function mountEditor(store: DocumentStore): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const handle: { current: RichHandle | null } = { current: null }
  const item = { root, container }
  live.push(item)
  let ready!: () => void
  const gate = () => new Promise<void>((resolve) => { ready = resolve })
  const render = (path: string, initial: string, content: string) => {
    // The edit callback is bound to the document of this render, as the pane binds it.
    const edit = (markdown: string) => { store.edit(path, markdown) }
    return act(async () => {
      root.render(
        <RichEditor
          docPath={path}
          initial={initial}
          content={content}
          onChange={edit}
          onReady={() => ready()}
          notes={[]}
          highlight={null}
          onAnnotate={null}
          onAnchors={() => {}}
          onActivateNote={() => {}}
          handleRef={handle}
          lintRules={null}
          onLint={() => {}}
          semantic={null}
          onSemanticStatus={() => {}}
          onSemantic={() => {}}
        />,
      )
    })
  }
  const show = async (path: string, initial: string, content: string) => {
    const done = gate()
    await render(path, initial, content)
    // The editor starts on its own after the render; the wait stays outside act, because
    // awaiting a result of the render inside act holds the React work queue back here.
    await done
  }
  /** Renders the same editor again with new text from the store, as a pane does on each store change. */
  const showAgain = (path: string, initial: string, content: string) => render(path, initial, content)
  const unmount = () => {
    const at = live.indexOf(item)
    if (at >= 0) {
      live.splice(at, 1)
      root.unmount()
    }
  }
  return { handle, show, showAgain, unmount }
}

afterEach(async () => {
  while (live.length) {
    const item = live.pop()!
    await act(async () => { item.root.unmount() })
    item.container.remove()
  }
  vi.restoreAllMocks()
})

describe('RichEditor document publication', () => {
  it('sends each edit to the store at once, without a delay', async () => {
    const test = setup()
    await test.open('a.md')
    const editor = await mountEditor(test.store)
    await editor.show('a.md', 'First line\n', 'First line\n')

    await act(() => { editor.handle.current!.format('heading1') })

    expect(test.store.getSnapshot('a.md').doc?.content).toBe('# First line\n')
  })

  it('keeps an edit that is followed at once by the editor going away', async () => {
    const test = setup()
    await test.open('a.md')
    const editor = await mountEditor(test.store)
    await editor.show('a.md', 'First line\n', 'First line\n')

    await act(() => {
      editor.handle.current!.format('heading1')
      editor.unmount()
    })

    expect(test.store.getSnapshot('a.md').doc?.content).toBe('# First line\n')
    expect(test.backup('a.md')).toBe('# First line\n')
  })

  it('lets the save that follows a pane close see the last edit', async () => {
    const test = setup()
    await test.open('a.md')
    const editor = await mountEditor(test.store)
    await editor.show('a.md', 'First line\n', 'First line\n')

    await act(() => {
      editor.handle.current!.format('heading1')
      editor.unmount()
    })
    await test.store.save('a.md')

    expect(test.folder.content('a.md')).toBe('# First line\n')
  })

  it('sends the live text when the page is unloaded', async () => {
    const test = setup()
    await test.open('a.md')
    const editor = await mountEditor(test.store)
    await editor.show('a.md', 'First line\n', 'First line\n')

    await act(() => {
      editor.handle.current!.format('heading1')
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(test.store.getSnapshot('a.md').doc?.content).toBe('# First line\n')
    expect(test.backup('a.md')).toBe('# First line\n')
    await act(() => editor.unmount())
  })

  it('sends the last edit of a document to that document when the pane shows another one', async () => {
    const test = setup()
    await test.open('a.md')
    await test.open('b.md')
    const editor = await mountEditor(test.store)
    await editor.show('a.md', 'First line\n', 'First line\n')

    await act(() => { editor.handle.current!.format('heading1') })
    await editor.show('b.md', 'Second file\n', 'Second file\n')

    expect(test.store.getSnapshot('a.md').doc?.content).toBe('# First line\n')
    expect(test.store.getSnapshot('b.md').doc?.content).toBe('Second file\n')
  })

  it('sends nothing when a document that Milkdown writes differently is opened and closed without an edit', async () => {
    const test = setup()
    await test.open('hr.md')
    const editor = await mountEditor(test.store)
    const edit = vi.spyOn(test.store, 'edit')
    await editor.show('hr.md', 'x\n\n***\ny\n', 'x\n\n***\ny\n')

    await act(() => { editor.unmount() })

    expect(edit).not.toHaveBeenCalled()
    expect(test.store.getSnapshot('hr.md').doc?.content).toBe('x\n\n***\ny\n')
    expect(test.backup('hr.md')).toBeUndefined()
  })

  it('does not send the text back when another pane of the same document brings it in', async () => {
    const test = setup()
    await test.open('a.md')
    const first = await mountEditor(test.store)
    await first.show('a.md', 'First line\n', 'First line\n')
    const second = await mountEditor(test.store)
    await second.show('a.md', 'First line\n', 'First line\n')
    const edit = vi.spyOn(test.store, 'edit')

    await act(() => { first.handle.current!.format('heading1') })
    // The second pane learns of the edit from the store, as the app does through its subscription.
    await second.showAgain('a.md', 'First line\n', '# First line\n')

    expect(edit).toHaveBeenCalledTimes(1)
    expect(edit).toHaveBeenCalledWith('a.md', '# First line\n')
    expect(test.store.getSnapshot('a.md').doc?.content).toBe('# First line\n')
  })

  it('publishes at once but still leaves the write to the debounced save', async () => {
    const test = setup()
    await test.open('a.md')
    const editor = await mountEditor(test.store)
    await editor.show('a.md', 'First line\n', 'First line\n')

    await act(() => { editor.handle.current!.format('heading1') })
    expect(test.store.getSnapshot('a.md').doc?.content).toBe('# First line\n')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(test.folder.client.write).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(test.folder.content('a.md')).toBe('# First line\n'), { timeout: 2000 })
    await act(() => editor.unmount())
  })
})
