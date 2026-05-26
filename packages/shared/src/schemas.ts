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

export type LeagueConfigInput = z.infer<typeof LeagueConfigSchema>
export type ClubFinancialsInput = z.infer<typeof ClubFinancialsSchema>
export type TransferInputData = z.infer<typeof TransferInputSchema>
export type TransferFormData = z.infer<typeof TransferFormSchema>
export type ClubFinancialsFormData = z.infer<typeof ClubFinancialsInputSchema>
