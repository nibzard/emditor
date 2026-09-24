// ABOUTME: Small line icons drawn as inline SVG.
// ABOUTME: They use currentColor so that they follow the text colour.

import { motion } from 'motion/react'
import type { ReactNode } from 'react'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon size={14}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Icon>
)

export const MinusIcon = () => (
  <Icon>
    <path d="M3.5 8h9" />
  </Icon>
)

export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <Icon>
      <rect x="3.5" y="7.25" width="9" height="6.25" rx="1.5" />
      <motion.path
        d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75"
        initial={false}
        animate={{ y: locked ? 0 : -1.6, x: locked ? 0 : 2.2, rotate: locked ? 0 : 14 }}
        transition={{ type: 'spring', stiffness: 520, damping: 22 }}
        style={{ originX: '10.5px', originY: '7.25px' }}
      />
    </Icon>
  )
}
