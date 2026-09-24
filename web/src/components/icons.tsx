// ABOUTME: Line icons for the app chrome: Lucide icons with one size and stroke, plus a custom lock.
// ABOUTME: They use currentColor so that they follow the text colour.

import {
  ArrowLeft, Bold, Code, FilePlus, LayoutGrid, Heading1, Heading2, Italic, Keyboard, LayoutPanelLeft,
  Columns2, Link, List, type LucideIcon, Maximize2, Minimize2, Minus, Monitor, Moon, Sun, ZoomIn, ZoomOut, PanelLeft, Pilcrow, Plus, Search, SquareSplitHorizontal,
  Type, X,
} from 'lucide-react'
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
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function lucide(Glyph: LucideIcon, size = 16) {
  return () => <Glyph size={size} strokeWidth={1.5} aria-hidden />
}

export const PlusIcon = lucide(Plus)
export const MinusIcon = lucide(Minus)
export const CloseIcon = lucide(X, 14)
export const SearchIcon = lucide(Search)
export const NewDocumentIcon = lucide(FilePlus)
export const OpenBesideIcon = lucide(SquareSplitHorizontal)
export const ArrangeIcon = lucide(LayoutPanelLeft)
export const FocusIcon = lucide(Maximize2)
export const ExitFocusIcon = lucide(Minimize2)
export const ShortcutsIcon = lucide(Keyboard)
export const SidebarIcon = lucide(PanelLeft)
export const BackIcon = lucide(ArrowLeft)
export const DeskIcon = lucide(LayoutGrid)
export const ZoomInIcon = lucide(ZoomIn)
export const ZoomOutIcon = lucide(ZoomOut)
export const SystemThemeIcon = lucide(Monitor)
export const LightThemeIcon = lucide(Sun)
export const DarkThemeIcon = lucide(Moon)
export const SplitIcon = lucide(Columns2)
export const SourceIcon = lucide(Code)
export const RichIcon = lucide(Type)
export const ParagraphIcon = lucide(Pilcrow, 15)
export const Heading1Icon = lucide(Heading1, 15)
export const Heading2Icon = lucide(Heading2, 15)
export const BulletsIcon = lucide(List, 15)
export const BoldIcon = lucide(Bold, 15)
export const ItalicIcon = lucide(Italic, 15)
export const LinkIcon = lucide(Link, 15)

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
