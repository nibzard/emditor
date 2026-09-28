// ABOUTME: React state that is kept in localStorage for this browser.
// ABOUTME: It falls back to the default value when storage is empty, broken, blocked, or in an unknown shape.

import { useEffect, useState } from 'react'

/** A parser returns the value in the current shape, or null when the fallback must apply. */
export type StoredParser<T> = (raw: unknown) => T | null

export function readStored<T>(key: string, fallback: T, parse?: StoredParser<T>): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value = parse ? parse(JSON.parse(raw)) : (JSON.parse(raw) as T)
    return value === null ? fallback : value
  } catch {
    return fallback
  }
}

export function useStoredState<T>(key: string, fallback: T, parse?: StoredParser<T>) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback, parse))
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Storage is not available. The value stays in memory only.
    }
  }, [key, value])
  return [value, setValue] as const
}
