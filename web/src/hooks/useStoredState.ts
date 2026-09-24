// ABOUTME: React state that is kept in localStorage for this browser.
// ABOUTME: It falls back to the default value when storage is empty, broken, or blocked.

import { useEffect, useState } from 'react'

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Storage is not available. The value stays in memory only.
    }
  }, [key, value])
  return [value, setValue] as const
}
