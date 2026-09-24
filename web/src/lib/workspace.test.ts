// ABOUTME: Tests for the workspace reducer.
// ABOUTME: They cover opening documents, layout changes with the shelf, closing, and moving panes.

import { describe, expect, it } from 'vitest'
import { initialWork, type Work, workReducer } from './workspace'

const paths = (w: Work) => w.panes.map((p) => p.path)

function run(...actions: Parameters<typeof workReducer>[1][]): Work {
  return actions.reduce(workReducer, initialWork())
}

describe('open', () => {
  it('fills the empty pane first, then replaces the focused pane', () => {
    const w = run({ type: 'open', path: 'a.md', where: 'slot' }, { type: 'open', path: 'b.md', where: 'slot' })
    expect(paths(w)).toEqual(['b.md'])
    expect(w.shelf).toEqual(['a.md'])
  })

  it('focuses a pane that already shows the document', () => {
    const w = run({ type: 'openMany', paths: ['a.md', 'b.md'] }, { type: 'open', path: 'b.md', where: 'focused' })
    expect(w.focus).toBe(1)
    expect(paths(w)).toEqual(['a.md', 'b.md'])
  })

  it('opens a document that is already open in a second pane beside it', () => {
    const w = run({ type: 'open', path: 'a.md', where: 'slot' }, { type: 'open', path: 'a.md', where: 'new' })
    expect(w.layout).toBe('cols2')
    expect(paths(w)).toEqual(['a.md', 'a.md'])
    expect(new Set(w.panes.map((p) => p.id)).size).toBe(2)
    expect(w.focus).toBe(1)
  })

  it('closes one of two panes with the same document and keeps the other', () => {
    const w = run({ type: 'open', path: 'a.md', where: 'slot' }, { type: 'open', path: 'a.md', where: 'new' }, { type: 'close', index: 1 })
    expect(paths(w)).toEqual(['a.md'])
  })

  it('opens in a new pane and grows the layout', () => {
    const w = run({ type: 'open', path: 'a.md', where: 'slot' }, { type: 'open', path: 'b.md', where: 'new' })
    expect(w.layout).toBe('cols2')
    expect(paths(w)).toEqual(['a.md', 'b.md'])
    expect(w.focus).toBe(1)
  })
})

describe('layout', () => {
  it('opens many documents in the simplest layout', () => {
    const w = run({ type: 'openMany', paths: ['a.md', 'b.md', 'c.md', 'd.md'] })
    expect(w.layout).toBe('grid4')
    expect(paths(w)).toEqual(['a.md', 'b.md', 'c.md', 'd.md'])
  })

  it('keeps documents beyond the six visible panes available on the shelf', () => {
    const all = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md']
    const w = run({ type: 'openMany', paths: all })
    expect(paths(w)).toEqual(all.slice(0, 6))
    expect(w.shelf).toContain('g.md')
  })

  it('keeps the focused pane when the layout gets smaller and brings the others back later', () => {
    let w = run({ type: 'openMany', paths: ['a.md', 'b.md', 'c.md'] }, { type: 'focus', index: 2 })
    w = workReducer(w, { type: 'layout', id: 'single' })
    expect(paths(w)).toEqual(['c.md'])
    expect(w.focus).toBe(0)
    w = workReducer(w, { type: 'layout', id: 'cols3' })
    expect(paths(w)).toEqual(['c.md', 'a.md', 'b.md'])
    expect(w.focus).toBe(0)
  })

  it('adds empty panes when there is nothing on the shelf', () => {
    const w = run({ type: 'open', path: 'a.md', where: 'slot' }, { type: 'layout', id: 'cols2' })
    expect(paths(w)).toEqual(['a.md', null])
  })
})

describe('close, move, and mode', () => {
  it('closes a pane and shrinks the layout', () => {
    const w = run({ type: 'openMany', paths: ['a.md', 'b.md', 'c.md'] }, { type: 'close', index: 1 })
    expect(w.layout).toBe('cols2')
    expect(paths(w)).toEqual(['a.md', 'c.md'])
  })

  it('moves the focused pane to its neighbour', () => {
    const w = run({ type: 'openMany', paths: ['a.md', 'b.md'] }, { type: 'moveDir', dir: 'right' })
    expect(paths(w)).toEqual(['b.md', 'a.md'])
    expect(w.focus).toBe(1)
  })

  it('toggles the mode of the focused pane and remembers it for new panes', () => {
    const w = run({ type: 'open', path: 'a.md', where: 'slot' }, { type: 'toggleMode' }, { type: 'open', path: 'b.md', where: 'new' })
    expect(w.panes.map((p) => p.mode)).toEqual(['source', 'source'])
  })

  it('removes documents that are gone from disk', () => {
    const w = run({ type: 'openMany', paths: ['a.md', 'b.md'] }, { type: 'prune', existing: ['b.md'] })
    expect(paths(w)).toEqual([null, 'b.md'])
  })
})
