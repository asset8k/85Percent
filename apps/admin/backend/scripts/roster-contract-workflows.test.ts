import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import Papa from 'papaparse'
import {
  ExtendContractSchema,
  ManualPlayerSchema,
  RosterRowSchema,
} from '@85percent/shared'
import { calculateRegistrationCost, calculateSquadCosts } from '@85percent/engine'
import {
  phaseStatusForRow,
  resolvePlayerContract,
  type ContractRow,
  type RegistrationAssetRow,
} from '../services/player-registration'

const extensionWindow = {
  effectiveDate: '2028-06-30',
  newEndDate: '2033-06-30',
  newAgentFeePence: 0,
}

test('extension validation prefers canonical annual wages and accepts the legacy weekly payload', () => {
  assert.equal(ExtendContractSchema.safeParse({
    ...extensionWindow,
    newAnnualWagePence: 7_800_000_00,
  }).success, true)

  assert.equal(ExtendContractSchema.safeParse({
    ...extensionWindow,
    newWeeklyWagePence: 1_500_00,
  }).success, true)

  assert.equal(ExtendContractSchema.safeParse({
    ...extensionWindow,
    newAnnualWagePence: 7_800_000_00,
    newWeeklyWagePence: 1_500_00,
  }).success, false)
})

test('weekly player inputs preserve the selected accounting basis', () => {
  const common = {
    name: 'Example Player',
    position: 'MID' as const,
    weeklyWagePence: 1_000_000,
    agentFeePence: 0,
    startDate: '2026-07-01',
    endDate: '2030-06-30',
  }

  const newSigning = ManualPlayerSchema.parse({ ...common, transferFeePence: 20_000_000_00 })
  const existingPlayer = ManualPlayerSchema.parse({
    ...common,
    transferFeePence: 0,
    carriedBookValuePence: 8_000_000_00,
  })

  const costs = calculateSquadCosts([
    {
      playerId: 'new-signing',
      transferFeePence: newSigning.transferFeePence,
      annualWagePence: newSigning.weeklyWagePence! * 52,
      agentFeePence: newSigning.agentFeePence,
      contractLengthYears: 4,
    },
    {
      playerId: 'existing-player',
      transferFeePence: existingPlayer.transferFeePence,
      carriedBookValuePence: existingPlayer.carriedBookValuePence,
      annualWagePence: existingPlayer.weeklyWagePence! * 52,
      agentFeePence: existingPlayer.agentFeePence,
      contractLengthYears: 4,
    },
  ])

  assert.equal(costs.breakdown[0]?.amortisationPence, 5_000_000_00)
  assert.equal(costs.breakdown[1]?.amortisationPence, 2_000_000_00)
})

test('free transfers, long contracts, and the head coach use the canonical engine total', () => {
  const costs = calculateSquadCosts([
    {
      playerId: 'free-transfer',
      transferFeePence: 0,
      annualWagePence: 2_000_000_00,
      agentFeePence: 0,
      contractLengthYears: 8,
    },
    {
      playerId: 'long-contract',
      transferFeePence: 25_000_000_00,
      annualWagePence: 4_000_000_00,
      agentFeePence: 5_000_000_00,
      contractLengthYears: 8,
    },
  ], {
    managerId: 'head-coach',
    compensationFeePence: 5_000_000_00,
    annualWagePence: 3_000_000_00,
    agentFeePence: 0,
    contractLengthYears: 5,
  })

  assert.equal(costs.breakdown[0]?.totalAnnualCostPence, 2_000_000_00)
  assert.equal(costs.breakdown[1]?.amortisationPence, 5_000_000_00)
  assert.equal(costs.breakdown.find((item) => item.isManager)?.totalAnnualCostPence, 4_000_000_00)
  assert.equal(costs.totalSquadCostsPence, 16_000_000_00)
})

