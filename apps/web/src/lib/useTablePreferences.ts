import { useEffect, useMemo, useState } from 'react'

type Updater<T> = T | ((previous: T) => T)

const PREFIX = '85percent:table-preferences:v1'

function storageKey(clubId: string, table: string): string {
  return `${PREFIX}:${clubId}:${table}`
}

function read<T>(key: string | null, defaults: T, isValid: (value: unknown) => value is T): T {
  if (!key || typeof window === 'undefined') return defaults
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return defaults
    const value: unknown = JSON.parse(raw)
    return isValid(value) ? value : defaults
  } catch {
    return defaults
  }
}

/**
 * Stores only durable table controls. A new club key pauses the table until its
 * own validated preferences have been restored, avoiding a visible default sort
 * before the selected view appears.
 */
export function useTablePreferences<T extends object>(
  table: string,
  clubId: string | null,
  defaults: T,
  isValid: (value: unknown) => value is T,
) {
  const key = useMemo(() => (clubId ? storageKey(clubId, table) : null), [clubId, table])
  const [state, setState] = useState<{ key: string | null; value: T }>(() => ({
    key,
    value: read(key, defaults, isValid),
  }))

  const ready = state.key === key

  useEffect(() => {
    if (state.key !== key) setState({ key, value: read(key, defaults, isValid) })
  }, [defaults, isValid, key, state.key])

  useEffect(() => {
    if (!ready || !key || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, JSON.stringify(state.value))
    } catch {
      // Preferences are an enhancement; private-mode/storage failures are safe.
    }
  }, [key, ready, state.value])

  const setValue = (updater: Updater<T>) => {
    setState((current) => ({
      ...current,
      value: typeof updater === 'function' ? (updater as (previous: T) => T)(current.value) : updater,
    }))
  }

  const isDefault = JSON.stringify(state.value) === JSON.stringify(defaults)
  const reset = () => setValue(defaults)

  return { value: state.value, setValue, reset, isDefault, ready }
}
