/**
 * Shared PDF helpers — header, footer, disclaimer, gauge, money formatting.
 *
 * All three PDF exporters (squadPdf, comparisonPdf, future ones) share these
 * primitives so the visual language stays coherent across reports.
 *
 * Design system colours pulled directly from design/UI Kit.html — violet-700
 * for accents, slate for body text, semantic green/amber/red for status.
 */

import jsPDF from 'jspdf'
import { formatPence } from '@headroom/shared'

// Colour tokens copied from design/UI Kit.html so the PDFs match the app.
export const COLOR = {
  violet700:  [109, 40, 217]   as [number, number, number], // #6d28d9
  violet50:   [245, 243, 255]  as [number, number, number],
  violet100:  [237, 233, 254]  as [number, number, number],
  slate900:   [15, 23, 42]     as [number, number, number],
  slate700:   [51, 65, 85]     as [number, number, number],
  slate500:   [100, 116, 139]  as [number, number, number],
  slate400:   [148, 163, 184]  as [number, number, number],
  slate200:   [226, 232, 240]  as [number, number, number],
  slate100:   [241, 245, 249]  as [number, number, number],
  slate50:    [248, 250, 252]  as [number, number, number],
  green600:   [22, 163, 74]    as [number, number, number],
  green100:   [220, 252, 231]  as [number, number, number],
  amber500:   [245, 158, 11]   as [number, number, number],
  amber100:   [254, 243, 199]  as [number, number, number],
  red600:     [220, 38, 38]    as [number, number, number],
  red100:     [254, 226, 226]  as [number, number, number],
  white:      [255, 255, 255]  as [number, number, number],
}

export type ComplianceStatus = 'green' | 'amber' | 'red'

export function statusColor(s: ComplianceStatus): [number, number, number] {
  if (s === 'red')   return COLOR.red600
  if (s === 'amber') return COLOR.amber500
  return COLOR.green600
}

export function statusBgColor(s: ComplianceStatus): [number, number, number] {
  if (s === 'red')   return COLOR.red100
  if (s === 'amber') return COLOR.amber100
  return COLOR.green100
}

export function statusLabel(s: ComplianceStatus): string {
  if (s === 'red')   return 'Points Risk'
  if (s === 'amber') return 'Levy Zone'
  return 'Compliant'
}

// Currency formatting that matches the app exactly. Accepts pence; returns
// a string like "£14,820,000". For negatives we use the same minus glyph
// as the UI (Unicode U+2212) so jspdf doesn't reflow to a hyphen.
export function pdfMoney(pence: number, opts?: { signed?: boolean }): string {
  if (pence == null || !Number.isFinite(pence)) return '—'
  const abs = Math.abs(pence)
  const body = formatPence(Math.round(abs))
  if (opts?.signed && pence > 0) return '+' + body
  if (pence < 0) return '−' + body
  return body
}

export function pdfPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—'
  return (ratio * 100).toFixed(1) + '%'
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

/** Standard footer with page number + the legal disclaimer. Call at the end
 *  of building each page, OR before adding a new page. */
export function addFooter(doc: jsPDF, pageNum: number, totalPages?: number): void {
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()

  doc.setDrawColor(...COLOR.slate100)
  doc.setLineWidth(0.4)
  doc.line(14, h - 18, w - 14, h - 18)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLOR.slate400)
  doc.text(
    'Headroom is a decision-support tool. It does not constitute legal or financial advice.',
    14, h - 10,
  )
  const page = totalPages ? `${pageNum} / ${totalPages}` : String(pageNum)
  doc.text(page, w - 14, h - 10, { align: 'right' })
}

/** Cover/header block at the top of a page. Returns the y-coordinate where
 *  the report body should start. */
export function addHeader(
  doc: jsPDF,
  opts: { clubName: string; reportTitle: string; season: string },
): number {
  const w = doc.internal.pageSize.getWidth()

  // Violet accent bar
  doc.setFillColor(...COLOR.violet700)
  doc.rect(14, 14, 4, 22, 'F')

  // Wordmark
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...COLOR.violet700)
  doc.text('Headroom', 22, 22)

  // Report title
  doc.setFontSize(13)
  doc.setTextColor(...COLOR.slate900)
  doc.text(opts.reportTitle, 22, 32)

  // Right-aligned meta
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR.slate500)
  doc.text(opts.clubName, w - 14, 22, { align: 'right' })
  doc.text(`Season ${opts.season}`, w - 14, 28, { align: 'right' })
  const ts = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  doc.text(`Generated ${ts}`, w - 14, 34, { align: 'right' })

  // Divider
  doc.setDrawColor(...COLOR.slate200)
  doc.setLineWidth(0.4)
  doc.line(14, 42, w - 14, 42)

  return 50
}

