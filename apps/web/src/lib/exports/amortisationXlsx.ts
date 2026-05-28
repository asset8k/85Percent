/**
 * exportAmortisationXLSX — per-player amortisation schedules (Phase 6 §6.3).
 *
 * Workbook structure:
 *   - Index sheet: one row per player (Name | Position | Wage | Contract years | Total amort | Sheet ref)
 *   - One sheet per player: year-by-year breakdown
 *   - Summary sheet: yearly totals across all players
 *
 * All money columns rendered in pounds with the £ format. Numeric cell type
 * so Excel/Numbers can sum + sort correctly — strings would defeat that.
 */

import * as XLSX from 'xlsx'
import type { PlayerWithContract } from '@headroom/shared'
import { generateAmortisationSchedule } from '@headroom/engine'
import {
  GBP_FORMAT, COLUMN_WIDTHS, poundsCell,
  filenameTimestamp, applyNumberFormatToColumn, freezeHeaderRow,
  downloadWorkbook, safeSheetName,
} from './excelBase'

interface ExportAmortisationInput {
  clubName: string
  season: string
  players: PlayerWithContract[]
}

// "2026-27" → starting year integer 2026
function seasonStartYear(season: string): number {
  const [yyyy] = season.split('-')
  const n = parseInt(yyyy ?? '2026', 10)
  return Number.isFinite(n) ? n : 2026
}

// Try to pick a stable sheet name from the player name. Strips diacritics
// and non-alphanumerics, then takes the last name + contract end year.
function playerSheetName(p: PlayerWithContract, index: number): string {
  const parts = p.name.trim().split(/\s+/)
  const last = parts[parts.length - 1] ?? `Player${index + 1}`
  const yearSuffix = p.contract ? p.contract.endDate.slice(0, 4) : ''
  return safeSheetName(`${last}_${yearSuffix}`)
}

