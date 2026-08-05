import type { PlayerPosition } from '@85percent/shared'

export const POSITION_ORDER: Record<PlayerPosition, number> = {
  GK: 0,
  DEF: 1,
  MID: 2,
  FWD: 3,
}

type PositionSortable = {
  position: PlayerPosition | string | null
  squadNumber: number | null
  name: string
}

export function compareSquadNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: 'asc' | 'desc' = 'asc',
): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return (a - b) * (direction === 'asc' ? 1 : -1)
}

/** Football order, with stable sporting-sheet tie-breaks. */
export function compareByPosition<T extends PositionSortable>(a: T, b: T, direction: 'asc' | 'desc' = 'asc'): number {
  const positionA = POSITION_ORDER[a.position as PlayerPosition] ?? Number.MAX_SAFE_INTEGER
  const positionB = POSITION_ORDER[b.position as PlayerPosition] ?? Number.MAX_SAFE_INTEGER
  const factor = direction === 'asc' ? 1 : -1
  if (positionA !== positionB) {
    if (positionA === Number.MAX_SAFE_INTEGER) return 1
    if (positionB === Number.MAX_SAFE_INTEGER) return -1
    return (positionA - positionB) * factor
  }

  const numberOrder = compareSquadNumbers(a.squadNumber, b.squadNumber)
  if (numberOrder !== 0) return numberOrder
  return a.name.localeCompare(b.name)
}
