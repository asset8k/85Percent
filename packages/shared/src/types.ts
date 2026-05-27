export interface LeagueConfig {
  leagueId: string
  greenThresholdRatio: number
  initialAllowanceRatio: number
  feedbackLoopDecrement: number
  feedbackLoopIncrement: number
  ownerEquityTopUpLimit?: {
    threeYearRollingMax: number
    singleSeasonMax: number
  }
  pointsDeductionBasePoints: number
  pointsDeductionPerUnit: number
  hasSSRTests: boolean
}

export interface ClubFinancials {
  clubId: string
  season: string
  leagueConfig: LeagueConfig
  footballRelatedRevenue: number
  currentSquadCosts: number
  currentAllowanceRatio: number
  ownerEquityUsedThreeYear?: number
  ownerEquityUsedCurrentSeason?: number
}

export type TransactionType = 'buy' | 'sell' | 'loan_in' | 'loan_out'

export interface TransferInput {
  transactionType?: TransactionType  // omitted in legacy stored simulations → treated as 'buy'

  // BUY & LOAN_IN — the core incoming-player fields
  transferFee: number           // buy: purchase fee; loan_in: loan fee paid; 0 otherwise
  contractLengthYears: number   // buy: contract years; loan_in: loan duration
  annualWage: number            // annual wage this club pays; 0 for sell/loan_out
  agentFee: number              // buy only; 0 otherwise

  // SELL — outgoing player
  saleProceeds?: number
  playerBookValue?: number
  annualWageRelief?: number         // annual wage being removed from squad costs
  annualAmortisationRelief?: number // annual amortisation charge being removed

  // LOAN_OUT — loaning a player out
  loanFeeReceived?: number
  loanLengthYears?: number
  annualWageCovered?: number        // annual wage covered by the borrowing club

  // LEGACY — kept for backward compat with simulations saved before the type selector
  playerSaleProceeds?: number
  playerSaleBookValue?: number
}

export interface AmortisationEntry {
  season: string
  amortisationAmount: number
  remainingBookValue: number
}

export interface SCRResult {
  currentSCRRatio: number
  currentGreenThreshold: number
  currentRedThreshold: number
  currentStatus: 'green' | 'amber' | 'red'

  annualAmortisation: number
  annualAgentFeeImpact: number
  netPlayerSaleImpact: number
  totalAnnualCostImpact: number

  projectedSquadCosts: number
  projectedSCRRatio: number
  projectedStatus: 'green' | 'amber' | 'red'
  headroomRemaining: number
  redThresholdHeadroom: number

  projectedLevy?: number
  projectedPointsDeduction?: number

  amortisationSchedule: AmortisationEntry[]
}

export type UserRole = 'cfo' | 'sporting_director' | 'finance_analyst' | 'admin'
export type ComplianceStatus = 'green' | 'amber' | 'red'

// ---------------------------------------------------------------------------
// Roster (MVP 2.0) — wire-format response types
// All monetary values are integers in pence. ISO date strings on the wire,
// not Date objects, to keep JSON deterministic.
// ---------------------------------------------------------------------------
export type PlayerPosition = 'GK' | 'DEF' | 'MID' | 'FWD'

export interface PlayerWithContract {
  id: string                          // player id
  clubId: string
  name: string
  position: PlayerPosition | null
  nationality: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string

  // Active contract (or null if the player has no active contract)
  contract: {
    id: string                        // contract id
    transferFeePence: number
    annualWagePence: number
    agentFeePence: number
    startDate: string                 // ISO YYYY-MM-DD
    endDate: string
    contractLengthYears: number
    bookValuePence: number            // live, recomputed at read time
    isActive: boolean
  } | null

  // Derived for UI consumption
  monthsToExpiry: number | null       // null if no active contract; can be negative if expired
}

// CSV staging — one entry per row. `parsed` is set iff `issues` is empty.
export interface RosterStagingRow {
  rowIndex: number                    // 1-based row number from the CSV (excluding header)
  ok: boolean
  issues: string[]                    // human-readable validation errors
  parsed?: {
    name: string
    position: PlayerPosition
    nationality?: string
    transferFeePence: number
    annualWagePence: number
    agentFeePence: number
    startDate: string
    endDate: string
    contractLengthYears: number
    bookValuePence: number
  }
}
