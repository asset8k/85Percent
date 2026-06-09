import { NextResponse } from 'next/server'
import { demoRequestSchema, toRow } from '@/lib/demoRequest'
import { getSupabaseAnon } from '@/lib/supabase'

// Lead capture is dynamic and runs in the Node runtime (uses the Supabase client
// + per-instance rate-limit memory). It must never be statically cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/demo-request — the server side of the lead form (spec §5b.3).
 *
 * Why a route, not a browser→Supabase call: it lets us validate with the shared
 * zod schema, screen with a honeypot, and apply lightweight per-IP rate-limiting
 * before the insert. It uses the ANON Supabase client — even the server half of
 * the landing app cannot read core data. On success it returns 200; the row is
 * triaged later service-role-side.
 */

// Lightweight in-memory rate limit: max N inserts per IP per window. Per-instance
// only (resets on cold start) — a coarse abuse blunt, not a security boundary;
// the DB RLS + CHECK constraints are the real guarantees.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > MAX_PER_WINDOW
}

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = demoRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed.' },
      { status: 422 },
    )
  }

  // Honeypot: a filled `company` means a bot. Respond 200 so the bot sees
  // success and moves on, but drop the submission silently — no DB write.
  if (parsed.data.company && parsed.data.company.length > 0) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429 },
    )
  }

  try {
    const supabase = getSupabaseAnon()
    const { error } = await supabase.from('demo_requests').insert(toRow(parsed.data))
    if (error) {
      console.error('demo_requests insert failed:', error.message)
      return NextResponse.json({ error: 'Could not submit your request.' }, { status: 502 })
    }
  } catch (err) {
    console.error('demo-request route error:', err)
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
