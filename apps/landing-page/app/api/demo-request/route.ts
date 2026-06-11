import { NextResponse } from 'next/server'
import { demoRequestSchema, toRow } from '@/lib/demoRequest'
import { getSupabaseAnon } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/ratelimit'

// Lead capture is dynamic and runs in the Node runtime (uses the Supabase client
// + the Upstash rate limiter). It must never be statically cached.
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

  // Strict per-IP limit (3/hour, Upstash-backed). A real club fills this in once;
  // anything beyond that from one address is a bot. 429 + a polite, surfaced message.
  const { success } = await checkRateLimit(clientIp(req))
  if (!success) {
    return NextResponse.json(
      { error: "You've submitted too many requests. Please try again later." },
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
