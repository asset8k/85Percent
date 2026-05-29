// Pure mapping helpers that translate raw felipeall/transfermarkt-api payloads
// into our TemplateRosterItem shape. Deliberately side-effect free (no DB / no
// env imports) so they can be unit-tested in isolation — see
// transfermarkt-mappers.test.ts.

export type TemplateLeagueValue = 'PREMIER_LEAGUE' | 'CHAMPIONSHIP'
export type TemplatePositionValue = 'GK' | 'DEF' | 'MID' | 'FWD'

// Partial shape of a player row from GET /clubs/{id}/players. The scraper is an
// unofficial DOM scraper, so every field is treated as optional / untrusted.
export interface TransfermarktPlayer {
  id?: string
  name?: string
  position?: string | null
  dateOfBirth?: string | null
  nationality?: string[] | string | null
  joined?: string | null
  joinedOn?: string | null
  signedFrom?: string | null
  contract?: string | null // contract expiry, e.g. "Jun 30, 2027"
  marketValue?: number | string | null
}

// The normalised row we insert into template_roster_items.
export interface TemplateRosterItemInput {
  name: string
  dateOfBirth: Date | null
  nationality: string | null
  position: TemplatePositionValue | null
  squadNumber: number | null
  isManager: boolean
  estimatedTransferFee: bigint | null
  contractStart: Date | null
  contractEnd: Date | null
}

// Map a free-text Transfermarkt position ("Centre-Back", "Left Winger", …) onto
// our four-bucket enum. Keyword rules keep this resilient to the scraper's many
// position variants. Returns null when the position is unknown/blank.
export function mapPosition(raw: string | null | undefined): TemplatePositionValue | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (s.includes('keeper') || s === 'gk') return 'GK'
  // Check midfield before defence/attack so "Defensive Midfield" and
  // "Attacking Midfield" resolve to MID, not DEF/FWD.
  if (s.includes('midfield')) return 'MID'
  if (s.includes('back') || s.includes('defen') || s.includes('sweeper')) return 'DEF'
  if (s.includes('wing') || s.includes('forward') || s.includes('strik') || s.includes('attack')) return 'FWD'
  return null
}

// Parse Transfermarkt's date strings ("Mar 13, 1990", "Jun 30, 2027") or ISO
// dates. Returns null for blanks, "-", or anything unparseable.
export function parseTransfermarktDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const cleaned = raw.trim()
  if (!cleaned || cleaned === '-') return null
  const ts = Date.parse(cleaned)
  if (Number.isNaN(ts)) return null
  return new Date(ts)
}

// Convert a market value into integer pence. The scraper returns either a raw
// number (major currency units, e.g. 50000000) or a suffixed string
// ("€50.00m", "€800k"). This is a template estimate used only to seed an
// initial transfer fee on hydration; no FX conversion is applied (the minor
// unit is treated as pence). Returns null for missing / non-positive values.
export function parseMarketValueToPence(raw: number | string | null | undefined): bigint | null {
  if (raw == null) return null

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null
    return BigInt(Math.round(raw * 100))
  }

  const s = raw.trim().toLowerCase()
  if (!s || s === '-') return null

  const match = s.match(/([\d.,]+)\s*(bn|m|k|th\.?)?/)
  if (!match || !match[1]) return null

  const num = parseFloat(match[1].replace(/,/g, ''))
  if (!Number.isFinite(num) || num <= 0) return null

  let multiplier = 1
  switch (match[2]) {
    case 'bn':
      multiplier = 1_000_000_000
      break
    case 'm':
      multiplier = 1_000_000
      break
    case 'k':
    case 'th':
    case 'th.':
      multiplier = 1_000
      break
  }

  return BigInt(Math.round(num * multiplier * 100))
}

// Parse a Transfermarkt shirt number into 1–99, or null. The profile endpoint
// returns it as a string like "#10" (sometimes "-" or empty / a bare number).
export function parseShirtNumber(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  const digits = String(raw).replace(/[^0-9]/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  if (!Number.isInteger(n) || n < 1 || n > 99) return null
  return n
}

// Transfermarkt sometimes returns nationality as an array (dual nationals) and
// sometimes as a string. We keep the primary nationality only.
export function normaliseNationality(n: string[] | string | null | undefined): string | null {
  if (!n) return null
  if (Array.isArray(n)) return n.length ? (n[0]?.trim() || null) : null
  const t = n.trim()
  return t ? t : null
}

// Map one scraped player into a roster-item insert. Returns null when the row
// has no usable name (the only field we hard-require).
export function mapPlayerToRosterItem(p: TransfermarktPlayer): TemplateRosterItemInput | null {
  const name = (p.name ?? '').trim()
  if (!name) return null

  return {
    name,
    dateOfBirth: parseTransfermarktDate(p.dateOfBirth),
    nationality: normaliseNationality(p.nationality),
    position: mapPosition(p.position),
    // The squad endpoint carries no shirt number; the worker enriches this from
    // the per-player profile (parseShirtNumber). Defaults to null here.
    squadNumber: null,
    isManager: false,
    estimatedTransferFee: parseMarketValueToPence(p.marketValue),
    contractStart: parseTransfermarktDate(p.joinedOn ?? p.joined ?? null),
    contractEnd: parseTransfermarktDate(p.contract),
  }
}

// Map a head coach into a roster item. Managers carry no playing position and
// no market-value fee. Returns null when the name is blank.
export function mapCoachToRosterItem(
  name: string | null | undefined,
  opts: { joined?: string | null; contract?: string | null; nationality?: string[] | string | null } = {},
): TemplateRosterItemInput | null {
  const clean = (name ?? '').trim()
  if (!clean) return null

  return {
    name: clean,
    dateOfBirth: null,
    nationality: normaliseNationality(opts.nationality),
    position: null,
    squadNumber: null,
    isManager: true,
    estimatedTransferFee: null,
    contractStart: parseTransfermarktDate(opts.joined ?? null),
    contractEnd: parseTransfermarktDate(opts.contract ?? null),
  }
}