/** Section heading with the violet accent bar. */
export function addSectionHeader(
  doc: jsPDF, label: string, y: number,
): number {
  doc.setFillColor(...COLOR.violet700)
  doc.rect(14, y - 4, 2.5, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...COLOR.slate900)
  doc.text(label, 20, y)
  return y + 8
}

/** Status pill — rounded badge with the right semantic background colour. */
export function addStatusPill(
  doc: jsPDF, status: ComplianceStatus, x: number, y: number,
): void {
  const bg = statusBgColor(status)
  const fg = statusColor(status)
  const label = statusLabel(status).toUpperCase()

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  const w = doc.getTextWidth(label) + 8
  doc.setFillColor(...bg)
  doc.roundedRect(x, y - 4.5, w, 6, 3, 3, 'F')
  doc.setTextColor(...fg)
  doc.text(label, x + 4, y)
}

// ---------------------------------------------------------------------------
// Compliance gauge — drawn natively in jsPDF (avoids html2canvas dep)
// ---------------------------------------------------------------------------
/** Render the 0%-to-max% compliance bar showing green/amber/red zones,
 *  threshold markers, and arrows for current + projected SCR positions.
 *
 *  All percentages are 0–100 floats. Returns the next y-coordinate. */
export function addComplianceGauge(
  doc: jsPDF,
  opts: {
    x: number
    y: number
    width: number
    currentPct: number
    projectedPct: number
    greenPct: number
    redPct: number
  },
): number {
  const { x, y, width, currentPct, projectedPct, greenPct, redPct } = opts
  const max = Math.max(redPct + 12, projectedPct + 6, 108)
  const pos = (p: number) => x + (Math.max(0, Math.min(max, p)) / max) * width

  const barY = y + 6
  const barH = 6

  // Zones
  const greenEnd = pos(greenPct)
  const amberEnd = pos(redPct)
  const end = x + width

  doc.setFillColor(...COLOR.green100)
  doc.rect(x, barY, greenEnd - x, barH, 'F')
  doc.setFillColor(...COLOR.amber100)
  doc.rect(greenEnd, barY, amberEnd - greenEnd, barH, 'F')
  doc.setFillColor(...COLOR.red100)
  doc.rect(amberEnd, barY, end - amberEnd, barH, 'F')

  // Outer rounded outline so the bar reads as a single shape
  doc.setDrawColor(...COLOR.slate200)
  doc.setLineWidth(0.4)
  doc.roundedRect(x, barY, width, barH, 1, 1, 'S')

  // Threshold markers
  drawThresholdLine(doc, pos(greenPct), barY, barH, `Green ${greenPct.toFixed(0)}%`)
  drawThresholdLine(doc, pos(redPct),   barY, barH, `Red ${redPct.toFixed(1)}%`)

  // Position arrows + labels
  drawPositionArrow(doc, pos(currentPct), barY, 'Current', `${currentPct.toFixed(1)}%`, COLOR.slate700, 'above')

  // Stagger if the two positions are within ~5% of the bar width
  const projAbove = Math.abs(currentPct - projectedPct) >= (max * 0.05)
  drawPositionArrow(
    doc, pos(projectedPct), barY, 'Projected',
    `${projectedPct.toFixed(1)}%`,
    projectedPct > redPct ? COLOR.red600 : projectedPct > greenPct ? COLOR.amber500 : COLOR.green600,
    projAbove ? 'above' : 'below',
  )

  return y + 24
}

function drawThresholdLine(
  doc: jsPDF, x: number, barY: number, barH: number, label: string,
): void {
  doc.setDrawColor(...COLOR.slate400)
  doc.setLineWidth(0.3)
  doc.setLineDashPattern([1, 1], 0)
  doc.line(x, barY - 1.5, x, barY + barH + 1.5)
  doc.setLineDashPattern([], 0)

  doc.setFontSize(7)
  doc.setTextColor(...COLOR.slate500)
  doc.text(label, x, barY + barH + 5, { align: 'center' })
}

function drawPositionArrow(
  doc: jsPDF,
  x: number, barY: number,
  caption: string, value: string,
  color: [number, number, number],
  side: 'above' | 'below',
): void {
  const yArrow = side === 'above' ? barY - 1.2 : barY + 6 + 1.2

  // Triangle
  doc.setFillColor(...color)
  doc.triangle(
    x - 1.5, yArrow + (side === 'above' ? -0.6 : 0.6),
    x + 1.5, yArrow + (side === 'above' ? -0.6 : 0.6),
    x,       yArrow + (side === 'above' ? -3 : 3),
    'F',
  )

  // Label
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...color)
  const labelY = side === 'above' ? yArrow - 5 : yArrow + 5.5
  doc.text(caption, x, labelY, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...COLOR.slate500)
  doc.text(value, x, labelY + 3, { align: 'center' })
}

/** After laying out all pages, walk the doc and add footers. Call this once
 *  at the very end so we know `totalPages`. */
export function finalizeFooters(doc: jsPDF): void {
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    addFooter(doc, i, totalPages)
  }
}
