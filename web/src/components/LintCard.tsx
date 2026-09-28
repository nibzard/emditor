// ABOUTME: A small card under a lint finding: the rule, its message, and the actions Rewrite, Keep this, Allow, and Rules.
// ABOUTME: It closes on Escape, on a click outside, and when the pane scrolls.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  /** The name of the rule. */
  title: string
  message: string
  /** Extra information, for example the probability of a semantic finding. */
  detail?: string
  /** The box of the finding's mark on the screen. */
  box: DOMRect
  /** Null when rewrites are off. */
  onRewrite: (() => void) | null
  rewriting: boolean
  onKeep: () => void
  /** Saves the text as an allow example of the rule; only for semantic rules. */
  onAllow?: () => void
  onRules: () => void
  onClose: () => void
}

const WIDTH = 280

export function LintCard({ title, message, detail, box, onRewrite, rewriting, onKeep, onAllow, onRules, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const close = () => onCloseRef.current()
    const onOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (!ref.current?.contains(target) && !target.closest('[data-lint], [data-semantic]')) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', close, true)
    }
  }, [])

  const left = Math.max(8, Math.min(box.left, window.innerWidth - WIDTH - 8))
  const below = box.bottom + 8 + 140 < window.innerHeight
  const style = below ? { left, top: box.bottom + 6 } : { left, bottom: window.innerHeight - box.top + 6 }

  return createPortal(
    <div ref={ref} className="lint-card" role="dialog" aria-label={title} style={{ ...style, width: WIDTH }}>
      <p className="lint-card-rule">{title}</p>
      <p className="lint-card-message">{message}</p>
      {detail && <p className="lint-card-detail">{detail}</p>}
      <footer className="lint-card-actions">
        {onRewrite && (
          <button type="button" className="text-btn" disabled={rewriting} onClick={onRewrite}>
            {rewriting ? 'Rewriting…' : 'Rewrite'}
          </button>
        )}
        <button type="button" className="text-btn" onClick={onKeep} title="Do not mark this text again">Keep this</button>
        {onAllow && (
          <button type="button" className="text-btn" onClick={onAllow} title="Save this text as an example that the rule allows">Allow writing like this</button>
        )}
        <button type="button" className="text-btn" onClick={onRules}>Rules…</button>
      </footer>
    </div>,
    document.body,
  )
}
