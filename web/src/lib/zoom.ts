// ABOUTME: Zoom steps for the paper and its text in the workspace.
// ABOUTME: A pure step function, so the keys and the buttons move through the same values.

export const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

/** The next zoom step in the direction; a value between steps goes to the nearest step in that direction. */
export function zoomStep(current: number, direction: 1 | -1): number {
  const value = Number.isFinite(current) ? current : 1
  if (direction > 0) return ZOOM_STEPS.find((step) => step > value + 1e-6) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((step) => step < value - 1e-6) ?? MIN_ZOOM
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}
