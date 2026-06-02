/**
 * Shared Excel helpers — workbook factory, money formatting, column sizing.
 *
 * SheetJS Community Edition can write XLSX without licensing issues. The
 * Community build does NOT support styling (bold/colors); for that you'd
 * need xlsx-style or the Pro build. We deliberately keep formatting to what
 * Community supports — number formats + column widths + frozen panes — so
 * the export is portable across Excel, Numbers, and Google Sheets.
 */

import * as XLSX from 'xlsx'
import { exportMoneyFormat } from './exportCurrency'

/** Number format used for every money column in every sheet, in the active
 *  export currency (£ / € / $). A function (not a const) so it reflects the
 *  currency set by the entry point at export time. */
export function moneyFormat(): string {
  return exportMoneyFormat()
}

/** Standard column widths so headers + values stay readable. */
export const COLUMN_WIDTHS = {
  date:    { wch: 13 },
  text:    { wch: 22 },
  short:   { wch: 12 },
  money:   { wch: 16 },
  status:  { wch: 14 },
  large:   { wch: 28 },
}

/** Convert a pence integer to a major-unit number. Used in cell values so the
 *  money format applies — string cells would lose the formatting. */
export function poundsCell(pence: number): number {
  if (!Number.isFinite(pence)) return 0
  return Math.round(pence) / 100
}

/** Build a date-string suitable for filenames: 2026-05-27T17-30. */
export function filenameTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`
}

/** Apply a number format to every cell in a column. SheetJS stores cells
 *  by A1 reference, so we walk the column letter for every used row. */
export function applyNumberFormatToColumn(
  sheet: XLSX.WorkSheet,
  columnLetter: string,
  format: string,
  startRow = 2, // assumes header row at 1
): void {
  const ref = sheet['!ref']
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  for (let r = startRow - 1; r <= range.e.r; r++) {
    const addr = columnLetter + (r + 1)
    const cell = sheet[addr]
    if (cell && typeof cell.v === 'number') {
      cell.z = format
    }
  }
}

/** Freeze the top row so headers stay visible while scrolling. */
export function freezeHeaderRow(sheet: XLSX.WorkSheet): void {
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 }
  // SheetJS uses `!views` for Excel pane freezing
  ;(sheet as XLSX.WorkSheet & { '!views'?: unknown[] })['!views'] = [
    { state: 'frozen', ySplit: 1, topLeftCell: 'A2' },
  ]
}

/** Trigger a browser download for a workbook.
 *  Uses `XLSX.write` + Blob so a unit test running in Node can monkey-patch
 *  the `download` step without colliding with ESM's read-only module bindings. */
export function downloadWorkbook(workbook: XLSX.WorkBook, filename: string): void {
  // `XLSX.write` returns the raw bytes — same data `writeFile` would emit.
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  // Test harnesses can intercept by replacing `downloadBlob` (see below).
  downloadBlob(blob, filename)
}

/** Default Blob → download trigger. Exported as `let` so tests can swap it. */
export let downloadBlob: (blob: Blob, filename: string) => void = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a tick to start the download before revoking the URL
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Test-only — swap the download mechanism with a custom handler. */
export function __setDownloadBlobForTesting(fn: typeof downloadBlob): void {
  downloadBlob = fn
}

/** Sanitise an arbitrary string into a valid Excel sheet name (max 31 chars,
 *  no `[]:*?/\\` characters). Trims and replaces invalid characters with _. */
export function safeSheetName(name: string): string {
  return name
    .trim()
    .replace(/[\[\]:*?/\\]/g, '_')
    .slice(0, 31) || 'Sheet'
}
