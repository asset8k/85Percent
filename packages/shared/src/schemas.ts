import { z } from 'zod'

export const LeagueConfigSchema = z.object({
  leagueId: z.string(),
  greenThresholdRatio: z.number().min(0).max(1),
  initialAllowanceRatio: z.number().min(0).max(1),
  feedbackLoopDecrement: z.number().min(0).max(1),
  feedbackLoopIncrement: z.number().min(0).max(1),
  ownerEquityTopUpLimit: z
    .object({
      threeYearRollingMax: z.number().int().positive(),
      singleSeasonMax: z.number().int().positive(),
    })
    .optional(),
  pointsDeductionBasePoints: z.number().int().positive(),
  pointsDeductionPerUnit: z.number().int().positive(),
  hasSSRTests: z.boolean(),
})

export const ClubFinancialsSchema = z.object({
  clubId: z.string().uuid(),
  season: z.string().regex(/^\d{4}-\d{2}$/, 'Season must be in format YYYY-YY e.g. 2026-27'),
  leagueConfig: LeagueConfigSchema,
  footballRelatedRevenue: z.number().int().positive(),
  currentSquadCosts: z.number().int().min(0),
  currentAllowanceRatio: z.number().min(0).max(1),
  ownerEquityUsedThreeYear: z.number().int().min(0).optional(),
  ownerEquityUsedCurrentSeason: z.number().int().min(0).optional(),
})

export const TransferInputSchema = z.object({
  transferFee: z.number().int().min(0),
  contractLengthYears: z.number().min(0.5).max(10),
  annualWage: z.number().int().positive(),
  agentFee: z.number().int().min(0),
  playerSaleProceeds: z.number().int().min(0).optional(),
  playerSaleBookValue: z.number().int().min(0).optional(),
})

// Form-level schema — accepts weekly wages and converts; used in frontend forms
export const TransferFormSchema = z.object({
  transferFee: z.number().int().min(0, 'Transfer fee cannot be negative'),
  contractLengthYears: z
    .number()
    .min(0.5, 'Contract must be at least 6 months')
    .max(10, 'Contract cannot exceed 10 years'),
  weeklyWage: z.number().int().positive('Weekly wage must be positive'),
  agentFee: z.number().int().min(0, 'Agent fee cannot be negative'),
  isSelling: z.boolean(),
  playerSaleProceeds: z.number().int().min(0).optional(),
  playerSaleBookValue: z.number().int().min(0).optional(),
  label: z.string().max(100).optional(),
})

export const ClubFinancialsInputSchema = z.object({
  season: z.string().regex(/^\d{4}-\d{2}$/),
  footballRelatedRevenuePounds: z.number().int().positive('Revenue must be a positive integer'),
  currentSquadCostsPounds: z.number().int().min(0, 'Squad costs cannot be negative'),
  currentAllowanceRatio: z
    .number()
    .min(0, 'Allowance cannot be negative')
    .max(1, 'Allowance cannot exceed 100%'),
  ownerEquityUsedCurrentSeasonPounds: z.number().int().min(0).optional(),
  ownerEquityUsedThreeYearPounds: z.number().int().min(0).optional(),
})

// ---------------------------------------------------------------------------
// Roster (MVP 2.0) — players + contracts
// ---------------------------------------------------------------------------

const POSITION = z.enum(['GK', 'DEF', 'MID', 'FWD'])

// ISO date string (YYYY-MM-DD). Validated to be a real, parseable date.
const ISODateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()), 'Invalid calendar date')

// Single CSV row schema. All money in £ (pounds, integer). Position is
// case-insensitive on input; output is canonical uppercase.
export const RosterRowSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80, 'Name too long'),
    position: z.string().transform((s) => s.trim().toUpperCase()).pipe(POSITION),
    nationality: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
    transfer_fee_pounds: z.number({ invalid_type_error: 'Transfer fee must be a number' }).int().min(0, 'Transfer fee cannot be negative'),
    weekly_wage_pounds:  z.number({ invalid_type_error: 'Weekly wage must be a number' }).int().positive('Weekly wage must be > 0'),
    agent_fee_pounds:    z.number({ invalid_type_error: 'Agent fee must be a number' }).int().min(0, 'Agent fee cannot be negative'),
    contract_start: ISODateString,
    contract_end:   ISODateString,
  })
  .refine((r) => new Date(r.contract_end) > new Date(r.contract_start), {
    message: 'Contract end must be after start',
    path: ['contract_end'],
  })
  .refine((r) => {
    const start = new Date(r.contract_start)
    const maxEnd = new Date(start)
    maxEnd.setFullYear(start.getFullYear() + 7)
    return new Date(r.contract_end) <= maxEnd
  }, {
    message: 'Contract cannot exceed 7 years',
    path: ['contract_end'],
  })

export type RosterRowInput = z.infer<typeof RosterRowSchema>

// Manual single-player add/edit (UI form). Uses pence and unified field names
// (no CSV underscores). End-to-end validation matches RosterRowSchema rules.
export const ManualPlayerSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    position: POSITION,
    nationality: z.string().trim().max(60).optional(),
    transferFeePence: z.number().int().min(0),
    annualWagePence:  z.number().int().positive(),
    agentFeePence:    z.number().int().min(0),
    startDate: ISODateString,
    endDate:   ISODateString,
  })
  .refine((r) => new Date(r.endDate) > new Date(r.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine((r) => {
    const start = new Date(r.startDate)
    const maxEnd = new Date(start)
    maxEnd.setFullYear(start.getFullYear() + 7)
    return new Date(r.endDate) <= maxEnd
  }, {
    message: 'Contract cannot exceed 7 years',
    path: ['endDate'],
  })

export type ManualPlayerInput = z.infer<typeof ManualPlayerSchema>

// Edit-contract endpoint accepts the same shape but treats all fields optional.
// At least one field must be present.
export const ContractPatchSchema = z
  .object({
    transferFeePence: z.number().int().min(0).optional(),
    annualWagePence:  z.number().int().positive().optional(),
    agentFeePence:    z.number().int().min(0).optional(),
    startDate: ISODateString.optional(),
    endDate:   ISODateString.optional(),
  })
  .refine((r) => Object.values(r).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  })

export type ContractPatchInput = z.infer<typeof ContractPatchSchema>

export type LeagueConfigInput = z.infer<typeof LeagueConfigSchema>
export type ClubFinancialsInput = z.infer<typeof ClubFinancialsSchema>
export type TransferInputData = z.infer<typeof TransferInputSchema>
export type TransferFormData = z.infer<typeof TransferFormSchema>
export type ClubFinancialsFormData = z.infer<typeof ClubFinancialsInputSchema>
