// ABOUTME: Validators for the state kept in localStorage: workspace, desk, and preferences.
// ABOUTME: A validator returns the value when it matches the current shape, or null so the caller can use its default.

import type { DeskState } from './desk'
import { LAYOUTS, type LayoutId, MAX_PANES } from './layouts'
import type { ThemeChoice } from './theme'
import type { Mode, PaneState, Work } from './workspace'
import { MAX_ZOOM, MIN_ZOOM } from './zoom'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

const LAYOUT_IDS: readonly LayoutId[] = LAYOUTS.map((layout) => layout.id)

const isLayoutId = (value: unknown): value is LayoutId => LAYOUT_IDS.includes(value as LayoutId)

const isMode = (value: unknown): value is Mode => value === 'rich' || value === 'source'

const isPane = (value: unknown): value is PaneState =>
  isRecord(value) && isString(value.id) && (isString(value.path) || value.path === null) && isMode(value.mode)

const isIndex = (value: unknown, length: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length

/** A stored workspace, or null when the value is not a workspace in the current shape. */
export function parseWork(value: unknown): Work | null {
  if (!isRecord(value)) return null
  const { layout, panes, focus, lock, shelf, defaultMode } = value
  if (!isLayoutId(layout)) return null
  if (!Array.isArray(panes) || panes.length === 0 || panes.length > MAX_PANES || !panes.every(isPane)) return null
  if (!isIndex(focus, panes.length)) return null
  if (typeof lock !== 'boolean' || !isMode(defaultMode)) return null
  if (!isStringList(shelf)) return null
  return { layout, panes, focus, lock, shelf, defaultMode }
}

const isStack = (value: unknown): value is { id: string; paths: string[] } =>
  isRecord(value) && isString(value.id) && isStringList(value.paths)

/** A stored desk, or null when the value is not a desk in the current shape. */
export function parseDesk(value: unknown): DeskState | null {
  if (!isRecord(value)) return null
  const { sort, order, stacks } = value
  if (sort !== 'name' && sort !== 'recent' && sort !== 'manual') return null
  if (!isStringList(order) || !Array.isArray(stacks) || !stacks.every(isStack)) return null
  return { sort, order, stacks }
}

/** A stored yes-or-no preference, or null for any other value. */
export function parseBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** A stored theme choice, or null for any other value. */
export function parseThemeChoice(value: unknown): ThemeChoice | null {
  return value === 'system' || value === 'light' || value === 'dark' ? value : null
}

const isNumberBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/** A stored zoom level, or null outside the range that the zoom steps cover. */
export function parseZoom(value: unknown): number | null {
  return isNumberBetween(value, MIN_ZOOM, MAX_ZOOM) ? value : null
}

/** Makes a validator for a stored number between min and max, such as an index into a fixed list. */
export function parseBoundedNumber(min: number, max: number): (value: unknown) => number | null {
  return (value) => (isNumberBetween(value, min, max) ? value : null)
}
