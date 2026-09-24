// ABOUTME: An ensō, a brush circle that draws itself once.
// ABOUTME: It marks empty and quiet places in the app.

import { motion } from 'motion/react'

export function Enso({ size = 84 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden className="enso">
      <motion.path
        d="M57 13 C80 17 92 36 89 57 C86 78 67 91 47 89 C26 87 11 70 12 49 C13 31 25 17 43 13"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.85 }}
        transition={{ pathLength: { duration: 1.6, ease: [0.6, 0, 0.2, 1] }, opacity: { duration: 0.3 } }}
      />
    </svg>
  )
}
