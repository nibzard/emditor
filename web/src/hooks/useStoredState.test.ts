// ABOUTME: Tests for reading stored state through a shape validator.
// ABOUTME: Empty storage, broken JSON, blocked storage, and rejected shapes all give the fallback.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBoolean } from '../lib/stored'
import { readStored } from './useStoredState'

function memoryStorage(initial: Record<string, string> = {}) {
  const memory = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('readStored', () => {
  it('returns the stored value when the validator accepts it', () => {
    vi.stubGlobal('localStorage', memoryStorage({ flag: 'false', note: '"yes"' }))
    expect(readStored('flag', true, parseBoolean)).toBe(false)
    expect(readStored('note', 'no', (raw) => (raw === 'yes' || raw === 'no' ? raw : null))).toBe('yes')
  })

  it('returns the fallback when the validator rejects the stored value', () => {
    vi.stubGlobal('localStorage', memoryStorage({ flag: '"yes"' }))
    expect(readStored('flag', true, parseBoolean)).toBe(true)
  })

  it('returns the fallback for an empty key, broken JSON, and blocked storage', () => {
    vi.stubGlobal('localStorage', memoryStorage({ broken: '{' }))
    expect(readStored('absent', false, parseBoolean)).toBe(false)
    expect(readStored('broken', true, parseBoolean)).toBe(true)
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readStored('flag', false, parseBoolean)).toBe(false)
  })

  it('returns the stored value as-is when no validator is given', () => {
    vi.stubGlobal('localStorage', memoryStorage({ plain: '[1,2]' }))
    expect(readStored<number[]>('plain', [])).toEqual([1, 2])
    expect(readStored('absent', 'fallback')).toBe('fallback')
  })
})
