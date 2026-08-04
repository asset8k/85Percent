import { create } from 'zustand'
import type { Currency } from '@85percent/shared'
import type { ClubFinancialsResponse, ScenarioDetail } from '@/lib/api'

// Cheap structural equality for the flat, JSON-safe payloads this store holds
// (financials = primitives; scenarios = plain detail objects from the API, in a
// stable server-defined key order). Used to keep object references stable across
// redundant re-fetches so downstream effects don't re-fire needlessly.
function sameJSON(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

interface ClubState {
  bootstrapStatus: 'idle' | 'loading' | 'ready' | 'error'
  clubId: string | null
  clubName: string | null
  leagueId: string | null
  clubLogoUrl: string | null
  /**
   * Workspace base currency — the single currency every monetary figure is
   * entered, stored, and displayed in. Drives the symbol (£ / € / $) everywhere.
   * Defaults to GBP until the club record loads.
   */
  baseCurrency: Currency
  financials: ClubFinancialsResponse | null
  /** Lifecycle for the selected season's financials request. `null` is only a
   * confirmed absence when this is `ready`, never while it is loading. */
  financialsStatus: 'idle' | 'loading' | 'ready' | 'error'
  financialsRequestVersion: number
  /**
   * Loaded scenarios (full detail with actions). Drives the Active Baseline
   * computation in the TopBar SCR pill — any scenario with isIncluded === true
   * is folded into the projection.
   */
  scenarios: ScenarioDetail[]
  /**
   * Whether the scenarios for the current club/season have finished their first
   * load. The Active Baseline (TopBar SCR pill + Dashboard projections) folds in
   * included scenarios, so rendering an SCR before they arrive shows a number
   * that visibly jumps once they land. Consumers gate on this to hold a loading
   * state until the real figure is known. Set true on success OR failure (we
   * proceed with whatever scenarios we have rather than blocking forever).
   */
  scenariosLoaded: boolean
  /** Lifecycle for scenario details used by the active SCR baseline. */
  scenariosStatus: 'idle' | 'loading' | 'ready' | 'error'
  /**
   * Whether financials for the current club/season have finished their first
   * load. Distinct from `financials === null`, which is ALSO the "no row
   * configured yet" state — without this flag the Dashboard can't tell "still
   * loading" from "genuinely unconfigured", and briefly flashes its setup
   * empty-state before the financials land. Set true once the fetch settles
   * (a value OR null), via setFinancials.
   */
  financialsLoaded: boolean

  // logoUrl is optional — omit it to leave the current crest untouched (e.g. on
  // a league switch that shouldn't clear the logo). baseCurrency is likewise
  // optional so callers that don't know it leave the current value in place.
  setClub: (
    id: string,
    name: string,
    leagueId: string,
    logoUrl?: string | null,
    baseCurrency?: Currency,
  ) => void
  setBootstrapStatus: (status: ClubState['bootstrapStatus']) => void
  setBaseCurrency: (currency: Currency) => void
  setFinancialsLoading: () => void
  setFinancialsError: () => void
  retryFinancials: () => void
  // Accepts null to clear financials when switching to a season that has no
  // configured row yet (the Dashboard then shows its setup empty-state).
  setFinancials: (f: ClubFinancialsResponse | null) => void
  setScenarios: (scenarios: ScenarioDetail[]) => void
  setScenariosLoading: () => void
  setScenariosError: () => void
  setScenariosLoaded: (loaded: boolean) => void
  upsertScenario: (scenario: ScenarioDetail) => void
  removeScenario: (id: string) => void
  setScenarioInclusion: (id: string, isIncluded: boolean) => void
  setScenarioName: (id: string, name: string) => void
}

export const useClubStore = create<ClubState>()((set) => ({
  bootstrapStatus: 'idle',
  clubId: null,
  clubName: null,
  leagueId: null,
  clubLogoUrl: null,
  baseCurrency: 'GBP',
  financials: null,
  financialsStatus: 'idle',
  financialsRequestVersion: 0,
  scenarios: [],
  scenariosLoaded: false,
  scenariosStatus: 'idle',
  financialsLoaded: false,

  setClub: (id, name, leagueId, logoUrl, baseCurrency) =>
    set((state) => ({
      clubId: id,
      clubName: name,
      leagueId,
      clubLogoUrl: logoUrl !== undefined ? logoUrl : state.clubLogoUrl,
      baseCurrency: baseCurrency !== undefined ? baseCurrency : state.baseCurrency,
    })),
  setBootstrapStatus: (bootstrapStatus) => set({ bootstrapStatus }),
  setBaseCurrency: (currency) => set({ baseCurrency: currency }),
  setFinancialsLoading: () => set({
    financials: null,
    financialsLoaded: false,
    financialsStatus: 'loading',
    scenarios: [],
    scenariosLoaded: false,
    scenariosStatus: 'idle',
  }),
  setFinancialsError: () => set({
    financials: null,
    financialsLoaded: true,
    financialsStatus: 'error',
    scenarios: [],
    scenariosLoaded: true,
    scenariosStatus: 'idle',
  }),
  retryFinancials: () => set((state) => ({
    financialsRequestVersion: state.financialsRequestVersion + 1,
  })),
  // Identity-stable: if the incoming payload is structurally identical to what
  // we already hold, keep the existing reference. Several callers re-fetch and
  // re-set financials on routine refreshes (ProtectedRoute on every auth event,
  // RosterPage on every visit); without this guard each set churns the object
  // reference, re-firing the TopBar SCR effect and flashing its loading pill.
  setFinancials: (f) =>
    set((state) =>
      sameJSON(state.financials, f)
        ? // Value unchanged — still record that the first load has settled so the
          // Dashboard can leave its loading state (and not flash the setup card).
          state.financialsLoaded && state.financialsStatus === 'ready'
          ? {}
          : { financialsLoaded: true, financialsStatus: 'ready' }
          : { financials: f, financialsLoaded: true, financialsStatus: 'ready' },
    ),
  setScenariosLoading: () => set({ scenarios: [], scenariosLoaded: false, scenariosStatus: 'loading' }),
  setScenariosError: () => set({ scenariosLoaded: true, scenariosStatus: 'error' }),
  setScenarios: (scenarios) =>
    set((state) =>
      sameJSON(state.scenarios, scenarios)
        ? // Data unchanged — keep the array reference but still record that the
          // first load completed, so the SCR pill leaves its loading state.
          state.scenariosLoaded && state.scenariosStatus === 'ready'
          ? {}
          : { scenariosLoaded: true, scenariosStatus: 'ready' }
          : { scenarios, scenariosLoaded: true, scenariosStatus: 'ready' },
    ),
  setScenariosLoaded: (loaded) => set({
    scenariosLoaded: loaded,
    scenariosStatus: loaded ? 'ready' : 'loading',
  }),
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
