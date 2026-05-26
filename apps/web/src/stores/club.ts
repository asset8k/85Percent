import { create } from 'zustand'
import type { ClubFinancialsResponse } from '@/lib/api'

interface ClubState {
  clubId: string | null
  clubName: string | null
  leagueId: string | null
  financials: ClubFinancialsResponse | null
  currentSCRRatio: number | null
  scrInfluence: boolean
  simulationCount: number
  totalStackedCostImpact: number
  setClub: (id: string, name: string, leagueId: string) => void
  setFinancials: (f: ClubFinancialsResponse) => void
  setCurrentSCRRatio: (ratio: number) => void
  setScrInfluence: (on: boolean) => void
  setStackedHistory: (count: number, total: number) => void
}

export const useClubStore = create<ClubState>()((set) => ({
  clubId: null,
  clubName: null,
  leagueId: null,
  financials: null,
  currentSCRRatio: null,
  scrInfluence: false,
  simulationCount: 0,
  totalStackedCostImpact: 0,
  setClub: (id, name, leagueId) => set({ clubId: id, clubName: name, leagueId }),
  setFinancials: (f) => set({ financials: f }),
  setCurrentSCRRatio: (ratio) => set({ currentSCRRatio: ratio }),
  setScrInfluence: (on) => set({ scrInfluence: on }),
  setStackedHistory: (count, total) => set({ simulationCount: count, totalStackedCostImpact: total }),
}))