test('Messi renewal keeps the £80m registration asset and schedules the future phase', () => {
  const asset = {
    acquisitionFeePence: 80_000_000_00,
    acquisitionAgentFeePence: 0,
    acquisitionDate: '2025-07-01',
  }
  const phases = [
    {
      id: 'initial',
      startDate: '2025-07-01',
      endDate: '2027-07-01',
      annualWagePence: 10_000_000_00,
      agentFeePence: 0,
    },
    {
      id: 'extension',
      startDate: '2027-07-01',
      endDate: '2030-07-01',
      annualWagePence: 12_000_000_00,
      agentFeePence: 3_000_000_00,
      amortisationTreatment: 'CONTINUE_CURRENT_SCHEDULE' as const,
    },
  ]

  const beforeEffectiveDate = calculateRegistrationCost(asset, phases, new Date('2026-07-01T00:00:00Z'))
  assert.equal(beforeEffectiveDate.activePhase?.id, 'initial')
  assert.equal(beforeEffectiveDate.phases.find((phase) => phase.id === 'initial')?.status, 'ACTIVE')
  assert.equal(beforeEffectiveDate.phases.find((phase) => phase.id === 'extension')?.status, 'SCHEDULED')
  assert.equal(beforeEffectiveDate.carryingValuePence, 40_000_000_00)
  assert.equal(beforeEffectiveDate.annualAmortisationPence, 40_000_000_00)
  assert.equal(beforeEffectiveDate.totalAnnualCostPence, 50_000_000_00)

  const afterEffectiveDate = calculateRegistrationCost(asset, phases, new Date('2027-07-01T00:00:00Z'))
  assert.equal(afterEffectiveDate.activePhase?.id, 'extension')
  assert.equal(afterEffectiveDate.phases.find((phase) => phase.id === 'initial')?.status, 'COMPLETED')
  assert.equal(afterEffectiveDate.phases.find((phase) => phase.id === 'extension')?.status, 'ACTIVE')
  assert.equal(afterEffectiveDate.carryingValuePence, 0)
  assert.equal(afterEffectiveDate.annualAmortisationPence, 0)
  assert.equal(afterEffectiveDate.annualisedAgentFeePence, 1_000_000_00)
  assert.equal(afterEffectiveDate.totalAnnualCostPence, 13_000_000_00)
})

test('renewal accounting policy centrally controls how a remaining registration asset is treated', () => {
  const asset = {
    acquisitionFeePence: 100_000_000_00,
    acquisitionAgentFeePence: 0,
    acquisitionDate: '2025-07-01',
  }
  const basePhases = [
    {
      id: 'initial',
      startDate: '2025-07-01',
      endDate: '2030-07-01',
      annualWagePence: 8_000_000_00,
      agentFeePence: 0,
    },
  ]
  const continued = calculateRegistrationCost(asset, [
    ...basePhases,
    {
      id: 'extension', startDate: '2027-07-01', endDate: '2032-07-01',
      annualWagePence: 9_000_000_00, agentFeePence: 0,
      amortisationTreatment: 'CONTINUE_CURRENT_SCHEDULE' as const,
    },
  ], new Date('2028-07-01T00:00:00Z'))
  const respread = calculateRegistrationCost(asset, [
    ...basePhases,
    {
      id: 'extension', startDate: '2027-07-01', endDate: '2032-07-01',
      annualWagePence: 9_000_000_00, agentFeePence: 0,
      amortisationTreatment: 'SPREAD_REMAINING_BOOK_VALUE' as const,
    },
  ], new Date('2028-07-01T00:00:00Z'))

  assert.equal(continued.annualAmortisationPence, 20_000_000_00)
  assert.equal(respread.annualAmortisationPence, 1_200_438_116)
  assert.equal(respread.carryingValuePence, 4_799_781_301)
})

test('a scheduled renewal re-spreads the book value at signing, not at future expiry', () => {
  const asset = {
    acquisitionFeePence: 80_000_000_00,
    acquisitionAgentFeePence: 0,
    acquisitionDate: '2025-07-01',
  }
  const initial = {
    id: 'initial', startDate: '2025-07-01', endDate: '2029-06-30',
    annualWagePence: 8_320_000_00, agentFeePence: 0,
  }
  const signedDate = '2026-08-05'
  const sharedExtension = {
    id: 'extension', startDate: '2029-07-01', endDate: '2031-06-30',
    annualWagePence: 8_320_000_00, agentFeePence: 0,
    extensionSignedDate: signedDate,
  }

  const beforeExpiry = calculateRegistrationCost(asset, [initial, {
    ...sharedExtension,
    amortisationTreatment: 'SPREAD_REMAINING_BOOK_VALUE' as const,
  }], new Date('2028-06-30T00:00:00Z'))
  assert.equal(beforeExpiry.activePhase?.id, 'initial')

  const continued = calculateRegistrationCost(asset, [initial, {
    ...sharedExtension,
    amortisationTreatment: 'CONTINUE_CURRENT_SCHEDULE' as const,
  }], new Date('2029-07-01T00:00:00Z'))
  const respread = calculateRegistrationCost(asset, [initial, {
    ...sharedExtension,
    amortisationTreatment: 'SPREAD_REMAINING_BOOK_VALUE' as const,
  }], new Date('2029-07-01T00:00:00Z'))

  const bookAtSigning = calculateRegistrationCost(asset, [initial], new Date(`${signedDate}T00:00:00Z`)).carryingValuePence
  assert.ok(bookAtSigning > 0)
  assert.equal(continued.annualAmortisationPence, 0)
  assert.ok(respread.annualAmortisationPence > 0)
  assert.ok(respread.totalAnnualCostPence > continued.totalAnnualCostPence)
})

