// ABOUTME: The colour theme choice: follow the system, or always light or dark.
// ABOUTME: Pure functions, so the theme button and the page attribute agree.

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice === 'light' || choice === 'dark') return choice
  return systemDark ? 'dark' : 'light'
}

const ORDER: ThemeChoice[] = ['system', 'light', 'dark']

export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]
}
