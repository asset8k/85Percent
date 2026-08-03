// Native head-coach scraper for the template sync.
//
// The felipeall API wrapper exposes no reliable /staff endpoint, and we only
// need 44 managers, so we fetch the club's Coaching Staff page directly from
// transfermarkt.com and parse the first-team head coach out of the HTML. Kept
// pure + side-effect free (the parser takes an HTML string) so it is unit
// testable without any network; the worker owns the actual fetch.
//
// Page (one HTML fetch per club):
//   https://www.transfermarkt.com/-/mitarbeiter/verein/{clubId}
//
// Structure (verified against live HTML):
//   <h2 ...> Coaching Staff </h2>
//   <table> ... <tbody>
//     <tr><td><table class="inline-table">
//       <tr> <td><img .../></td> <td class="hauptlink"><a id="94579" href="...">NAME</a></td> </tr>
//       <tr> <td>ROLE</td> </tr>
//     </table></td>
//     <td class="zentriert">AGE</td>
//     <td class="zentriert"><img title="NATIONALITY" class="flaggenrahmen" /></td>
//     <td class="zentriert">APPOINTED (DD/MM/YYYY)</td>
//     <td class="zentriert">CONTRACT EXPIRES (DD/MM/YYYY or " - ")</td>
//     <td class="zentriert">LAST CLUB</td>
//   </tr> ...

export interface ScrapedCoach {
  name: string
  role: string
  nationality: string | null
  // DD/MM/YYYY → ISO YYYY-MM-DD, or null. (The listing carries Age, not DOB, so
  // dateOfBirth is intentionally absent — we don't fetch each coach's profile.)
  appointed: string | null
  contractExpires: string | null
}

// Roles that ARE the first-team head coach, in priority order. Transfermarkt
// labels the senior role "Manager" (English clubs) or "Head Coach"; a caretaker
// is the active first-team boss when there's no permanent appointment.
const HEAD_ROLE_PRIORITY = [
  /^manager$/i,
  /^head coach$/i,
  /^caretaker manager$/i,
  /^caretaker head coach$/i,
  /^interim (manager|head coach)$/i,
  /manager/i,
  /head coach/i,
]
// Roles to never treat as the head coach even if they contain "manager"/"coach".
const NON_HEAD_RE = /assistant|goalkeep|fitness|set[\s-]?piece|u-?\d|under[\s-]?\d|youth|academy|reserve|conditioning|analyst|scout|physio|rehab|loan|technical director|sporting director/i

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// DD/MM/YYYY → YYYY-MM-DD. Returns null for "-", blanks, or unparseable input.
export function parseStaffDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = stripTags(String(raw))
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m || !m[1] || !m[2] || !m[3]) return null
  const dd = m[1].padStart(2, '0')
  const mm = m[2].padStart(2, '0')
  return `${m[3]}-${mm}-${dd}`
}

// Slice out the <tbody>…</tbody> that follows the "Coaching Staff" headline.
function coachingStaffTbody(html: string): string | null {
  const head = html.search(/Coaching Staff/i)
  if (head === -1) return null
  const tbodyStart = html.indexOf('<tbody', head)
  if (tbodyStart === -1) return null
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart)
  if (tbodyEnd === -1) return null
  return html.slice(tbodyStart, tbodyEnd)
}

// Parse one outer staff <tr> (the cell layout above) into a ScrapedCoach.
function parseStaffRow(rowHtml: string): ScrapedCoach | null {
  // Name: the hauptlink anchor inside the inline-table.
  const nameM = rowHtml.match(/class="hauptlink">\s*<a[^>]*>([^<]+)<\/a>/i)
  const name = nameM?.[1] ? stripTags(nameM[1]) : null
  if (!name) return null

  // Role: the second inner <tr>'s <td> (the line under the name).
  const roleM = rowHtml.match(/<tr>\s*<td>([^<]+)<\/td>\s*<\/tr>\s*<\/table>/i)
  const role = roleM?.[1] ? stripTags(roleM[1]) : ''

  // Nationality: the flag image title in the outer cells.
  const natM =
    rowHtml.match(/class="flaggenrahmen"[^>]*title="([^"]+)"/i) ||
    rowHtml.match(/title="([^"]+)"[^>]*class="flaggenrahmen"/i)
  const nationality = natM?.[1] ? stripTags(natM[1]) : null

  // The outer "zentriert" cells, in order: Age, Nat(flag), Appointed, Contract,
  // Last club. Pull the date-shaped ones for appointed + contract.
  const dates = [...rowHtml.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)].map((m) => m[1] ?? '')
  const appointed = dates[0] ? parseStaffDate(dates[0]) : null
  const contractExpires = dates[1] ? parseStaffDate(dates[1]) : null

  return { name, role, nationality, appointed, contractExpires }
}

// Split the tbody into outer staff rows. Each staff member starts a new outer
// <tr> whose first child is the inline-table wrapper.
function splitStaffRows(tbody: string): string[] {
  // The outer rows are delimited by `<tr>\n<td>\n<table class="inline-table">`.
  const parts = tbody.split(/<tr>\s*<td>\s*<table class="inline-table">/i)
  // parts[0] is whatever preceded the first row; re-attach the marker to the rest.
  return parts.slice(1).map((p) => '<table class="inline-table">' + p)
}

// Extract every coach listed on the staff page (in page order).
export function parseCoachingStaff(html: string): ScrapedCoach[] {
  const tbody = coachingStaffTbody(html)
  if (!tbody) return []
  const out: ScrapedCoach[] = []
  for (const row of splitStaffRows(tbody)) {
    const coach = parseStaffRow(row)
    if (coach) out.push(coach)
  }
  return out
}

// Pick the first-team head coach: the highest-priority head role that is not an
// assistant/youth/etc. Returns null when the page lists no senior coach.
export function selectHeadCoachFromStaff(coaches: ScrapedCoach[]): ScrapedCoach | null {
  const eligible = coaches.filter((c) => !NON_HEAD_RE.test(c.role))
  for (const rx of HEAD_ROLE_PRIORITY) {
    const hit = eligible.find((c) => rx.test(c.role))
    if (hit) return hit
  }
  return null
}

// Convenience: HTML → the one head coach (or null).
export function extractHeadCoach(html: string): ScrapedCoach | null {
  return selectHeadCoachFromStaff(parseCoachingStaff(html))
}
