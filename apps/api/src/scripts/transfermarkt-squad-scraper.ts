// Native squad-number scraper for the template sync.
//
// The felipeall /clubs/{id}/players endpoint carries no shirt number, and the
// bio-only model makes no per-player profile calls. But shirt numbers ARE on the
// club's detailed squad ("kader") page, so we fetch that one HTML document per
// club and pair each number with its player id. Pure + side-effect free (takes
// an HTML string) so it is unit-testable without any network.
//
// Page (one HTML fetch per club):
//   https://www.transfermarkt.com/-/kader/verein/{clubId}/saison_id/{season}/plus/1
//
// Structure (verified against live HTML):
//   <td ...><div class="rn_nummer">23</div></td>
//   ... <td class="hauptlink"><a href="/emiliano-martinez/profil/spieler/111873"> … </a>
// Unassigned numbers render as "-" (→ null).

import { parseShirtNumber } from './transfermarkt-mappers.js'

// Parse the kader HTML into a map of transfermarkt player id → shirt number.
// Each row leads with an `rn_nummer` div, then the player's `/profil/spieler/{id}`
// link. We walk both token types in document order and pair every number with
// the next player id we haven't recorded yet (a player id appears more than once
// per row — image + name link — so we keep only the first).
export function parseSquadNumbers(html: string): Map<string, number> {
  const out = new Map<string, number>()
  const token = /<div[^>]*class="?rn_nummer"?[^>]*>([^<]*)<\/div>|\/profil\/spieler\/(\d+)/gi
  let pending: number | null | undefined // undefined = none seen yet for this row
  let m: RegExpExecArray | null
  while ((m = token.exec(html)) !== null) {
    if (m[1] !== undefined) {
      // A shirt-number cell — remember it for the next player id in this row.
      pending = parseShirtNumber(m[1])
    } else if (m[2]) {
      const id = m[2]
      if (pending != null && !out.has(id)) out.set(id, pending)
      // Reset so a player id without its own number cell can't inherit a stale one.
      pending = undefined
    }
  }
  return out
}
