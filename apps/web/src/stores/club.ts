import { create } from 'zustand'
import type { ClubFinancialsResponse, ScenarioDetail } from '@/lib/api'

interface ClubState {
  clubId: string | null
  clubName: string | null
  leagueId: string | null
  clubLogoUrl: string | null
  financials: ClubFinancialsResponse | null
  /**
   * Loaded scenarios (full detail with actions). Drives the Active Baseline
   * computation in the TopBar SCR pill — any scenario with isIncluded === true
   * is folded into the projection.
   */
  scenarios: ScenarioDetail[]

  // logoUrl is optional — omit it to leave the current crest untouched (e.g. on
  // a league switch that shouldn't clear the logo).
  setClub: (id: string, name: string, leagueId: string, logoUrl?: string | null) => void
  // Accepts null to clear financials when switching to a season that has no
  // configured row yet (the Dashboard then shows its setup empty-state).
  setFinancials: (f: ClubFinancialsResponse | null) => void
  setScenarios: (scenarios: ScenarioDetail[]) => void
  upsertScenario: (scenario: ScenarioDetail) => void
  removeScenario: (id: string) => void
  setScenarioInclusion: (id: string, isIncluded: boolean) => void
  setScenarioName: (id: string, name: string) => void
}

export const useClubStore = create<ClubState>()((set) => ({
  clubId: null,
  clubName: null,
  leagueId: null,
  clubLogoUrl: null,
  financials: null,
  scenarios: [],

  setClub: (id, name, leagueId, logoUrl) =>
    set((state) => ({
      clubId: id,
      clubName: name,
      leagueId,
      clubLogoUrl: logoUrl !== undefined ? logoUrl : state.clubLogoUrl,
    })),
  setFinancials: (f) => set({ financials: f }),
  setScenarios: (scenarios) => set({ scenarios }),
  upsertScenario: (scenario) =>
    set((state) => {
      const idx = state.scenarios.findIndex((s) => s.id === scenario.id)
      if (idx === -1) return { scenarios: [scenario, ...state.scenarios] }
      const next = [...state.scenarios]
      next[idx] = scenario
      return { scenarios: next }
    }),
  removeScenario: (id) =>
    set((state) => ({ scenarios: state.scenarios.filter((s) => s.id !== id) })),
  setScenarioInclusion: (id, isIncluded) =>
    set((state) => ({
      scenarios: state.scenarios.map((s) => (s.id === id ? { ...s, isIncluded } : s)),
    })),
  setScenarioName: (id, name) =>
    set((state) => ({
      scenarios: state.scenarios.map((s) => (s.id === id ? { ...s, name } : s)),
    })),
}))
