// Native player-profile scraper for the template sync.
//
// The felipeall /clubs/{id}/players endpoint exposes `joinedOn` and `contract`
// (expiry) but NOT the date a deal was last extended/renewed. That date only
// lives on the individual player's profile page, in the "Player data" box. We
// fetch that one HTML document per player and parse the contract dates out of
// it. Pure + side-effect free (the parser takes an HTML string) so it is unit
// testable without any network; the worker owns the actual fetch + throttle.
//
// Page (one HTML fetch per player):
//   https://www.transfermarkt.com/-/profil/spieler/{playerId}
//
// Structure (verified against live HTML — modern info-table layout):
//   <span class="info-table__content ...--regular">Date of last contract extension:</span>
//   <span class="info-table__content ...--bold">May 31, 2026</span>
// Older layouts use <th>label</th><td>value</td>. Rather than couple to either,
// we locate the label text and grab the next date-shaped token after it, which
// is resilient to both markups. Values are Transfermarkt's own "Mon DD, YYYY"
// strings, left as-is so the shared parseTransfermarktDate handles them.

// The profile "Player data" box renders dates as DD/MM/YYYY (e.g. "21/08/2024");
// some locales/fields use "Mon DD, YYYY" / "Sept. 1, 2023". We match either and
// normalise to ISO (YYYY-MM-DD) — JS's Date.parse mis-reads "21/08/2024" as
// MM/DD, so we must convert the slash form ourselves.
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/
const TEXT_DATE = /\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),\s*(\d{4})\b/

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
}

export interface ScrapedPlayerDates {
  // ISO YYYY-MM-DD strings (or null), normalised from whatever format the page
  // used so downstream parseTransfermarktDate (Date.parse) reads them correctly.
  lastExtension: string | null
  joined: string | null
  contractExpires: string | null
}

// Find the first date that appears just after a label and normalise it to ISO.
// We search a bounded window (the value immediately follows its label) so an
// unrelated later date can't bleed in. Returns null when the label is absent or
// no date follows it.
function dateAfterLabel(html: string, labelRe: RegExp): string | null {
  const m = labelRe.exec(html)
  if (!m) return null
  const from = m.index + m[0].length
  const window = html.slice(from, from + 300)

  const slash = window.match(SLASH_DATE)
  if (slash) {
    const [, dd, mm, yyyy] = slash
    return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`
  }
  const text = window.match(TEXT_DATE)
  if (text) {
    const mon = MONTHS[text[1]!.toLowerCase()]
    if (mon) return `${text[3]}-${mon}-${text[2]!.padStart(2, '0')}`
  }
  return null
}

// Parse the contract dates out of a player profile page. Every field degrades
// to null independently, so a page missing the extension row still yields the
// joined / expiry dates (and vice versa).
export function parsePlayerContractDates(html: string): ScrapedPlayerDates {
  return {
    // "Date of last contract extension:" — the field we actually came for.
    lastExtension: dateAfterLabel(html, /last contract extension:?/i),
    joined: dateAfterLabel(html, /\bJoined:?/i),
    contractExpires: dateAfterLabel(html, /Contract expires:?/i),
  }
}