export function exportAmortisationXLSX(input: ExportAmortisationInput): void {
  const wb = XLSX.utils.book_new()
  const startYear = seasonStartYear(input.season)

  // Track totals across all players for the Summary sheet (year → totals)
  const yearTotals = new Map<string, { amort: number; wage: number; agent: number }>()

  // Pre-compute schedules so the Index can reference them
  const indexRows: Array<{
    sheet: string
    name: string
    position: string
    contractYears: number
    annualWage: number
    totalAmort: number
    contractEnd: string
  }> = []

  const activePlayers = input.players.filter((p) => p.contract)

  for (let i = 0; i < activePlayers.length; i++) {
    const player = activePlayers[i]!
    const c = player.contract!
    const sheetName = playerSheetName(player, i)

    const schedule = generateAmortisationSchedule(
      c.transferFeePence,
      c.contractLengthYears,
      `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    )

    // Build the per-player rows. Wage + agent fee are flat per year over the
    // contract length (annualised) — same math as the SCR engine.
    const annualWagePence = c.annualWagePence
    const annualAgentFeePence = c.contractLengthYears > 0
      ? Math.floor(c.agentFeePence / c.contractLengthYears)
      : 0

    type Row = (string | number)[]
    const header: Row = [
      'Season', 'Annual Amortisation', 'Cumulative Amortised', 'Remaining Book Value',
      'Annual Wage', 'Annualised Agent Fee', 'Total Annual SCR Impact',
    ]
    const rows: Row[] = [header]

    let cumulative = 0
    let totalAmortAcross = 0

    for (const entry of schedule) {
      cumulative += entry.amortisationAmount
      const total = entry.amortisationAmount + annualWagePence + annualAgentFeePence
      rows.push([
        entry.season,
        poundsCell(entry.amortisationAmount),
        poundsCell(cumulative),
        poundsCell(entry.remainingBookValue),
        poundsCell(annualWagePence),
        poundsCell(annualAgentFeePence),
        poundsCell(total),
      ])

      // Roll into summary
      const t = yearTotals.get(entry.season) ?? { amort: 0, wage: 0, agent: 0 }
      t.amort += entry.amortisationAmount
      t.wage  += annualWagePence
      t.agent += annualAgentFeePence
      yearTotals.set(entry.season, t)

      totalAmortAcross += entry.amortisationAmount
    }

    // If the player has a contract but no transfer fee (free transfer), still
    // surface their wage/agent rows so the sheet isn't empty.
    if (schedule.length === 0 && c.contractLengthYears > 0) {
      for (let s = 0; s < Math.ceil(c.contractLengthYears); s++) {
        const seasonStart = startYear + s
        const season = `${seasonStart}-${String((seasonStart + 1) % 100).padStart(2, '0')}`
        rows.push([
          season, 0, 0, 0,
          poundsCell(annualWagePence),
          poundsCell(annualAgentFeePence),
          poundsCell(annualWagePence + annualAgentFeePence),
        ])
        const t = yearTotals.get(season) ?? { amort: 0, wage: 0, agent: 0 }
        t.wage  += annualWagePence
        t.agent += annualAgentFeePence
        yearTotals.set(season, t)
      }
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows)

    // Set column widths
    sheet['!cols'] = [
      COLUMN_WIDTHS.short, COLUMN_WIDTHS.money, COLUMN_WIDTHS.money,
      COLUMN_WIDTHS.money, COLUMN_WIDTHS.money, COLUMN_WIDTHS.money, COLUMN_WIDTHS.money,
    ]

    // Apply £ format to columns B–G (data rows start at row 2)
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G']) {
      applyNumberFormatToColumn(sheet, col, GBP_FORMAT, 2)
    }
    freezeHeaderRow(sheet)

    XLSX.utils.book_append_sheet(wb, sheet, sheetName)

    indexRows.push({
      sheet: sheetName,
      name: player.name,
      position: player.position ?? '—',
      contractYears: c.contractLengthYears,
      annualWage: annualWagePence,
      totalAmort: totalAmortAcross,
      contractEnd: c.endDate,
    })
  }

  // ── Index sheet (inserted at position 0) ────────────────────────────────
  const indexAoA: (string | number)[][] = [
    ['Player', 'Position', 'Contract Years', 'Annual Wage', 'Total Amortisation', 'Contract End', 'Sheet'],
  ]
  indexRows.forEach((r) => {
    indexAoA.push([
      r.name, r.position, r.contractYears,
      poundsCell(r.annualWage), poundsCell(r.totalAmort),
      r.contractEnd, r.sheet,
    ])
  })
  const indexSheet = XLSX.utils.aoa_to_sheet(indexAoA)
  indexSheet['!cols'] = [
    COLUMN_WIDTHS.text, COLUMN_WIDTHS.short, COLUMN_WIDTHS.short,
    COLUMN_WIDTHS.money, COLUMN_WIDTHS.money,
    COLUMN_WIDTHS.date, COLUMN_WIDTHS.text,
  ]
  applyNumberFormatToColumn(indexSheet, 'D', GBP_FORMAT, 2)
  applyNumberFormatToColumn(indexSheet, 'E', GBP_FORMAT, 2)
  freezeHeaderRow(indexSheet)
  // Insert Index as the first sheet
  wb.SheetNames.unshift('Index')
  wb.Sheets['Index'] = indexSheet

  // ── Summary sheet (yearly totals across all players) ────────────────────
  const sortedYears = [...yearTotals.keys()].sort()
  const summaryAoA: (string | number)[][] = [
    ['Season', 'Total Amortisation', 'Total Wage', 'Total Annualised Agent Fee', 'Total Annual SCR Impact'],
  ]
  sortedYears.forEach((season) => {
    const t = yearTotals.get(season)!
    summaryAoA.push([
      season,
      poundsCell(t.amort),
      poundsCell(t.wage),
      poundsCell(t.agent),
      poundsCell(t.amort + t.wage + t.agent),
    ])
  })
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoA)
  summarySheet['!cols'] = [
    COLUMN_WIDTHS.short, COLUMN_WIDTHS.money, COLUMN_WIDTHS.money,
    COLUMN_WIDTHS.money, COLUMN_WIDTHS.money,
  ]
  for (const col of ['B', 'C', 'D', 'E']) {
    applyNumberFormatToColumn(summarySheet, col, GBP_FORMAT, 2)
  }
  freezeHeaderRow(summarySheet)
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

  // ── Save ────────────────────────────────────────────────────────────────
  const safeClub = input.clubName.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'club'
  downloadWorkbook(wb, `headroom-amortisation-${safeClub}-${filenameTimestamp()}.xlsx`)
}
