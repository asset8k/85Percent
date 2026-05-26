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
