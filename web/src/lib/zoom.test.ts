// ABOUTME: Tests for the paper zoom steps.
// ABOUTME: They cover stepping in and out, the limits, and values that are not on a step.

import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, zoomLabel, zoomStep } from './zoom'

describe('zoomStep', () => {
  it('goes to the next step in and out', () => {
    expect(zoomStep(1, 1)).toBe(1.1)
    expect(zoomStep(1, -1)).toBe(0.9)
  })

  it('stays at the limits', () => {
    expect(zoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(zoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('moves a value between steps to the nearest step in that direction', () => {
    expect(zoomStep(1.05, 1)).toBe(1.1)
    expect(zoomStep(1.05, -1)).toBe(1)
  })

  it('resets a stored value that is not a number', () => {
    expect(zoomStep(Number.NaN, 1)).toBe(1.1)
  })
})

describe('zoomLabel', () => {
  it('shows a whole percent', () => {
    expect(zoomLabel(1.25)).toBe('125%')
    expect(zoomLabel(0.9)).toBe('90%')
  })
})
