// ABOUTME: Tests for the text and path helpers.
// ABOUTME: They cover titles, word counts, new-file names, and asset URLs.

import { describe, expect, it } from 'vitest'
import { dirOf, fuzzyScore, normalizeNewPath, resolveAsset, timeAgo, titleFromPath, wordCount } from './text'

describe('titleFromPath and dirOf', () => {
  it('split a path into folder and title', () => {
    expect(titleFromPath('notes/Big Idea.md')).toBe('Big Idea')
    expect(titleFromPath('a.markdown')).toBe('a')
    expect(dirOf('notes/deep/x.md')).toBe('notes/deep')
    expect(dirOf('x.md')).toBe('')
  })
})

describe('wordCount', () => {
  it('counts words and ignores Markdown syntax and code blocks', () => {
    expect(wordCount('# Hello world\n\n- one *two*\n\n```\nlet x = 1\n```')).toBe(4)
    expect(wordCount('[link text](http://x.y/z) ![img](a.png)')).toBe(2)
    expect(wordCount('')).toBe(0)
  })
})

describe('normalizeNewPath', () => {
  it('adds the extension and removes unsafe parts', () => {
    expect(normalizeNewPath('  My note ')).toBe('My note.md')
    expect(normalizeNewPath('../x/./y.markdown')).toBe('x/y.markdown')
    expect(normalizeNewPath('/abs\\path')).toBe('abs/path.md')
    expect(normalizeNewPath('  / ')).toBe('')
  })
})

describe('resolveAsset', () => {
  it('resolves relative targets against the document folder', () => {
    expect(resolveAsset('notes/a.md', 'img/p 1.png')).toBe('/files/notes/img/p%201.png')
    expect(resolveAsset('notes/a.md', '../top.png')).toBe('/files/top.png')
    expect(resolveAsset('notes/a.md', '/root.png')).toBe('/files/root.png')
  })

  it('keeps absolute URLs as they are', () => {
    expect(resolveAsset('a.md', 'https://x.y/p.png')).toBe('https://x.y/p.png')
    expect(resolveAsset('a.md', 'data:image/png;base64,xx')).toBe('data:image/png;base64,xx')
    expect(resolveAsset('a.md', '#anchor')).toBe('#anchor')
  })
})

describe('timeAgo', () => {
  it('gives a short relative time', () => {
    const now = 1_000_000_000_000
    expect(timeAgo(now - 10_000, now)).toBe('just now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min. ago')
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3 days ago')
  })
})

describe('fuzzyScore', () => {
  it('matches letters in order and likes matches in the file name', () => {
    expect(fuzzyScore('abc', 'xaxbxc.md')).not.toBeNull()
    expect(fuzzyScore('cba', 'abc.md')).toBeNull()
    expect(fuzzyScore('', 'any.md')).toBe(0)
    expect(fuzzyScore('plan', 'plan/notes.md')!).toBeGreaterThan(fuzzyScore('plan', 'notes/plan.md')!)
  })
})