test('a persisted Messi renewal applies its signed accounting policy before its wage phase starts', () => {
  const payload = {
    effectiveDate: '2029-07-01',
    extensionSignedDate: '2026-08-05',
    newEndDate: '2031-06-30',
    newWeeklyWagePence: 500_000_00,
    newAgentFeePence: 0,
  }
  assert.equal(ExtendContractSchema.safeParse({
    ...payload,
    amortisationTreatment: 'CONTINUE_CURRENT_SCHEDULE',
  }).success, true)
  assert.equal(ExtendContractSchema.safeParse({
    ...payload,
    amortisationTreatment: 'SPREAD_REMAINING_BOOK_VALUE',
  }).success, true)

  const asset: RegistrationAssetRow = {
    player_id: 'messi',
    acquisition_fee: 90_000_000_00,
    acquisition_agent_fee: 0,
    acquisition_date: '2026-07-01',
    carrying_value: null,
  }
  const initial: ContractRow = {
    id: 'messi-initial', player_id: 'messi', transfer_fee: 90_000_000_00, carried_book_value: null,
    annual_wage: 26_000_000_00, agent_fee: 0, start_date: '2026-07-01', end_date: '2029-06-30',
    contract_length_years: 3, is_active: true, phase_type: 'INITIAL',
    amortisation_treatment: 'CONTINUE_CURRENT_SCHEDULE',
  }
  const extension: ContractRow = {
    id: 'messi-extension', player_id: 'messi', transfer_fee: 0, carried_book_value: null,
    annual_wage: payload.newWeeklyWagePence * 52, agent_fee: payload.newAgentFeePence,
    start_date: payload.effectiveDate, end_date: payload.newEndDate, contract_length_years: 2,
    is_active: true, phase_type: 'EXTENSION', extension_signed_date: payload.extensionSignedDate,
    amortisation_treatment: 'CONTINUE_CURRENT_SCHEDULE',
  }
  const signedAt = new Date(`${payload.extensionSignedDate}T00:00:00Z`)
  const rowsFromDatabase = (treatment: ContractRow['amortisation_treatment']) =>
    JSON.parse(JSON.stringify([initial, { ...extension, amortisation_treatment: treatment }])) as ContractRow[]

  const continued = resolvePlayerContract(rowsFromDatabase('CONTINUE_CURRENT_SCHEDULE'), asset, signedAt)
  const respread = resolvePlayerContract(rowsFromDatabase('SPREAD_REMAINING_BOOK_VALUE'), asset, signedAt)
  const baseline = resolvePlayerContract([initial], asset, signedAt)
  assert.ok(continued)
  assert.ok(respread)
  assert.ok(baseline)

  // The initial wage phase remains active, while accounting reacts to the
  // signed extension immediately.
  assert.equal(continued.row.id, initial.id)
  assert.equal(respread.row.id, initial.id)
  assert.equal(baseline.totalAnnualCostPence, continued.totalAnnualCostPence)
  assert.equal(phaseStatusForRow(rowsFromDatabase('SPREAD_REMAINING_BOOK_VALUE')[1]!, rowsFromDatabase('SPREAD_REMAINING_BOOK_VALUE'), signedAt), 'SCHEDULED')
  assert.equal(continued.totalAnnualCostPence, 56_000_000_00)
  assert.equal(respread.bookValuePence, 87_123_287_67)
  assert.equal(respread.annualAmortisationPence, 17_719_990_71)
  assert.equal(respread.totalAnnualCostPence, 43_719_990_71)
  assert.ok(respread.totalAnnualCostPence < continued.totalAnnualCostPence)
  assert.equal(
    respread.totalAnnualCostPence - baseline.totalAnnualCostPence,
    -12_280_009_29,
  )

  // Dashboard derives the same annual cost from the canonical resolver output
  // that Roster returns after a database refetch.
  const dashboard = calculateSquadCosts([{
    playerId: 'messi',
    transferFeePence: respread.transferFeePence,
    carriedBookValuePence: respread.carriedBookValuePence,
    annualWagePence: Number(respread.row.annual_wage),
    agentFeePence: Number(respread.row.agent_fee),
    contractLengthYears: Number(respread.row.contract_length_years),
    annualAmortisationOverridePence: respread.annualAmortisationPence,
    annualisedAgentFeeOverridePence: respread.annualisedAgentFeePence,
  }])
  assert.equal(dashboard.breakdown[0]?.totalAnnualCostPence, respread.totalAnnualCostPence)
})

