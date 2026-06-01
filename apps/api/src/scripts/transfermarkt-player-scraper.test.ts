// Unit tests for the native player-profile scraper. Run with:
//   pnpm --filter @headroom/api test:scripts
// No network — the parser takes an HTML string. The fixtures mirror the real
// transfermarkt.com "Player data" box (modern info-table span layout + the
// older <th>/<td> layout) so the label→date extraction is exercised on both.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlayerContractDates } from './transfermarkt-player-scraper.js'

// Real modern info-table layout — dates are DD/MM/YYYY (verified against live
// HTML), label span immediately followed by a bold value span. Output is ISO.
const MODERN_HTML = `
<div class="info-table info-table--right-space">
  <span class="info-table__content info-table__content--regular">Joined:</span>
  <span class="info-table__content info-table__content--bold">01/07/2018</span>
  <span class="info-table__content info-table__content--regular">Contract expires:</span>
  <span class="info-table__content info-table__content--bold">30/06/2028</span>
  <span class="info-table__content info-table__content--regular">Last contract extension:</span>
  <span class="info-table__content info-table__content--bold">21/08/2024</span>
</div>
`

// Older / alternate layout using textual "Mon DD, YYYY" dates and <th>/<td>.
const TEXT_HTML = `
<table class="auflistung"><tr>
  <th>Joined:</th><td>Sep 1, 2023</td>
</tr><tr>
  <th>Contract expires:</th><td>Jun 30, 2033</td>
</tr></table>
`

describe('parsePlayerContractDates', () => {
  it('extracts DD/MM/YYYY dates and normalises them to ISO', () => {
    const d = parsePlayerContractDates(MODERN_HTML)
    assert.equal(d.lastExtension, '2024-08-21')
    assert.equal(d.joined, '2018-07-01')
    assert.equal(d.contractExpires, '2028-06-30')
  })

  it('also handles textual "Mon DD, YYYY" dates → ISO', () => {
    const d = parsePlayerContractDates(TEXT_HTML)
    assert.equal(d.lastExtension, null) // never extended → no row
    assert.equal(d.joined, '2023-09-01')
    assert.equal(d.contractExpires, '2033-06-30')
  })

  it('does not confuse "Contract expires" with the extension date', () => {
    const html = `<span>Contract expires:</span><span>30/06/2030</span>`
    const d = parsePlayerContractDates(html)
    assert.equal(d.lastExtension, null)
    assert.equal(d.contractExpires, '2030-06-30')
  })

  it('tolerates abbreviated months with a trailing dot (e.g. "Sept. 1, 2023")', () => {
    const html = `<span>Last contract extension:</span><span>Sept. 1, 2023</span>`
    assert.equal(parsePlayerContractDates(html).lastExtension, '2023-09-01')
  })

  it('returns all-null for markup with no recognisable dates', () => {
    const d = parsePlayerContractDates('<div>no useful data here</div>')
    assert.deepEqual(d, { lastExtension: null, joined: null, contractExpires: null })
  })
})
