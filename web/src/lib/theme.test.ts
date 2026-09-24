// ABOUTME: Tests for the colour theme choice.
// ABOUTME: They cover how the choice follows the system and the order of the theme button.

import { describe, expect, it } from 'vitest'
import { nextTheme, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('follows the system when the choice is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('keeps an explicit choice', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('treats an unknown stored value as system', () => {
    expect(resolveTheme('sepia' as never, true)).toBe('dark')
  })
})

describe('nextTheme', () => {
  it('goes system, light, dark, and back to system', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })
})
