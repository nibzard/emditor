// ABOUTME: Tests for the pane scroll lock.
// ABOUTME: They use simple scroller objects in place of DOM elements.

import { describe, expect, it } from 'vitest'
import { ScrollSync, type Scroller } from './scrollSync'

function scroller(scrollHeight = 2000, clientHeight = 500): Scroller {
  return { scrollTop: 0, scrollHeight, clientHeight, addEventListener() {}, removeEventListener() {} }
}

describe('ScrollSync', () => {
  it('does nothing while it is off', () => {
    const sync = new ScrollSync()
    const a = scroller()
    const b = scroller()
    sync.add(a)
    sync.add(b)
    a.scrollTop = 100
    sync.onScroll(a)
    expect(b.scrollTop).toBe(0)
  })

  it('moves other panes by the same distance and keeps their offset', () => {
    const sync = new ScrollSync()
    const a = scroller()
    const b = scroller()
    sync.add(a)
    sync.add(b)
    b.scrollTop = 300
    sync.onScroll(b)
    sync.enabled = true
    a.scrollTop = 120
    sync.onScroll(a)
    expect(b.scrollTop).toBe(420)
  })

  it('ignores the scroll event that its own change causes', () => {
    const sync = new ScrollSync()
    sync.enabled = true
    const a = scroller()
    const b = scroller()
    sync.add(a)
    sync.add(b)
    a.scrollTop = 50
    sync.onScroll(a)
    sync.onScroll(b)
    expect(a.scrollTop).toBe(50)
    expect(b.scrollTop).toBe(50)
  })

  it('stops at the end of a shorter pane', () => {
    const sync = new ScrollSync()
    sync.enabled = true
    const a = scroller(5000)
    const b = scroller(700)
    sync.add(a)
    sync.add(b)
    a.scrollTop = 1000
    sync.onScroll(a)
    expect(b.scrollTop).toBe(200)
  })

  it('forgets a pane after it is removed', () => {
    const sync = new ScrollSync()
    sync.enabled = true
    const a = scroller()
    const b = scroller()
    sync.add(a)
    const remove = sync.add(b)
    remove()
    a.scrollTop = 80
    sync.onScroll(a)
    expect(b.scrollTop).toBe(0)
  })
})
