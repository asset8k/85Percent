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
  // Date the current deal was last extended/renewed, when the scraper exposes
  // it ("lastExtension" / "last_extension" / "contractExtension" all seen).
  lastExtension?: string | null
  last_extension?: string | null
  contractExtension?: string | null
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
  /**
   * The date the player originally joined the club, preserved independently of
   * `contractStart`. When a deal has been extended, `contractStart` holds the
   * extension date while this keeps the original signing date for display /
   * tenure context. Null when unknown.
   */
  joinedDate: Date | null
  /**
   * True when `contractStart` was derived from a last_extension date — i.e. the
   * snapshot is the back end of an existing deal, not the original signing. The
   * UI uses this to auto-reveal the Carried Book Value field (the original fee
   * is unknown, so the CFO must record the remaining NBV to amortise correctly).
   */
  contractStartFromExtension: boolean
}

// Start of the football financial year (1 July) for the season containing
// `now`. Used as the last-resort contract-start fallback when a template row
// has neither an extension nor a joined date.
export function financialYearStart(now: Date = new Date()): Date {
  const year = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return new Date(Date.UTC(year, 6, 1))
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

const TRANSFERMARKT_MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

function utcCalendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month
    && date.getUTCDate() === day
    ? date
    : null
}

// Parse Transfermarkt's date-only strings as UTC calendar dates. Date.parse
// treats some text formats as local time, which can shift stored dates by a day.
export function parseTransfermarktDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const cleaned = raw.trim()
  if (!cleaned || cleaned === '-') return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned)
  if (iso) return utcCalendarDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))

  const text = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(cleaned)
  if (text) {
    const month = TRANSFERMARKT_MONTHS[text[1]!.slice(0, 3).toLowerCase()]
    return month == null ? null : utcCalendarDate(Number(text[3]), month, Number(text[2]))
  }

  const ts = Date.parse(cleaned)
  if (Number.isNaN(ts)) return null
  return new Date(ts)
}

// Parse a Transfermarkt shirt number into 1–99, or null. Kept as a small, tested
// utility (e.g. for CSV import / future enrichment); the bio-only sync no longer
// fetches shirt numbers, so the worker doesn't call it.
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
export function mapPlayerToRosterItem(
  p: TransfermarktPlayer,
  now: Date = new Date(),
): TemplateRosterItemInput | null {
  const name = (p.name ?? '').trim()
  if (!name) return null

  // Start-date logic: a last_extension date means this is the current
  // (extension) block of an ongoing deal — prefer it. Otherwise fall back to
  // the joined date, then to the start of the current financial year.
  const extension = parseTransfermarktDate(p.lastExtension ?? p.last_extension ?? p.contractExtension ?? null)
  const joined = parseTransfermarktDate(p.joinedOn ?? p.joined ?? null)
  const contractStart = extension ?? joined ?? financialYearStart(now)

  return {
    name,
    dateOfBirth: parseTransfermarktDate(p.dateOfBirth),
    nationality: normaliseNationality(p.nationality),
    position: mapPosition(p.position),
    // The bulk squad endpoint carries no shirt number, and the bio-only model
    // makes no per-player profile call to fetch one, so squadNumber stays null.
    squadNumber: null,
    isManager: false,
    // BIO-ONLY ingestion: we no longer scrape any fee or market value. The fee
    // is left NULL so the CFO must enter their own official accounting figure;
    // hydration forces wages to 0 for the same reason.
    estimatedTransferFee: null,
    contractStart,
    contractEnd: parseTransfermarktDate(p.contract),
    // Original signing date, kept even when contractStart is an extension date.
    joinedDate: joined,
    contractStartFromExtension: extension != null,
  }
}

// Map a head coach into a roster item (BIO-ONLY). Managers carry no playing
// position. All financial fields are left null — the CFO enters the official
// figures on the Roster page. The staff listing exposes Age, not date of birth,
// and we make no per-coach profile call, so dateOfBirth stays null too.
// Returns null when the name is blank.
export function mapCoachToRosterItem(
  name: string | null | undefined,
  opts: {
    joined?: string | null
    contract?: string | null
    nationality?: string[] | string | null
  } = {},
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
    // For a coach, "joined" is the appointment date — same as the contract start.
    joinedDate: parseTransfermarktDate(opts.joined ?? null),
    // A coach record is the appointment itself, never an extension block.
    contractStartFromExtension: false,
  }
}
