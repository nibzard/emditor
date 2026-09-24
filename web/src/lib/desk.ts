// ABOUTME: The desk model: documents and stacks of documents, sorted by name, date, or by hand.
// ABOUTME: All functions are pure; they take the desk state and return a new one.

import type { FileEntry } from '../api'
import { titleFromPath } from './text'

export type SortMode = 'name' | 'recent' | 'manual'

export type Stack = { id: string; paths: string[] }

export type DeskState = { sort: SortMode; order: string[]; stacks: Stack[] }

export type DeskItem =
  | { kind: 'doc'; key: string; file: FileEntry }
  | { kind: 'stack'; key: string; stack: Stack; files: FileEntry[] }

export const EMPTY_DESK: DeskState = { sort: 'recent', order: [], stacks: [] }

export const docKey = (path: string) => `doc:${path}`

export function itemPaths(item: DeskItem): string[] {
  return item.kind === 'doc' ? [item.file.path] : item.stack.paths
}

function itemName(item: DeskItem): string {
  return titleFromPath(itemPaths(item)[0]).toLowerCase()
}

function itemModified(item: DeskItem): number {
  return item.kind === 'doc' ? item.file.modified : Math.max(...item.files.map((f) => f.modified))
}

/** Makes the list of desk items from the files on disk. A stack needs two or more files that exist. */
export function buildDesk(files: FileEntry[], state: DeskState): DeskItem[] {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const used = new Set<string>()
  const items: DeskItem[] = []
  for (const stack of state.stacks) {
    const paths = stack.paths.filter((p) => byPath.has(p) && !used.has(p))
    if (paths.length < 2) continue
    paths.forEach((p) => used.add(p))
    items.push({ kind: 'stack', key: stack.id, stack: { ...stack, paths }, files: paths.map((p) => byPath.get(p)!) })
  }
  for (const file of files) {
    if (!used.has(file.path)) items.push({ kind: 'doc', key: docKey(file.path), file })
  }
  return sortItems(items, state)
}

function sortItems(items: DeskItem[], state: DeskState): DeskItem[] {
  const byName = (a: DeskItem, b: DeskItem) => itemName(a).localeCompare(itemName(b), undefined, { numeric: true })
  const byRecent = (a: DeskItem, b: DeskItem) => itemModified(b) - itemModified(a)
  if (state.sort === 'name') return [...items].sort(byName)
  if (state.sort === 'recent') return [...items].sort(byRecent)
  const rank = new Map(state.order.map((key, i) => [key, i]))
  return [...items].sort((a, b) => {
    const ra = rank.get(a.key) ?? Infinity
    const rb = rank.get(b.key) ?? Infinity
    return ra === rb ? byRecent(a, b) : ra - rb
  })
}

function newStackId(): string {
  return `stack:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Puts items together in one stack. The stack takes the place of the first key. */
export function stackItems(state: DeskState, items: DeskItem[], keys: string[]): DeskState {
  const chosen = keys.map((k) => items.find((i) => i.key === k)).filter((i): i is DeskItem => !!i)
  if (chosen.length < 2) return state
  const paths = [...new Set(chosen.flatMap(itemPaths))]
  const oldStackIds = new Set(chosen.filter((i) => i.kind === 'stack').map((i) => i.key))
  const id = chosen.find((i) => i.kind === 'stack')?.key ?? newStackId()
  const chosenKeys = new Set(chosen.map((i) => i.key))
  const order = items.flatMap((i) => (i.key === chosen[0].key ? [id] : chosenKeys.has(i.key) ? [] : [i.key]))
  return {
    ...state,
    order,
    stacks: [...state.stacks.filter((s) => !oldStackIds.has(s.id)), { id, paths }],
  }
}

/** Takes a stack apart. Its documents go back to the desk where the stack was. */
export function unstack(state: DeskState, items: DeskItem[], stackId: string): DeskState {
  const stack = state.stacks.find((s) => s.id === stackId)
  if (!stack) return state
  const order = items.flatMap((i) => (i.key === stackId ? itemPaths(i).map(docKey) : [i.key]))
  return { ...state, order, stacks: state.stacks.filter((s) => s.id !== stackId) }
}

/** Moves one item before or after another and changes to manual sorting. */
export function moveItem(
  state: DeskState,
  items: DeskItem[],
  key: string,
  targetKey: string,
  side: 'before' | 'after',
): DeskState {
  if (key === targetKey) return state
  const keys = items.map((i) => i.key).filter((k) => k !== key)
  const at = keys.indexOf(targetKey)
  if (at < 0) return state
  keys.splice(side === 'before' ? at : at + 1, 0, key)
  return { ...state, sort: 'manual', order: keys }
}

/** Moves one item some places forward or back and changes to manual sorting. */
export function moveBy(state: DeskState, items: DeskItem[], key: string, delta: number): DeskState {
  const keys = items.map((i) => i.key)
  const from = keys.indexOf(key)
  if (from < 0) return state
  const to = Math.max(0, Math.min(keys.length - 1, from + delta))
  keys.splice(from, 1)
  keys.splice(to, 0, key)
  return { ...state, sort: 'manual', order: keys }
}
