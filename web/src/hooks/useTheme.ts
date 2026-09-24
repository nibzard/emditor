// ABOUTME: The colour theme of the app: the stored choice, the system setting, and the page attribute.
// ABOUTME: The choice is the same for all folders, because it belongs to the person, not to a folder.

import { useEffect, useState } from 'react'
import { resolveTheme, type ThemeChoice } from '../lib/theme'
import { useStoredState } from './useStoredState'

export const THEME_KEY = 'emditor.theme'

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export function useTheme() {
  const [choice, setChoice] = useStoredState<ThemeChoice>(THEME_KEY, 'system')
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches)
  useEffect(() => {
    const query = darkQuery()
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const theme = resolveTheme(choice, systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return { choice, setChoice, theme }
}
