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

// ClubFinancialsSchema / TransferInputSchema / TransferFormSchema /
// ClubFinancialsInputSchema were MVP 1.0 schemas that referenced the now-
// dropped `currentSquadCosts` column. They are unused in MVP 2.0 — the API
// routes define their own Zod bodies inline, and the engine uses the typed
// interfaces in types.ts directly. Removed in MVP 2.0 cleanup; reintroduce
// only if a downstream consumer materialises.

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
    // Optional CSV column — accepts blank / missing. Same realism refine as the
    // manual-add path (must be in the past, within the last 70 years).
    date_of_birth: ISODateString.optional().or(z.literal('').transform(() => undefined)),
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
    maxEnd.setFullYear(start.getFullYear() + 10)
    return new Date(r.contract_end) <= maxEnd
  }, {
    message: 'Contract cannot exceed 10 years',
    path: ['contract_end'],
  })
  .refine((r) => {
    if (!r.date_of_birth) return true
    const dob = new Date(r.date_of_birth + 'T00:00:00Z').getTime()
    const now = Date.now()
    const seventyYearsMs = 70 * 365.25 * 24 * 60 * 60 * 1000
    return dob <= now && now - dob <= seventyYearsMs
  }, { message: 'Date of birth must be in the past and within the last 70 years', path: ['date_of_birth'] })

export type RosterRowInput = z.infer<typeof RosterRowSchema>

// Manual single-player add/edit (UI form). Uses pence and unified field names
// (no CSV underscores). End-to-end validation matches RosterRowSchema rules.
export const ManualPlayerSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    position: POSITION,
    nationality: z.string().trim().max(60).optional(),
    // Optional date of birth — drives the age display only; not used in compliance math.
    dateOfBirth: ISODateString.optional(),
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
    maxEnd.setFullYear(start.getFullYear() + 10)
    return new Date(r.endDate) <= maxEnd
  }, {
    message: 'Contract cannot exceed 10 years',
    path: ['endDate'],
  })
  .refine((r) => {
    if (!r.dateOfBirth) return true
    // Reject future birthdays and impossibly-old players (> 70).
    const dob = new Date(r.dateOfBirth + 'T00:00:00Z').getTime()
    const now = Date.now()
    const seventyYearsMs = 70 * 365.25 * 24 * 60 * 60 * 1000
    return dob <= now && now - dob <= seventyYearsMs
  }, { message: 'Date of birth must be in the past and within the last 70 years', path: ['dateOfBirth'] })

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

// ---------------------------------------------------------------------------
// Manager (Head Coach) + multi-phase contract extension
// ---------------------------------------------------------------------------

// Note: the 10-year cap below is the *signing* limit (catches typos while
// allowing real ultra-long deals). The engine separately caps fee amortisation
// at 5 years.

// Manual single-manager add (UI form). Mirrors ManualPlayerSchema but the
// fee is a "compensation fee" (paid to release them from their old club).
export const ManagerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    compensationFeePence: z.number().int().min(0),
    annualWagePence: z.number().int().positive(),
    agentFeePence: z.number().int().min(0),
    startDate: ISODateString,
    endDate: ISODateString,
  })
  .refine((r) => new Date(r.endDate) > new Date(r.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine((r) => {
    const start = new Date(r.startDate)
    const maxEnd = new Date(start)
    maxEnd.setFullYear(start.getFullYear() + 10)
    return new Date(r.endDate) <= maxEnd
  }, { message: 'Contract cannot exceed 10 years', path: ['endDate'] })

export type ManagerInput = z.infer<typeof ManagerInputSchema>

// Patch manager identity fields (name / active flag).
export const ManagerPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((r) => Object.values(r).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  })

export type ManagerPatchInput = z.infer<typeof ManagerPatchSchema>

// Patch the current contract phase (player or manager) in place — used for
// corrections, NOT extensions. `feePence` is the transfer/compensation fee.
export const PhasePatchSchema = z
  .object({
    feePence:        z.number().int().min(0).optional(),
    annualWagePence: z.number().int().positive().optional(),
    agentFeePence:   z.number().int().min(0).optional(),
    startDate: ISODateString.optional(),
    endDate:   ISODateString.optional(),
  })
  .refine((r) => Object.values(r).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  })

export type PhasePatchInput = z.infer<typeof PhasePatchSchema>

// Log a contract extension. Supersedes the current phase: the server computes
// the carried book value of the existing deal on `effectiveDate` and uses it
// as the new EXTENSION phase's principal. `newWeeklyWagePence` is stored as an
// annual wage (× 52) to match the rest of the roster.
export const ExtendContractSchema = z
  .object({
    effectiveDate: ISODateString,
    newEndDate:    ISODateString,
    newWeeklyWagePence: z.number().int().positive(),
    newAgentFeePence:   z.number().int().min(0),
  })
  .refine((r) => new Date(r.newEndDate) > new Date(r.effectiveDate), {
    message: 'New end date must be after the effective date',
    path: ['newEndDate'],
  })
  .refine((r) => {
    const start = new Date(r.effectiveDate)
    const maxEnd = new Date(start)
    maxEnd.setFullYear(start.getFullYear() + 10)
    return new Date(r.newEndDate) <= maxEnd
  }, { message: 'Extension cannot exceed 10 years', path: ['newEndDate'] })

export type ExtendContractInput = z.infer<typeof ExtendContractSchema>

export type LeagueConfigInput = z.infer<typeof LeagueConfigSchema>
