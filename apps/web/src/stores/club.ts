import { create } from 'zustand'
import type { ClubFinancialsResponse } from '@/lib/api'

export interface StoredSimulation {
  id: string
  label: string | null
  season: string
  transferInput: unknown
  isIncluded: boolean
  createdAt: string
  user?: { fullName: string; email: string }
}

interface ClubState {
  clubId: string | null
  clubName: string | null
  leagueId: string | null
  financials: ClubFinancialsResponse | null
  simulations: StoredSimulation[]
  setClub: (id: string, name: string, leagueId: string) => void
  setFinancials: (f: ClubFinancialsResponse) => void
  setSimulations: (sims: StoredSimulation[]) => void
  upsertSimulation: (sim: StoredSimulation) => void
  removeSimulation: (id: string) => void
  setInclusion: (id: string, isIncluded: boolean) => void
  setLabel: (id: string, label: string | null) => void
}

export const useClubStore = create<ClubState>()((set) => ({
  clubId: null,
  clubName: null,
  leagueId: null,
  financials: null,
  simulations: [],
  setClub: (id, name, leagueId) => set({ clubId: id, clubName: name, leagueId }),
  setFinancials: (f) => set({ financials: f }),
  setSimulations: (simulations) => set({ simulations }),
  upsertSimulation: (sim) =>
    set((state) => {
      const idx = state.simulations.findIndex((s) => s.id === sim.id)
      if (idx === -1) return { simulations: [sim, ...state.simulations] }
      const next = [...state.simulations]
      next[idx] = sim
      return { simulations: next }
    }),
  removeSimulation: (id) =>
    set((state) => ({ simulations: state.simulations.filter((s) => s.id !== id) })),
  setInclusion: (id, isIncluded) =>
    set((state) => ({
      simulations: state.simulations.map((s) => (s.id === id ? { ...s, isIncluded } : s)),
    })),
  setLabel: (id, label) =>
    set((state) => ({
      simulations: state.simulations.map((s) => (s.id === id ? { ...s, label } : s)),
    })),
}))