test('an extension after a fully amortised asset has no residual fee charge', () => {
  const result = calculateRegistrationCost({
    acquisitionFeePence: 80_000_000_00,
    acquisitionAgentFeePence: 0,
    acquisitionDate: '2020-07-01',
  }, [
    { id: 'initial', startDate: '2020-07-01', endDate: '2025-07-01', annualWagePence: 5_000_000_00, agentFeePence: 0 },
    { id: 'extension', startDate: '2025-07-01', endDate: '2028-07-01', annualWagePence: 6_000_000_00, agentFeePence: 0 },
  ], new Date('2026-07-01T00:00:00Z'))

  assert.equal(result.activePhase?.id, 'extension')
  assert.equal(result.carryingValuePence, 0)
  assert.equal(result.annualAmortisationPence, 0)
  assert.equal(result.totalAnnualCostPence, 6_000_000_00)
})

test('a contract remains active through its stated end date', () => {
  const asset = {
    acquisitionFeePence: 0,
    acquisitionAgentFeePence: 0,
    acquisitionDate: '2023-07-01',
  }
  const phases = [
    {
      id: 'dias',
      startDate: '2023-07-01',
      endDate: '2027-06-30',
      annualWagePence: 10_400_000_00,
      agentFeePence: 0,
    },
  ]

  const atSeasonClose = calculateRegistrationCost(asset, phases, new Date('2027-06-30T00:00:00Z'))
  const afterExpiry = calculateRegistrationCost(asset, phases, new Date('2027-07-01T00:00:00Z'))

  assert.equal(atSeasonClose.activePhase?.id, 'dias')
  assert.equal(atSeasonClose.totalAnnualCostPence, 10_400_000_00)
  assert.equal(afterExpiry.activePhase, null)
})

test('Manchester City sample rows parse with their financial data at season close', () => {
  const csvText = readFileSync(new URL('../../../../sample-data/manchester-city-squad.csv', import.meta.url), 'utf8')
  const csv = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  assert.equal(csv.errors.length, 0)
  assert.equal(csv.data.length, 23)

  const rows = csv.data.map((row) => {
    const { carried_book_value_pounds, squad_number, ...base } = row
    return RosterRowSchema.parse({
    ...base,
    ...(squad_number ? { squad_number: Number(squad_number) } : {}),
    transfer_fee_pounds: Number(row.transfer_fee_pounds),
    ...(carried_book_value_pounds ? { carried_book_value_pounds: Number(carried_book_value_pounds) } : {}),
    weekly_wage_pounds: Number(row.weekly_wage_pounds),
    agent_fee_pounds: Number(row.agent_fee_pounds),
    })
  })
  const dias = rows.find((row) => row.name === 'Ruben Dias')
  assert.ok(dias)

  const asset = {
    acquisitionFeePence: dias.transfer_fee_pounds * 100,
    acquisitionAgentFeePence: dias.agent_fee_pounds * 100,
    acquisitionDate: dias.carried_book_value_pounds != null
      ? dias.contract_start
      : dias.joined_date ?? dias.contract_start,
    carryingValuePence: dias.carried_book_value_pounds == null
      ? null
      : dias.carried_book_value_pounds * 100,
  }
  const result = calculateRegistrationCost(asset, [{
    id: 'dias',
    startDate: dias.contract_start,
    endDate: dias.contract_end,
    annualWagePence: dias.weekly_wage_pounds * 52 * 100,
    agentFeePence: dias.agent_fee_pounds * 100,
    amortisationTreatment: dias.amortisation_treatment,
  }], new Date('2027-06-30T00:00:00Z'))

  assert.equal(result.activePhase?.id, 'dias')
  assert.equal(result.totalAnnualCostPence >= dias.weekly_wage_pounds * 52 * 100, true)
})
