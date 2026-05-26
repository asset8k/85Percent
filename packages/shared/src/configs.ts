import type { LeagueConfig } from './types.js'

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
