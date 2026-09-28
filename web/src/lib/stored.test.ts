// ABOUTME: Tests for the validators of state kept in localStorage.
// ABOUTME: Every shape accepts its current form and rejects corrupt or empty input with null.

import { describe, expect, it } from 'vitest'
import { MAX_PANES } from './layouts'
import { EMPTY_DESK } from './desk'
import { MAX_ZOOM, MIN_ZOOM } from './zoom'
import { initialWork } from './workspace'
import { parseBoolean, parseBoundedNumber, parseDesk, parseThemeChoice, parseWork, parseZoom } from './stored'

const fullWork = {
  layout: 'cols2',
  panes: [
    { id: 'pane-1', path: 'notes/a.md', mode: 'rich' },
    { id: 'pane-2', path: null, mode: 'source' },
  ],
  focus: 1,
  lock: true,
  shelf: ['b.md', 'c.md'],
  defaultMode: 'source',
}

describe('parseWork', () => {
  it('accepts the workspace shape the app stores today', () => {
    const work = initialWork()
    expect(parseWork(work)).toEqual(work)
    expect(parseWork(fullWork)).toEqual(fullWork)
  })

  it('rejects a workspace with a corrupt field', () => {
    expect(parseWork({ ...fullWork, layout: 'circle' })).toBeNull()
    expect(parseWork({ ...fullWork, panes: [] })).toBeNull()
    expect(parseWork({ ...fullWork, panes: [{ id: 'pane-1', path: 'a.md' }] })).toBeNull()
    expect(parseWork({ ...fullWork, panes: [{ id: 'pane-1', path: 7, mode: 'rich' }] })).toBeNull()
    expect(parseWork({ ...fullWork, panes: Array.from({ length: MAX_PANES + 1 }, (_, i) => ({ id: `pane-${i}`, path: null, mode: 'rich' })) })).toBeNull()
    expect(parseWork({ ...fullWork, focus: fullWork.panes.length })).toBeNull()
    expect(parseWork({ ...fullWork, focus: -1 })).toBeNull()
    expect(parseWork({ ...fullWork, focus: 0.5 })).toBeNull()
    expect(parseWork({ ...fullWork, lock: 'yes' })).toBeNull()
    expect(parseWork({ ...fullWork, shelf: ['b.md', 2] })).toBeNull()
    expect(parseWork({ ...fullWork, defaultMode: 'plain' })).toBeNull()
    expect(parseWork('cols2')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(parseWork(null)).toBeNull()
    expect(parseWork(undefined)).toBeNull()
    expect(parseWork('')).toBeNull()
    expect(parseWork({})).toBeNull()
  })
})

describe('parseDesk', () => {
  it('accepts the desk shape the app stores today', () => {
    expect(parseDesk(EMPTY_DESK)).toEqual(EMPTY_DESK)
    expect(parseDesk({ sort: 'manual', order: ['doc:a.md', 'stack:s1'], stacks: [{ id: 'stack:s1', paths: ['a.md', 'b.md'] }] })).toEqual({
      sort: 'manual',
      order: ['doc:a.md', 'stack:s1'],
      stacks: [{ id: 'stack:s1', paths: ['a.md', 'b.md'] }],
    })
  })

  it('rejects a desk with a corrupt field', () => {
    expect(parseDesk({ ...EMPTY_DESK, sort: 'title' })).toBeNull()
    expect(parseDesk({ ...EMPTY_DESK, order: 'doc:a.md' })).toBeNull()
    expect(parseDesk({ ...EMPTY_DESK, stacks: [{ id: 'stack:s1' }] })).toBeNull()
    expect(parseDesk({ ...EMPTY_DESK, stacks: [{ id: 'stack:s1', paths: ['a.md', null] }] })).toBeNull()
    expect(parseDesk([])).toBeNull()
  })

  it('rejects empty input', () => {
    expect(parseDesk(null)).toBeNull()
    expect(parseDesk(undefined)).toBeNull()
    expect(parseDesk('')).toBeNull()
    expect(parseDesk({})).toBeNull()
  })
})

describe('preference validators', () => {
  it('accepts the boolean, theme, zoom, and index values the app stores today', () => {
    expect(parseBoolean(true)).toBe(true)
    expect(parseBoolean(false)).toBe(false)
    expect(parseThemeChoice('system')).toBe('system')
    expect(parseThemeChoice('light')).toBe('light')
    expect(parseThemeChoice('dark')).toBe('dark')
    expect(parseZoom(1)).toBe(1)
    expect(parseZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(parseZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
    expect(parseBoundedNumber(0, 3)(0)).toBe(0)
    expect(parseBoundedNumber(0, 3)(3)).toBe(3)
    expect(parseBoundedNumber(0, 3)(1.5)).toBe(1.5)
  })

  it('rejects corrupt values', () => {
    expect(parseBoolean('true')).toBeNull()
    expect(parseBoolean(1)).toBeNull()
    expect(parseThemeChoice('auto')).toBeNull()
    expect(parseZoom('1')).toBeNull()
    expect(parseZoom(MIN_ZOOM - 0.1)).toBeNull()
    expect(parseZoom(MAX_ZOOM + 0.1)).toBeNull()
    expect(parseZoom(Number.NaN)).toBeNull()
    expect(parseZoom(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseBoundedNumber(0, 3)(-1)).toBeNull()
    expect(parseBoundedNumber(0, 3)(4)).toBeNull()
  })

  it('rejects empty input', () => {
    expect(parseBoolean(null)).toBeNull()
    expect(parseThemeChoice(undefined)).toBeNull()
    expect(parseZoom('')).toBeNull()
    expect(parseBoundedNumber(0, 3)(null)).toBeNull()
  })
})
