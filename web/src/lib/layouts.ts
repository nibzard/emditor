// ABOUTME: Pane layouts for the workspace: one pane, columns, rows, and grids.
// ABOUTME: Each layout is a grid of cells; helpers find neighbours for keyboard focus moves.

export type LayoutId = 'single' | 'cols2' | 'cols3' | 'grid4' | 'main2' | 'rows2' | 'grid6'

export type Cell = { col: number; row: number; w: number; h: number }

export type Layout = {
  id: LayoutId
  label: string
  cols: number
  rows: number
  cells: Cell[]
}

const c = (col: number, row: number, w = 1, h = 1): Cell => ({ col, row, w, h })

/** The order of this list gives the shortcut: ⌥1 is the first layout, ⌥2 the second, and so on. */
export const LAYOUTS: Layout[] = [
  { id: 'single', label: 'One', cols: 1, rows: 1, cells: [c(0, 0)] },
  { id: 'cols2', label: 'Two side by side', cols: 2, rows: 1, cells: [c(0, 0), c(1, 0)] },
  { id: 'cols3', label: 'Three side by side', cols: 3, rows: 1, cells: [c(0, 0), c(1, 0), c(2, 0)] },
  { id: 'grid4', label: 'Two up, two down', cols: 2, rows: 2, cells: [c(0, 0), c(1, 0), c(0, 1), c(1, 1)] },
  { id: 'main2', label: 'One and two', cols: 2, rows: 2, cells: [c(0, 0, 1, 2), c(1, 0), c(1, 1)] },
  { id: 'rows2', label: 'One above the other', cols: 1, rows: 2, cells: [c(0, 0), c(0, 1)] },
  {
    id: 'grid6',
    label: 'Three up, three down',
    cols: 3,
    rows: 2,
    cells: [c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1)],
  },
]

export const MAX_PANES = Math.max(...LAYOUTS.map((l) => l.cells.length))

export function getLayout(id: LayoutId): Layout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]
}

/** The simplest layout that shows this number of documents. */
export function layoutForCount(count: number): Layout {
  if (count <= 1) return getLayout('single')
  if (count === 2) return getLayout('cols2')
  if (count === 3) return getLayout('cols3')
  if (count === 4) return getLayout('grid4')
  return getLayout('grid6')
}

export type Direction = 'left' | 'right' | 'up' | 'down'

/** The index of the nearest cell in a direction, or the same index when there is none. */
export function neighbor(layout: Layout, index: number, dir: Direction): number {
  const center = (cell: Cell) => ({ x: cell.col + cell.w / 2, y: cell.row + cell.h / 2 })
  const from = layout.cells[index]
  if (!from) return index
  const a = center(from)
  let best = index
  let bestScore = Infinity
  layout.cells.forEach((cell, i) => {
    if (i === index) return
    const b = center(cell)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (main <= 0.01) return
    const score = main + side * 2
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}
