/**
 * Premier League SSR (Sustainability & Systemic Resilience) tests — MVP 2.0.
 *
 * Three independent solvency tests applied to PL clubs ONLY (not Championship).
 * Pure functions — all monetary values in pence.
 *
 * Source: PL handbook 2026/27 (CONTEXT.md §4.4).
 */

// ---------------------------------------------------------------------------
// Constants (all in pence)
// ---------------------------------------------------------------------------

export const WORKING_CAPITAL_MINIMUM_PENCE = 12_500_000_00 // £12.5M monthly minimum
export const LIQUIDITY_STRESS_TEST_PENCE   = 85_000_000_00 // £85M solvency buffer
export const LIQUID_ASSET_SQUAD_FRACTION   = 0.40          // 40% of squad market value counts

// Tiered equity-ratio thresholds by season. The PL is tightening this over time.
const EQUITY_THRESHOLD_BY_SEASON: Record<string, number> = {
  '2026-27': 0.90,
  '2027-28': 0.85,
}
const EQUITY_THRESHOLD_DEFAULT = 0.80 // 2028-29 onwards

/** Returns the PL Positive Equity ratio cap for a given season string. */
export function seasonEquityThreshold(season: string): number {
  return EQUITY_THRESHOLD_BY_SEASON[season] ?? EQUITY_THRESHOLD_DEFAULT
}

// ---------------------------------------------------------------------------
// Test 1 — Working Capital
// ---------------------------------------------------------------------------
// Each calendar month in the season must clear the £12.5M floor.
// Formula: adjustedCashflow + qualifyingWorkingCapitalFunds ≥ £12.5M.

export interface WorkingCapitalMonthInput {
  /** Month identifier — YYYY-MM (only used by callers for grouping; engine ignores). */
  yearMonth?: string
  adjustedCashflowPence: number
  qualifyingFundsPence: number
}

export interface WorkingCapitalMonthResult {
  yearMonth?: string
  monthlyHeadroomPence: number
  passing: boolean
}

export interface WorkingCapitalAggregate {
  /** Per-month detail. */
  months: WorkingCapitalMonthResult[]
  /** Months failing the £12.5M floor. */
  failingMonthCount: number
  /** True iff every month passes. */
  passing: boolean
  /** The worst (lowest) headroom seen — useful for headline UI. */
  worstHeadroomPence: number
}

/** Evaluate one month against the £12.5M floor. */
export function evaluateWorkingCapitalMonth(
  input: WorkingCapitalMonthInput
): WorkingCapitalMonthResult {
  const headroom = input.adjustedCashflowPence + input.qualifyingFundsPence - WORKING_CAPITAL_MINIMUM_PENCE
  return {
    ...(input.yearMonth !== undefined ? { yearMonth: input.yearMonth } : {}),
    monthlyHeadroomPence: headroom,
    passing: headroom >= 0,
  }
}

/** Aggregate Working Capital across an entire season's monthly inputs. */
export function evaluateWorkingCapital(months: WorkingCapitalMonthInput[]): WorkingCapitalAggregate {
  const results = months.map(evaluateWorkingCapitalMonth)
  const failingMonthCount = results.filter((r) => !r.passing).length

  // Empty input → "passing" by default but worst headroom is 0 (no data). We
  // surface this via failingMonthCount = 0 + passing = true so the UI can treat
  // it as "no data submitted yet" without crashing.
  const worstHeadroomPence = results.length === 0
    ? 0
    : results.reduce((min, r) => Math.min(min, r.monthlyHeadroomPence), Infinity)

  return {
    months: results,
    failingMonthCount,
    passing: failingMonthCount === 0,
    worstHeadroomPence: worstHeadroomPence === Infinity ? 0 : worstHeadroomPence,
  }
}

// ---------------------------------------------------------------------------
// Test 2 — Liquidity
// ---------------------------------------------------------------------------
// liquidAssets + 40% × squadMarketValue − liquidLiabilities − £85M ≥ 0

export interface LiquidityInput {
  liquidAssetsPence: number
  liquidLiabilitiesPence: number
  squadMarketValuePence: number
}

export interface LiquidityResult {
  /** Net headroom after stress test. ≥ 0 means pass. */
  liquidityHeadroomPence: number
  passing: boolean
  /** Effective liquid assets including the 40% squad uplift — useful for the UI breakdown. */
  effectiveLiquidAssetsPence: number
}

export function evaluateLiquidity(input: LiquidityInput): LiquidityResult {
  const effectiveLiquidAssetsPence =
    input.liquidAssetsPence + Math.floor(input.squadMarketValuePence * LIQUID_ASSET_SQUAD_FRACTION)
  const headroom = effectiveLiquidAssetsPence - input.liquidLiabilitiesPence - LIQUIDITY_STRESS_TEST_PENCE
  return {
    liquidityHeadroomPence: headroom,
    passing: headroom >= 0,
    effectiveLiquidAssetsPence,
  }
}

// ---------------------------------------------------------------------------
// Test 3 — Positive Equity
// ---------------------------------------------------------------------------
// totalLiabilities / adjustedAssets  ≤  seasonThreshold

export interface EquityInput {
  totalLiabilitiesPence: number
  adjustedAssetsPence: number
  season: string
}

export interface EquityResult {
  ratio: number                  // liabilities / assets
  threshold: number              // season-specific cap
  passing: boolean
  /** Distance to threshold — negative means above the cap. Useful for "% margin" UI. */
  marginPp: number               // percentage points; positive = under the cap
}

export function evaluateEquity(input: EquityInput): EquityResult {
  // Defensive: zero or missing adjusted assets → ratio is undefined.
  // Treat as failing with Infinity ratio so the UI shows red.
  if (input.adjustedAssetsPence <= 0) {
    return {
      ratio: Infinity,
      threshold: seasonEquityThreshold(input.season),
      passing: false,
      marginPp: -Infinity,
    }
  }
  const ratio = input.totalLiabilitiesPence / input.adjustedAssetsPence
  const threshold = seasonEquityThreshold(input.season)
  return {
    ratio,
    threshold,
    passing: ratio <= threshold,
    marginPp: (threshold - ratio) * 100,
  }
}

// ---------------------------------------------------------------------------
// Promoted-club revenue uplift (calculator helper, MVP 2.0 §4.6)
// ---------------------------------------------------------------------------
// When a club is promoted from the Championship to the Premier League, their
// first PL-season revenue is materially higher (TV deals, sponsorship, gate).
// The uplift factor is an editable assumption: industry rule-of-thumb is
// roughly 4–5×, but it should always be presented as an estimate the CFO
// can override.

export const PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR = 4.5

export function calculatePromotedClubRevenueUplift(
  championshipRevenuePence: number,
  factor: number = PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR
): number {
  if (championshipRevenuePence <= 0 || factor <= 0) return 0
  return Math.floor(championshipRevenuePence * factor)
}
