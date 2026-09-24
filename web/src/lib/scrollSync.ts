// ABOUTME: Scroll lock for panes. When it is on, scrolling one pane scrolls all others by the same distance.
// ABOUTME: It moves by distance, not by ratio, so panes keep the offset they had when the lock started.

export type Scroller = Pick<
  HTMLElement,
  'scrollTop' | 'scrollHeight' | 'clientHeight' | 'addEventListener' | 'removeEventListener'
>

export class ScrollSync {
  enabled = false
  private scrollers = new Set<Scroller>()
  private last = new Map<Scroller, number>()
  private expected = new Map<Scroller, number>()

  add(el: Scroller): () => void {
    const handler = () => this.onScroll(el)
    this.scrollers.add(el)
    this.last.set(el, el.scrollTop)
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
      this.scrollers.delete(el)
      this.last.delete(el)
      this.expected.delete(el)
    }
  }

  /** Scrolls one pane without moving the others, for example to restore a position. */
  set(el: Scroller, top: number) {
    el.scrollTop = top
    this.expected.set(el, el.scrollTop)
    this.last.set(el, el.scrollTop)
  }

  onScroll(el: Scroller) {
    const top = el.scrollTop
    const expected = this.expected.get(el)
    if (expected !== undefined) {
      this.expected.delete(el)
      // This event comes from our own change to scrollTop. Do not send it on.
      if (Math.abs(expected - top) < 1) {
        this.last.set(el, top)
        return
      }
    }
    const delta = top - (this.last.get(el) ?? top)
    this.last.set(el, top)
    if (!this.enabled || delta === 0) return
    for (const other of this.scrollers) {
      if (other === el) continue
      const max = Math.max(0, other.scrollHeight - other.clientHeight)
      const next = Math.max(0, Math.min(max, other.scrollTop + delta))
      if (Math.abs(next - other.scrollTop) < 0.5) continue
      this.expected.set(other, next)
      this.last.set(other, next)
      other.scrollTop = next
    }
  }
}
