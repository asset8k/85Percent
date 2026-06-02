import type { Currency, LeagueConfig } from './types.js'

export const EFL_CHAMPIONSHIP_CONFIG: LeagueConfig = {
  leagueId: 'efl-championship',
  greenThresholdRatio: 0.85,
  initialAllowanceRatio: 0.30,
  feedbackLoopDecrement: 1, // breach % is subtracted directly
  feedbackLoopIncrement: 0.10,
  ownerEquityTopUpLimit: {
    threeYearRollingMax: 33_000_000_00, // £33M in pence
    singleSeasonMax: 15_000_000_00,     // £15M in pence
  },
  pointsDeductionBasePoints: 6,
  pointsDeductionPerUnit: 6_500_000_00, // £6.5M in pence
  hasSSRTests: false,
}

export const PREMIER_LEAGUE_CONFIG: LeagueConfig = {
  leagueId: 'premier-league',
  greenThresholdRatio: 0.85,
  initialAllowanceRatio: 0.30,
  feedbackLoopDecrement: 1,
  feedbackLoopIncrement: 0.10,
  ownerEquityTopUpLimit: undefined,
  pointsDeductionBasePoints: 6,
  pointsDeductionPerUnit: 6_500_000_00,
  hasSSRTests: true,
}

export const LEAGUE_CONFIGS: Record<string, LeagueConfig> = {
  'efl-championship': EFL_CHAMPIONSHIP_CONFIG,
  'premier-league': PREMIER_LEAGUE_CONFIG,
}

// ---------------------------------------------------------------------------
// League → default workspace currency
// ---------------------------------------------------------------------------
// Smart default only — the CFO can override it in Settings, after which the
// mapping is no longer applied (see Club.currencyIsCustom). Accepts either the
// app's internal league id ('premier-league') or a human league name
// ('Premier League', 'La Liga') so it's reusable from any caller.

const GBP_LEAGUES = new Set([
  'premier-league',
  'premier league',
  'efl-championship',
  'efl championship',
  'championship',
])

// Future-proofing: the major European leagues map to EUR ahead of multi-league
// support. EUR is also the catch-all fallback for any unrecognised league.
const EUR_LEAGUES = new Set([
  'la-liga',
  'la liga',
  'laliga',
  'serie-a',
  'serie a',
  'bundesliga',
  'ligue-1',
  'ligue 1',
])

export function getDefaultCurrencyForLeague(league: string): Currency {
  const key = league.trim().toLowerCase()
  if (GBP_LEAGUES.has(key)) return 'GBP'
  if (EUR_LEAGUES.has(key)) return 'EUR'
  return 'EUR'
}
