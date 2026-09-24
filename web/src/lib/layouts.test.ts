// ABOUTME: Tests for the pane layouts.
// ABOUTME: They cover layout choice by count and keyboard neighbour search.

import { describe, expect, it } from 'vitest'
import { getLayout, layoutForCount, neighbor } from './layouts'

describe('layoutForCount', () => {
  it('picks the simplest layout for a number of documents', () => {
    expect(layoutForCount(1).id).toBe('single')
    expect(layoutForCount(2).id).toBe('cols2')
    expect(layoutForCount(3).id).toBe('cols3')
    expect(layoutForCount(4).id).toBe('grid4')
    expect(layoutForCount(5).id).toBe('grid6')
    expect(layoutForCount(12).id).toBe('grid6')
  })
})

describe('neighbor', () => {
  it('moves across columns and stops at the edge', () => {
    const cols3 = getLayout('cols3')
    expect(neighbor(cols3, 0, 'right')).toBe(1)
    expect(neighbor(cols3, 1, 'right')).toBe(2)
    expect(neighbor(cols3, 2, 'right')).toBe(2)
    expect(neighbor(cols3, 1, 'left')).toBe(0)
    expect(neighbor(cols3, 1, 'up')).toBe(1)
  })

  it('moves in a two by two grid', () => {
    const grid = getLayout('grid4')
    expect(neighbor(grid, 0, 'down')).toBe(2)
    expect(neighbor(grid, 3, 'up')).toBe(1)
    expect(neighbor(grid, 3, 'left')).toBe(2)
  })

  it('moves from a tall cell to the nearest cell on its side', () => {
    const main2 = getLayout('main2')
    expect(neighbor(main2, 0, 'right')).toBe(1)
    expect(neighbor(main2, 2, 'left')).toBe(0)
    expect(neighbor(main2, 1, 'down')).toBe(2)
  })
})
