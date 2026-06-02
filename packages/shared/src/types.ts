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

/** Mirrors the engine's ScenarioActionType — duplicated here so frontend types
 *  don't need to depend on @headroom/engine directly. */
export type ScenarioActionType = 'buy' | 'sell' | 'loan_in' | 'loan_out' | 'release'

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
  squadNumber: number | null          // shirt number (1–99); null = unassigned
  nationality: string | null
  dateOfBirth: string | null          // ISO YYYY-MM-DD; null = unknown (age UI hides)
  joinedDate: string | null           // ISO YYYY-MM-DD; original join date (kept across extensions)
  isActive: boolean
  archivedAt: string | null
  createdAt: string

  // Active contract (or null if the player has no active contract)
  contract: {
    id: string                        // contract id
    transferFeePence: number
    /**
     * Carried Book Value override (pence) or null. When non-null the SCR engine
     * amortises this remaining NBV instead of the transfer fee — for extension
     * blocks where the original fee is unknown (e.g. template imports).
     */
    carriedBookValuePence: number | null
    annualWagePence: number
    agentFeePence: number
    startDate: string                 // ISO YYYY-MM-DD
    endDate: string
    contractLengthYears: number
    bookValuePence: number            // live, recomputed at read time
    isActive: boolean
    phaseType: ContractPhaseType      // INITIAL | EXTENSION (drives carried-value UI)
  } | null

  // Derived for UI consumption
  monthsToExpiry: number | null       // null if no active contract; can be negative if expired
}

// ---------------------------------------------------------------------------
// Multi-phase contract ledger + Manager (Head Coach)
// ---------------------------------------------------------------------------
// A contract is a ledger of phases. INITIAL is the original signing; each
// EXTENSION supersedes the prior phase mid-deal, carrying the remaining book
// value forward as its new principal. Exactly one phase per individual is
// `isCurrent` at a time. Players and managers share this normalised shape —
// `feePence` is a player's transfer fee or a manager's compensation fee.

export type ContractPhaseType = 'INITIAL' | 'EXTENSION'

export interface ContractPhase {
  id: string
  phaseType: ContractPhaseType
  isCurrent: boolean
  /** Transfer fee (player) or compensation fee (manager), in pence. */
  feePence: number
  /**
   * Carried Book Value override (pence) or null. When non-null the engine
   * amortises this remaining NBV instead of `feePence` over the phase.
   */
  carriedBookValuePence: number | null
  annualWagePence: number
  agentFeePence: number
  startDate: string                 // ISO YYYY-MM-DD
  endDate: string
  contractLengthYears: number
  bookValuePence: number            // live, capped at 5 years, recomputed at read time
  supersededAt: string | null       // set when an extension replaced this phase
  createdAt: string
}

// The Head Coach / Manager. Their wages, compensation fee, and agent fees are
// included in the club's Squad Cost Ratio. A club has at most one active
// manager; their `contract` is the current phase, `phases` the full ledger.
export interface ManagerWithContract {
  id: string
  clubId: string
  name: string
  nationality: string | null
  isActive: boolean
  createdAt: string
  contract: ContractPhase | null
  phases: ContractPhase[]
  monthsToExpiry: number | null
}

// CSV staging — one entry per row. `parsed` is set iff `issues` is empty.
export interface RosterStagingRow {
  rowIndex: number                    // 1-based row number from the CSV (excluding header)
  ok: boolean
  issues: string[]                    // human-readable validation errors
  parsed?: {
    name: string
    position: PlayerPosition
    squadNumber?: number              // shirt number 1–99, optional CSV column
    nationality?: string
    dateOfBirth?: string              // ISO YYYY-MM-DD, optional CSV column
    joinedDate?: string               // ISO YYYY-MM-DD, optional CSV column (defaults to contract start)
    transferFeePence: number
    carriedBookValuePence?: number | null // optional Carried Book Value override
    annualWagePence: number
    agentFeePence: number
    startDate: string
    endDate: string
    contractLengthYears: number
    bookValuePence: number
  }
}
