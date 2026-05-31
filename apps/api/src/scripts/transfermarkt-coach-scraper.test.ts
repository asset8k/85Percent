// Unit tests for the native head-coach HTML scraper. Run with:
//   pnpm --filter @headroom/api test:scripts
// No network — the parser takes an HTML string. The fixture mirrors the real
// transfermarkt.com Coaching Staff markup captured from a live club page.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseStaffDate,
  parseCoachingStaff,
  selectHeadCoachFromStaff,
  extractHeadCoach,
} from './transfermarkt-coach-scraper.js'

// A trimmed Coaching Staff table: an assistant first, then the Manager, then a
// goalkeeping coach — exercises role discrimination and ordering.
const STAFF_HTML = `
<div class="box">
  <h2 class="content-box-headline"> Coaching Staff </h2>
  <div class="responsive-table"><table><thead><tr>
    <th>Name/Position</th><th>Age</th><th>Nat.</th><th>Appointed</th><th>Contract expires</th><th>Last club</th>
  </tr></thead><tbody>
    <tr> <td> <table class="inline-table">
      <tr> <td rowspan="2"><img src="x.jpg" title="Willy Caballero" /></td>
           <td class="hauptlink"><a title="Willy Caballero" id="111" href="/willy/profil/trainer/111">Willy Caballero</a></td> </tr>
      <tr> <td>Assistant Manager</td> </tr>
    </table> </td>
    <td class="zentriert">43</td>
    <td class="zentriert"><img class="flaggenrahmen" title="Argentina" alt="Argentina" /></td>
    <td class="zentriert">01/07/2024</td>
    <td class="zentriert"> - </td>
    <td class="zentriert"><a href="#"><img title="Chelsea FC" /></a></td>
    </tr>
    <tr> <td> <table class="inline-table">
      <tr> <td rowspan="2"><img src="y.jpg" title="Enzo Maresca" /></td>
           <td class="hauptlink"><a title="Enzo Maresca" id="222" href="/enzo/profil/trainer/222">Enzo Maresca</a></td> </tr>
      <tr> <td>Manager</td> </tr>
    </table> </td>
    <td class="zentriert">45</td>
    <td class="zentriert"><img class="flaggenrahmen" title="Italy" alt="Italy" /></td>
    <td class="zentriert">01/06/2024</td>
    <td class="zentriert">30/06/2029</td>
    <td class="zentriert"><a href="#"><img title="Leicester City" /></a></td>
    </tr>
    <tr> <td> <table class="inline-table">
      <tr> <td rowspan="2"><img src="z.jpg" title="Henrique Hilario" /></td>
           <td class="hauptlink"><a title="Henrique Hilario" id="333" href="/hilario/profil/trainer/333">Henrique Hilario</a></td> </tr>
      <tr> <td>Goalkeeping Coach</td> </tr>
    </table> </td>
    <td class="zentriert">49</td>
    <td class="zentriert"><img class="flaggenrahmen" title="Portugal" alt="Portugal" /></td>
    <td class="zentriert">01/07/2014</td>
    <td class="zentriert"> - </td>
    <td class="zentriert"><a href="#"><img title="Chelsea FC" /></a></td>
    </tr>
  </tbody></table></div>
</div>`

describe('parseStaffDate', () => {
  it('converts DD/MM/YYYY to ISO', () => {
    assert.equal(parseStaffDate('30/06/2029'), '2029-06-30')
    assert.equal(parseStaffDate('01/6/2024'), '2024-06-01')
  })
  it('returns null for dashes / blanks / garbage', () => {
    assert.equal(parseStaffDate(' - '), null)
    assert.equal(parseStaffDate(''), null)
    assert.equal(parseStaffDate(null), null)
    assert.equal(parseStaffDate('soon'), null)
  })
})

describe('parseCoachingStaff', () => {
  it('parses every staff row with name, role, nationality, dates', () => {
    const staff = parseCoachingStaff(STAFF_HTML)
    assert.equal(staff.length, 3)
    const maresca = staff.find((c) => c.name === 'Enzo Maresca')!
    assert.ok(maresca)
    assert.equal(maresca.role, 'Manager')
    assert.equal(maresca.nationality, 'Italy')
    assert.equal(maresca.appointed, '2024-06-01')
    assert.equal(maresca.contractExpires, '2029-06-30')
  })
  it('returns [] when the page has no Coaching Staff section', () => {
    assert.deepEqual(parseCoachingStaff('<html><body>nope</body></html>'), [])
  })
})

describe('selectHeadCoachFromStaff', () => {
  it('picks the Manager, not the assistant or GK coach', () => {
    const coach = selectHeadCoachFromStaff(parseCoachingStaff(STAFF_HTML))
    assert.equal(coach?.name, 'Enzo Maresca')
  })
  it('falls back to a caretaker manager when no permanent manager exists', () => {
    const coach = selectHeadCoachFromStaff([
      { name: 'Asst', role: 'Assistant Manager', nationality: null, appointed: null, contractExpires: null },
      { name: 'Caretaker', role: 'Caretaker Manager', nationality: null, appointed: null, contractExpires: null },
    ])
    assert.equal(coach?.name, 'Caretaker')
  })
  it('returns null when only non-head roles are present', () => {
    const coach = selectHeadCoachFromStaff([
      { name: 'GK', role: 'Goalkeeping Coach', nationality: null, appointed: null, contractExpires: null },
      { name: 'Doc', role: 'Physiotherapist', nationality: null, appointed: null, contractExpires: null },
    ])
    assert.equal(coach, null)
  })
})

describe('extractHeadCoach (HTML → coach)', () => {
  it('end-to-end returns the head coach from a staff page', () => {
    const coach = extractHeadCoach(STAFF_HTML)
    assert.equal(coach?.name, 'Enzo Maresca')
    assert.equal(coach?.nationality, 'Italy')
    assert.equal(coach?.contractExpires, '2029-06-30')
  })
})
