// Unit tests for the native squad-number ("kader") scraper. Run with:
//   pnpm --filter @headroom/api test:scripts
// No network — the parser takes an HTML string. The fixture mirrors the real
// transfermarkt.com kader markup (rn_nummer cell + /profil/spieler/{id} link).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSquadNumbers } from './transfermarkt-squad-scraper.js'

// Three rows: GK #23, a #1 captain, and an unassigned ("-") squad member.
const KADER_HTML = `
<table class="items"><tbody>
  <tr>
    <td class="zentriert rueckennummer bg_Torwart" title="Goalkeeper"><div class="rn_nummer">23</div></td>
    <td class="posrela"><table class="inline-table">
      <tr><td rowspan="2"><img data-src="x.jpg" title="Emiliano Martínez" /></td>
          <td class="hauptlink"><a href="/emiliano-martinez/profil/spieler/111873"> Emiliano Martínez </a></td></tr>
      <tr><td> Goalkeeper </td></tr>
    </table></td>
    <td class="zentriert">02/09/1992 (33)</td>
  </tr>
  <tr>
    <td class="zentriert rueckennummer" title="Captain"><div class="rn_nummer">1</div></td>
    <td class="posrela"><table class="inline-table">
      <tr><td rowspan="2"><img data-src="y.jpg" title="Skipper" /></td>
          <td class="hauptlink"><a href="/skipper/profil/spieler/555"> Skipper </a></td></tr>
      <tr><td> Centre-Back </td></tr>
    </table></td>
  </tr>
  <tr>
    <td class="zentriert rueckennummer"><div class="rn_nummer">-</div></td>
    <td class="posrela"><table class="inline-table">
      <tr><td rowspan="2"><img data-src="z.jpg" title="Youngster" /></td>
          <td class="hauptlink"><a href="/youngster/profil/spieler/999"> Youngster </a></td></tr>
      <tr><td> Midfield </td></tr>
    </table></td>
  </tr>
</tbody></table>`

describe('parseSquadNumbers', () => {
  it('maps player id → shirt number from the kader page', () => {
    const map = parseSquadNumbers(KADER_HTML)
    assert.equal(map.get('111873'), 23)
    assert.equal(map.get('555'), 1)
  })
  it('skips unassigned ("-") numbers', () => {
    const map = parseSquadNumbers(KADER_HTML)
    assert.equal(map.has('999'), false)
  })
  it('records the first id per row (image + name link share the id)', () => {
    // Both the portrait <img> wrapper and the name link can reference the same
    // player; the number must attach once, not bleed into the next player.
    const map = parseSquadNumbers(KADER_HTML)
    assert.equal(map.size, 2)
  })
  it('returns an empty map for unrelated / empty HTML', () => {
    assert.equal(parseSquadNumbers('<html><body>nothing</body></html>').size, 0)
    assert.equal(parseSquadNumbers('').size, 0)
  })
})
