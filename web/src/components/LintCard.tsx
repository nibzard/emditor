// ABOUTME: A small card under a lint finding: the rule, its message, and the actions Keep this, Rewrite, and Rules.
// ABOUTME: It closes on Escape, on a click outside, and when the pane scrolls.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { type Finding, RULE_NAMES } from '../lib/lint'

type Props = {
  finding: Finding
  /** The box of the finding's mark on the screen. */
  box: DOMRect
  /** Null when rewrites are off. */
  onRewrite: (() => void) | null
  rewriting: boolean
  onKeep: () => void
  onRules: () => void
  onClose: () => void
}

const WIDTH = 280

export function LintCard({ finding, box, onRewrite, rewriting, onKeep, onRules, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const close = () => onCloseRef.current()
    const onOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (!ref.current?.contains(target) && !target.closest('[data-lint]')) close()
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
    <div ref={ref} className="lint-card" role="dialog" aria-label={RULE_NAMES[finding.rule]} style={{ ...style, width: WIDTH }}>
      <p className="lint-card-rule">{RULE_NAMES[finding.rule]}</p>
      <p className="lint-card-message">{finding.message}</p>
      <footer className="lint-card-actions">
        {onRewrite && (
          <button type="button" className="text-btn" disabled={rewriting} onClick={onRewrite}>
            {rewriting ? 'Rewriting…' : 'Rewrite'}
          </button>
        )}
        <button type="button" className="text-btn" onClick={onKeep} title="Do not mark this again in this sentence">Keep this</button>
        <button type="button" className="text-btn" onClick={onRules}>Rules…</button>
      </footer>
    </div>,
    document.body,
  )
}
