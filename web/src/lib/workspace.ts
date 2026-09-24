// ABOUTME: The workspace model: a layout, its panes, the focused pane, and scroll lock.
// ABOUTME: A pure reducer; documents that a smaller layout hides go to a shelf and come back later.

import { type Direction, getLayout, type LayoutId, layoutForCount, MAX_PANES, neighbor } from './layouts'

export type Mode = 'rich' | 'source'

export type PaneState = { id: string; path: string | null; mode: Mode }

export type Work = {
  layout: LayoutId
  panes: PaneState[]
  focus: number
  lock: boolean
  shelf: string[]
  defaultMode: Mode
}

/** Where to open a document: the focused pane, the first empty pane, a new pane, or a pane index. */
export type OpenTarget = 'focused' | 'slot' | 'new' | number

export type WorkAction =
  | { type: 'layout'; id: LayoutId }
  | { type: 'open'; path: string; where: OpenTarget }
  | { type: 'openMany'; paths: string[] }
  | { type: 'close'; index: number }
  | { type: 'focus'; index: number }
  | { type: 'focusDir'; dir: Direction }
  | { type: 'moveDir'; dir: Direction }
  | { type: 'mode'; index: number; mode: Mode }
  | { type: 'toggleMode' }
  | { type: 'lock' }
  | { type: 'prune'; existing: string[] }

const SHELF_SIZE = 12

let paneCounter = 0
export function newPane(path: string | null, mode: Mode): PaneState {
  paneCounter += 1
  return { id: `pane-${Date.now().toString(36)}-${paneCounter}`, path, mode }
}

export function initialWork(): Work {
  return { layout: 'single', panes: [newPane(null, 'rich')], focus: 0, lock: false, shelf: [], defaultMode: 'rich' }
}

function pushShelf(shelf: string[], paths: string[]): string[] {
  const unique = [...new Set(paths)]
  return [...unique, ...shelf.filter((p) => !unique.includes(p))].slice(0, SHELF_SIZE)
}

function pad(panes: PaneState[], count: number, mode: Mode): PaneState[] {
  const next = panes.slice(0, count)
  while (next.length < count) next.push(newPane(null, mode))
  return next
}

/** Puts shelved documents into empty panes. */
function fillFromShelf(panes: PaneState[], shelf: string[]) {
  let rest = shelf.filter((p) => !panes.some((pane) => pane.path === p))
  const filled = panes.map((pane) => {
    if (pane.path || rest.length === 0) return pane
    const [path, ...others] = rest
    rest = others
    return { ...pane, path }
  })
  return { panes: filled, shelf: rest }
}

function setLayout(w: Work, id: LayoutId): Work {
  const count = getLayout(id).cells.length
  const focused = w.panes[w.focus]
  let panes: PaneState[]
  let shelf = w.shelf
  if (count < w.panes.length) {
    let keep = w.panes.filter((p) => p.path).slice(0, count)
    if (focused?.path && !keep.includes(focused)) keep = [...keep.slice(0, count - 1), focused]
    keep = w.panes.filter((p) => keep.includes(p))
    const dropped = w.panes.filter((p) => !keep.includes(p) && p.path).map((p) => p.path!)
    shelf = pushShelf(shelf, dropped)
    panes = pad(keep, count, w.defaultMode)
  } else {
    panes = pad(w.panes, count, w.defaultMode)
  }
  const filled = fillFromShelf(panes, shelf)
  const focus = Math.max(0, filled.panes.indexOf(focused))
  return { ...w, layout: id, panes: filled.panes, shelf: filled.shelf, focus }
}

function open(w: Work, path: string, where: OpenTarget): Work {
  // A new pane can show a document that another pane already shows, to see two parts of it.
  const existing = where === 'new' ? -1 : w.panes.findIndex((p) => p.path === path)
  if (existing >= 0) return { ...w, focus: existing }
  const filled = w.panes.filter((p) => p.path)
  if (where === 'new' && filled.length < MAX_PANES) {
    const layout = layoutForCount(filled.length + 1)
    const panes = pad([...filled, newPane(path, w.defaultMode)], layout.cells.length, w.defaultMode)
    return { ...w, layout: layout.id, panes, focus: filled.length }
  }
  const empty = w.panes.findIndex((p) => !p.path)
  const target =
    typeof where === 'number' ? where : where === 'slot' && empty >= 0 ? empty : Math.min(w.focus, w.panes.length - 1)
  const old = w.panes[target]?.path
  const panes = w.panes.map((p, i) => (i === target ? { ...p, path } : p))
  return { ...w, panes, focus: target, shelf: old ? pushShelf(w.shelf, [old]) : w.shelf }
}

function openMany(w: Work, paths: string[]): Work {
  const all = [...new Set(paths)]
  const unique = all.slice(0, MAX_PANES)
  if (unique.length === 0) return w
  const layout = layoutForCount(unique.length)
  const reused = (path: string) => w.panes.find((p) => p.path === path) ?? newPane(path, w.defaultMode)
  const panes = pad(unique.map(reused), layout.cells.length, w.defaultMode)
  const hidden = w.panes.filter((p) => p.path && !unique.includes(p.path)).map((p) => p.path!)
  return { ...w, layout: layout.id, panes, focus: 0, shelf: pushShelf(w.shelf, [...all.slice(MAX_PANES), ...hidden]) }
}

function close(w: Work, index: number): Work {
  const rest = w.panes.filter((p, i) => i !== index && p.path)
  const layout = layoutForCount(Math.max(1, rest.length))
  const panes = pad(rest, layout.cells.length, w.defaultMode)
  return { ...w, layout: layout.id, panes, focus: Math.min(index, panes.length - 1) }
}

function moveDir(w: Work, dir: Direction): Work {
  const target = neighbor(getLayout(w.layout), w.focus, dir)
  if (target === w.focus) return w
  const panes = [...w.panes]
  ;[panes[w.focus], panes[target]] = [panes[target], panes[w.focus]]
  return { ...w, panes, focus: target }
}

export function workReducer(w: Work, action: WorkAction): Work {
  switch (action.type) {
    case 'layout':
      return setLayout(w, action.id)
    case 'open':
      return open(w, action.path, action.where)
    case 'openMany':
      return openMany(w, action.paths)
    case 'close':
      return close(w, action.index)
    case 'focus':
      return action.index >= 0 && action.index < w.panes.length ? { ...w, focus: action.index } : w
    case 'focusDir':
      return { ...w, focus: neighbor(getLayout(w.layout), w.focus, action.dir) }
    case 'moveDir':
      return moveDir(w, action.dir)
    case 'mode':
      return {
        ...w,
        defaultMode: action.mode,
        panes: w.panes.map((p, i) => (i === action.index ? { ...p, mode: action.mode } : p)),
      }
    case 'toggleMode': {
      const pane = w.panes[w.focus]
      if (!pane) return w
      return workReducer(w, { type: 'mode', index: w.focus, mode: pane.mode === 'rich' ? 'source' : 'rich' })
    }
    case 'lock':
      return { ...w, lock: !w.lock }
    case 'prune': {
      const exists = new Set(action.existing)
      return {
        ...w,
        panes: w.panes.map((p) => (p.path && !exists.has(p.path) ? { ...p, path: null } : p)),
        shelf: w.shelf.filter((p) => exists.has(p)),
      }
    }
  }
}
