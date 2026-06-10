import { z } from 'zod'

/**
 * demoRequest — the zod contract for a lead, shared by the dialog form and the
 * server route (spec §5b.3). One schema keeps client validation and the
 * server-side insert in lockstep, and the length caps mirror the DB CHECK
 * constraints so a value that passes here also passes Postgres.
 *
 * `company` is a honeypot: a hidden field no human fills. A non-empty value means
 * a bot, and the route silently drops the request (see route.ts).
 */
export const demoRequestSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your full name').max(120),
  workEmail: z
    .string()
    .trim()
    .min(3, 'Enter your work email')
    .max(254, 'That email is too long')
    .email('Enter a valid email'),
  club: z.string().trim().max(120).optional().or(z.literal('')),
  role: z.string().trim().max(120).optional().or(z.literal('')),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  /** Which CTA fired — navbar / hero / footer. Diagnostic only. */
  source: z.string().trim().max(40).optional().or(z.literal('')),
  /** Honeypot — hidden from humans; bots tend to fill it. Accepted by the schema
   *  (so it never 422s and tips off the bot); the route silently drops any
   *  request where this is non-empty. Capped only to bound the payload. */
  company: z.string().max(200).optional(),
})

export type DemoRequestInput = z.infer<typeof demoRequestSchema>

/** The row shape inserted into Supabase `demo_requests` (DB column names). */
export interface DemoRequestRow {
  full_name: string | null
  work_email: string
  club: string | null
  role: string | null
  message: string | null
  source: string | null
}

/** Map a validated form input to the DB row, normalising empty strings to null. */
export function toRow(input: DemoRequestInput): DemoRequestRow {
  const nn = (v: string | undefined) => (v && v.trim() ? v.trim() : null)
  return {
    full_name: nn(input.fullName),
    work_email: input.workEmail.trim(),
    club: nn(input.club),
    role: nn(input.role),
    message: nn(input.message),
    source: nn(input.source),
  }
}
