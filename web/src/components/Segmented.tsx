// ABOUTME: A segmented control with a pill that slides to the chosen option.
// ABOUTME: Used for edit mode, desk sorting, and the desk or workspace switch.

import { motion } from 'motion/react'
import type { ReactNode } from 'react'

type Option<T extends string> = { value: T; label: ReactNode; title?: string }

type Props<T extends string> = {
  id: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  small?: boolean
}

export const pillSpring = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 } as const

export function Segmented<T extends string>({ id, value, options, onChange, small }: Props<T>) {
  return (
    <div className={small ? 'seg seg-sm' : 'seg'} role="tablist">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            onMouseDown={(e) => e.preventDefault()}
          >
            {active && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={pillSpring} />}
            <span className="seg-label">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
