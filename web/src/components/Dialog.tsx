// ABOUTME: Shared modal behavior for find, create, shortcuts, and stack details.
// ABOUTME: Keeps keyboard focus inside the dialog and returns it to the opening control.

import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

type Props = { title: string; onClose: () => void; children: ReactNode | ((dismiss: () => void) => ReactNode); className?: string }

export function Dialog({ title, onClose, children, className = 'sheet-panel' }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const restoreFocus = useRef(false)
  const dismiss = () => { restoreFocus.current = true; close.current() }
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = panel.current
    node?.querySelector<HTMLElement>('[data-autofocus], input, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissRef.current()
      }
      if (event.key !== 'Tab' || !node) return
      const items = [...node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
        .filter((item) => item.getClientRects().length > 0)
      if (items.length === 0) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
        event.preventDefault()
        items[0].focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (restoreFocus.current) previous?.focus({ preventScroll: true })
      else requestAnimationFrame(() => {
        if (document.querySelector('[role="dialog"]')) return
        document.querySelector<HTMLElement>('.pane[data-focused="true"] .ProseMirror, .pane[data-focused="true"] .cm-content')?.focus({ preventScroll: true })
      })
    }
  }, [])

  return createPortal(
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => {
      if (event.target === event.currentTarget) dismiss()
    }}>
      <motion.div ref={panel} className={className} role="dialog" aria-modal="true" aria-label={title}
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
        {typeof children === 'function' ? children(dismiss) : children}
      </motion.div>
    </motion.div>,
    document.body,
  )
}
