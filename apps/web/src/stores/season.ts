import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Active-season store (MVP 2.1 — Dynamic Seasons).
 *
 * Decouples the platform from the hardcoded 2026/27 season. A season is
 * identified by its START year (e.g. 2026 → the "2026/27" fiscal year, which
 * runs 1 Jul 2026 → 30 Jun 2027). Everything season-dependent — the financial
 * config fetched from the API, calendar dates, SSR thresholds, amortisation /
 * contract-expiry "as-of" math — derives from `startYear` via the pure helpers
 * below, so there is a single source of truth.
 *
 * 2026 is the platform's launch season (no earlier data exists); we allow
 * stepping forward to plan future windows. The selection is persisted so a
 * reload keeps the user in the season they were planning.
 */

// Platform launch season — nothing earlier has data.
export const MIN_SEASON_START = 2026
// How far forward a user may plan.
export const MAX_SEASON_START = MIN_SEASON_START + 9

export function clampSeasonStart(year: number): number {
  if (year < MIN_SEASON_START) return MIN_SEASON_START
  if (year > MAX_SEASON_START) return MAX_SEASON_START
  return year
}

/** End (calendar) year of a fiscal season — always startYear + 1. */
export function seasonEndYear(startYear: number): number {
  return startYear + 1
}

/** Display label, e.g. 2026 → "2026/27". */
export function seasonLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** Storage key matching the DB `season` column format, e.g. 2026 → "2026-27". */
export function seasonKey(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** Fiscal year opens 1 July of the start year (UTC midnight). */
export function seasonStartDate(startYear: number): Date {
  return new Date(Date.UTC(startYear, 6, 1))
}

/** Fiscal year closes 30 June of the following year (UTC midnight). */
export function seasonEndDate(startYear: number): Date {
  return new Date(Date.UTC(startYear + 1, 5, 30))
}

/**
 * Canonical valuation date for roster/SCR calculations. The active season is
 * valued today; completed and future seasons use their reporting close. This
 * lets a current-season registration show its real elapsed amortisation while
 * retaining a deterministic date for historical and planning views.
 */
export function seasonAsOfDate(startYear: number, now: Date = new Date()): Date {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = seasonStartDate(startYear)
  const end = seasonEndDate(startYear)
  if (today.getTime() >= start.getTime() && today.getTime() <= end.getTime()) return today
  return end
}

/** True when an ISO YYYY-MM-DD date falls inside the season's fiscal window. */
export function isWithinSeason(isoDate: string, startYear: number): boolean {
  const d = new Date(isoDate.slice(0, 10) + 'T00:00:00Z').getTime()
  return d >= seasonStartDate(startYear).getTime() && d <= seasonEndDate(startYear).getTime()
}

/**
 * Expiry-window membership for the Calendar's "Contracts Expiring" node.
 *
 * Like {@link isWithinSeason}, but for the *upcoming* season — the one whose
 * window starts within the next year — the lower bound is pulled back to today.
 * That surfaces contracts lapsing in the short run-up before the fiscal year
 * formally opens (e.g. a deal ending 30 June, just before a 1 July season),
 * matching the expiry notifications which use a rolling window from today.
 * Seasons fully in the past or further in the future keep the strict window.
 */
export function isExpiringInSeasonView(isoDate: string, startYear: number, now: number = Date.now()): boolean {
  const d = new Date(isoDate.slice(0, 10) + 'T00:00:00Z').getTime()
  const seasonStart = seasonStartDate(startYear).getTime()
  const seasonEnd = seasonEndDate(startYear).getTime()
  const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000
  // Only the immediately-upcoming season extends its lower bound back to today.
  const lower = now < seasonStart && seasonStart - now <= ONE_YEAR_MS ? now : seasonStart
  return d >= lower && d <= seasonEnd
}

interface SeasonState {
  /** Start (calendar) year of the active fiscal season, e.g. 2026 for 2026/27. */
  startYear: number
  setStartYear: (year: number) => void
  nextSeason: () => void
  prevSeason: () => void
}

export const useSeasonStore = create<SeasonState>()(
  persist(
    (set) => ({
      startYear: MIN_SEASON_START,
      setStartYear: (year) => set({ startYear: clampSeasonStart(year) }),
      nextSeason: () => set((s) => ({ startYear: clampSeasonStart(s.startYear + 1) })),
      prevSeason: () => set((s) => ({ startYear: clampSeasonStart(s.startYear - 1) })),
    }),
    {
      name: 'headroom.activeSeason',
      // Re-clamp on rehydrate in case MIN/MAX shift between releases.
      onRehydrateStorage: () => (state) => {
        if (state) state.startYear = clampSeasonStart(state.startYear)
      },
    },
  ),
)
