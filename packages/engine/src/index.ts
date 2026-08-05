export { calculateSCR } from './calculate.js'
export { calculateThresholds } from './thresholds.js'
export { determineStatus } from './status.js'
export { calculateLevy } from './levy.js'
export { calculatePointsDeduction } from './points.js'
export { calculateAllowanceUpdate } from './allowance.js'
export {
  generateAmortisationSchedule,
  currentBookValuePence,
  calculateRemainingBookValue,
  effectiveFeePence,
  amortisationPeriodYears,
  AMORTISATION_CAP_YEARS,
  type AmortisableContract,
} from './amortisation.js'
export {
  calculateSquadCosts,
  applyScenarioActions,
  type ContractInput,
  type ManagerCostInput,
  type PlayerCostBreakdown,
  type SquadCostsResult,
  type ScenarioActionInput,
  type ScenarioActionType,
  type ScenarioBaseline,
  type ScenarioProjection,
} from './squadCosts.js'
export {
  calculateRegistrationCost,
  resolveContractPhases,
  type AmortisationTreatment,
  type ContractPhaseInput,
  type ContractPhaseStatus,
  type RegistrationAssetInput,
  type RegistrationCostResult,
  type ResolvedContractPhase,
} from './contractLifecycle.js'
export {
  evaluateWorkingCapital,
  evaluateWorkingCapitalMonth,
  evaluateLiquidity,
  evaluateEquity,
  seasonEquityThreshold,
  calculatePromotedClubRevenueUplift,
  WORKING_CAPITAL_MINIMUM_PENCE,
  LIQUIDITY_STRESS_TEST_PENCE,
  LIQUID_ASSET_SQUAD_FRACTION,
  PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR,
  type WorkingCapitalMonthInput,
  type WorkingCapitalMonthResult,
  type WorkingCapitalAggregate,
  type LiquidityInput,
  type LiquidityResult,
  type EquityInput,
  type EquityResult,
} from './ssr.js'
