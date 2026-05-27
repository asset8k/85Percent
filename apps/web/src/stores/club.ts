import { create } from 'zustand'
import type { ClubFinancialsResponse, ScenarioDetail } from '@/lib/api'

interface ClubState {
  clubId: string | null
  clubName: string | null
  leagueId: string | null
  financials: ClubFinancialsResponse | null
  /**
   * Loaded scenarios (full detail with actions). Drives the Active Baseline
   * computation in the TopBar SCR pill — any scenario with isIncluded === true
   * is folded into the projection.
   */
  scenarios: ScenarioDetail[]

  setClub: (id: string, name: string, leagueId: string) => void
  setFinancials: (f: ClubFinancialsResponse) => void
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
  financials: null,
  scenarios: [],

  setClub: (id, name, leagueId) => set({ clubId: id, clubName: name, leagueId }),
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
