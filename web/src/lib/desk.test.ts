// ABOUTME: Tests for the desk model.
// ABOUTME: They cover sorting, stacking, unstacking, and manual moves.

import { describe, expect, it } from 'vitest'
import type { FileEntry } from '../api'
import { buildDesk, docKey, type DeskState, EMPTY_DESK, moveBy, moveItem, stackItems, unstack } from './desk'

const file = (path: string, modified: number): FileEntry => ({ path, modified, size: 1, preview: '' })
const files = [file('b.md', 30), file('a.md', 10), file('notes/c.md', 20), file('d10.md', 5), file('d9.md', 4)]
const keys = (state: DeskState) => buildDesk(files, state).map((i) => i.key)

describe('buildDesk', () => {
  it('sorts by name with numbers in natural order', () => {
    expect(keys({ ...EMPTY_DESK, sort: 'name' })).toEqual(
      ['a.md', 'b.md', 'notes/c.md', 'd9.md', 'd10.md'].map(docKey),
    )
  })

  it('sorts by most recent change', () => {
    expect(keys({ ...EMPTY_DESK, sort: 'recent' })).toEqual(
      ['b.md', 'notes/c.md', 'a.md', 'd10.md', 'd9.md'].map(docKey),
    )
  })

  it('keeps the manual order and puts unknown items last', () => {
    const state: DeskState = { sort: 'manual', order: [docKey('d9.md'), docKey('a.md')], stacks: [] }
    expect(keys(state)).toEqual(['d9.md', 'a.md', 'b.md', 'notes/c.md', 'd10.md'].map(docKey))
  })

  it('shows a stack only when two or more of its files exist', () => {
    const state: DeskState = {
      sort: 'name',
      order: [],
      stacks: [
        { id: 'stack:1', paths: ['a.md', 'b.md'] },
        { id: 'stack:2', paths: ['gone.md', 'd9.md'] },
      ],
    }
    const items = buildDesk(files, state)
    expect(items.map((i) => i.key)).toEqual(['stack:1', docKey('notes/c.md'), docKey('d9.md'), docKey('d10.md')])
  })
})

describe('stackItems and unstack', () => {
  it('stacks two documents in the place of the first one', () => {
    const state: DeskState = { ...EMPTY_DESK, sort: 'name' }
    const items = buildDesk(files, state)
    const stacked = stackItems(state, items, [docKey('notes/c.md'), docKey('a.md')])
    expect(stacked.stacks).toHaveLength(1)
    expect(stacked.stacks[0].paths).toEqual(['notes/c.md', 'a.md'])
    expect(stacked.order).toEqual([docKey('b.md'), stacked.stacks[0].id, docKey('d9.md'), docKey('d10.md')])
  })

  it('adds a document to an existing stack', () => {
    const state: DeskState = { sort: 'name', order: [], stacks: [{ id: 'stack:1', paths: ['a.md', 'b.md'] }] }
    const items = buildDesk(files, state)
    const next = stackItems(state, items, ['stack:1', docKey('d9.md')])
    expect(next.stacks).toEqual([{ id: 'stack:1', paths: ['a.md', 'b.md', 'd9.md'] }])
  })

  it('unstacks back into the same place', () => {
    const state: DeskState = { sort: 'manual', order: ['stack:1'], stacks: [{ id: 'stack:1', paths: ['a.md', 'b.md'] }] }
    const items = buildDesk(files, state)
    const next = unstack(state, items, 'stack:1')
    expect(next.stacks).toEqual([])
    expect(next.order.slice(0, 2)).toEqual([docKey('a.md'), docKey('b.md')])
  })
})

describe('moveItem and moveBy', () => {
  it('moves an item after another and changes to manual sort', () => {
    const state: DeskState = { ...EMPTY_DESK, sort: 'name' }
    const next = moveItem(state, buildDesk(files, state), docKey('a.md'), docKey('notes/c.md'), 'after')
    expect(next.sort).toBe('manual')
    expect(keys(next)).toEqual(['b.md', 'notes/c.md', 'a.md', 'd9.md', 'd10.md'].map(docKey))
  })

  it('moves by a step and stays inside the list', () => {
    const state: DeskState = { ...EMPTY_DESK, sort: 'name' }
    const items = buildDesk(files, state)
    expect(keys(moveBy(state, items, docKey('a.md'), 1))[1]).toBe(docKey('a.md'))
    expect(keys(moveBy(state, items, docKey('a.md'), -3))[0]).toBe(docKey('a.md'))
  })
})
