/**
 * exportSquadPDF — board-ready squad financial report (Phase 6 §6.2).
 *
 * Page layout:
 *   1. Header + executive summary stat blocks + status pill
 *   2. Compliance gauge with current + projected position
 *   3. Per-player annual SCR contribution table
 *   4. Expiring contracts callout
 *
 * Uses pdfBase.ts for chrome consistency.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { PlayerWithContract, Currency } from '@headroom/shared'
import { calculateSquadCosts, type ContractInput } from '@headroom/engine'
import type { ClubFinancialsResponse } from '@/lib/api'
import { computeThresholds, statusFromRatio } from '@/lib/scr'
import { setExportCurrency } from './exportCurrency'
import {
  addHeader, addSectionHeader, addStatusPill, addComplianceGauge,
  finalizeFooters, pdfMoney, pdfPct, statusLabel, COLOR,
  type ComplianceStatus,
} from './pdfBase'

interface ExportSquadInput {
  clubName: string
  leagueId: string
  financials: ClubFinancialsResponse
  players: PlayerWithContract[]
  /** Workspace base currency for money formatting. Defaults to GBP. */
  currency?: Currency
}

export function exportSquadPDF(input: ExportSquadInput): void {
  setExportCurrency(input.currency ?? 'GBP')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()

  // ── Derive baseline ─────────────────────────────────────────────────────
  const contractInputs: ContractInput[] = input.players
    .filter((p) => p.contract)
    .map((p) => ({
      playerId: p.id,
      transferFeePence: p.contract!.transferFeePence,
      // Carried Book Value override replaces the transfer fee as the amortisation
      // principal when set — keeps the PDF total aligned with the server SCR.
      carriedBookValuePence: p.contract!.carriedBookValuePence,
      annualWagePence:  p.contract!.annualWagePence,
      agentFeePence:    p.contract!.agentFeePence,
      contractLengthYears: p.contract!.contractLengthYears,
    }))
  const { totalSquadCostsPence, breakdown } = calculateSquadCosts(contractInputs)
  const breakdownById = new Map(breakdown.map((b) => [b.playerId, b]))

  const revenue = input.financials.footballRelatedRevenue + (input.financials.ownerEquityUsed1yr ?? 0)
  const ratio = revenue > 0 ? totalSquadCostsPence / revenue : 0
  const status: ComplianceStatus = statusFromRatio(ratio, input.financials.currentAllowanceRatio)
  const thresholds = computeThresholds(revenue, input.financials.currentAllowanceRatio)
  const headroomToGreen = thresholds.greenPence - totalSquadCostsPence
  const headroomToRed   = thresholds.redPence   - totalSquadCostsPence

  // ── Page 1: header + summary ────────────────────────────────────────────
  let y = addHeader(doc, {
    clubName: input.clubName,
    reportTitle: 'Squad Financial Report',
    season: input.financials.season,
  })

  y = addSectionHeader(doc, 'Executive Summary', y)

  // Status row: big SCR + pill on the right
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...COLOR.slate900)
  doc.text(pdfPct(ratio), 14, y + 8)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR.slate500)
  doc.text('Squad Cost Ratio', 14, y + 14)

  addStatusPill(doc, status, w - 50, y + 6)
  doc.setFontSize(8)
  doc.setTextColor(...COLOR.slate500)
  doc.text(statusLabel(status), w - 14, y + 14, { align: 'right' })

  y += 22

  // Four-column stat row
  const statY = y
  drawStat(doc, 14,        statY, 'Revenue',       pdfMoney(revenue))
  drawStat(doc, 14 + 45,   statY, 'Squad Costs',   pdfMoney(totalSquadCostsPence))
  drawStat(doc, 14 + 90,   statY, 'Green Threshold', pdfMoney(thresholds.greenPence))
  drawStat(doc, 14 + 135,  statY, 'Red Threshold', pdfMoney(thresholds.redPence))

  y = statY + 18

  // Headroom row
  drawStat(doc, 14, y, 'Headroom to Green',
    pdfMoney(headroomToGreen, { signed: true }),
    headroomToGreen < 0 ? COLOR.red600 : COLOR.slate900)
  drawStat(doc, 14 + 60, y, 'Headroom to Red',
    pdfMoney(headroomToRed, { signed: true }),
    headroomToRed < 0 ? COLOR.red600 : COLOR.slate900)
  drawStat(doc, 14 + 120, y, 'Active Contracts', String(contractInputs.length))

  y += 18

  // Compliance Gauge
  y = addSectionHeader(doc, 'Compliance Gauge', y)
  const currentPct = ratio * 100
  const greenPct = 85
  const redPct = revenue > 0 ? (thresholds.redPence / revenue) * 100 : 85
  y = addComplianceGauge(doc, {
    x: 14, y, width: w - 28,
    currentPct, projectedPct: currentPct, greenPct, redPct,
  })

  y += 4

  // Per-player breakdown
  y = addSectionHeader(doc, 'Per-Player SCR Contribution', y)

  // Sort by total annual cost descending — same default as the Dashboard
  const sortedRows = input.players
    .filter((p) => p.contract)
    .map((p) => {
      const b = breakdownById.get(p.id)
      return {
        name: p.name,
        position: p.position ?? '—',
        wage: b?.wagePence ?? 0,
        amort: b?.amortisationPence ?? 0,
        agent: b?.annualisedAgentFeePence ?? 0,
        total: b?.totalAnnualCostPence ?? 0,
        expiry: p.contract!.endDate,
        monthsToExpiry: p.monthsToExpiry,
      }
    })
    .sort((a, b) => b.total - a.total)

  autoTable(doc, {
    startY: y,
    head: [['Player', 'Pos', 'Annual Wage', 'Amortisation', 'Annualised Agent Fee', 'Total / yr', 'Contract End']],
    body: sortedRows.map((r) => [
      r.name, r.position,
      pdfMoney(r.wage), pdfMoney(r.amort), pdfMoney(r.agent), pdfMoney(r.total),
      formatDate(r.expiry),
    ]),
    foot: [[
      `Total — ${sortedRows.length} player${sortedRows.length === 1 ? '' : 's'}`, '',
      pdfMoney(sortedRows.reduce((s, r) => s + r.wage, 0)),
      pdfMoney(sortedRows.reduce((s, r) => s + r.amort, 0)),
      pdfMoney(sortedRows.reduce((s, r) => s + r.agent, 0)),
      pdfMoney(totalSquadCostsPence),
      '',
    ]],
    margin: { left: 14, right: 14 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, lineColor: COLOR.slate100, lineWidth: 0.1 },
    headStyles: { fillColor: COLOR.slate50, textColor: COLOR.slate500, fontStyle: 'bold', fontSize: 7.5, halign: 'left' },
    footStyles: { fillColor: COLOR.slate50, textColor: COLOR.slate900, fontStyle: 'bold' },
    bodyStyles: { textColor: COLOR.slate700 },
    columnStyles: {
      0: { cellWidth: 40, textColor: COLOR.slate900, fontStyle: 'bold' },
      1: { cellWidth: 15 },
      2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right', textColor: COLOR.slate900, fontStyle: 'bold' },
      6: { halign: 'right', cellWidth: 25 },
    },
    didDrawPage: (_data) => {
      // Header on every new page autoTable might create
      if (_data.pageNumber > 1) {
        addHeader(doc, {
          clubName: input.clubName,
          reportTitle: 'Squad Financial Report',
          season: input.financials.season,
        })
      }
    },
  })

  // Get final y from autotable
  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  let bottomY = lastTable?.finalY ?? y + 60

  // Expiring contracts callout
  const expiring = sortedRows.filter(
    (r) => r.monthsToExpiry != null && r.monthsToExpiry <= 6,
  )

  if (expiring.length > 0) {
    if (bottomY > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage()
      bottomY = 20
    } else {
      bottomY += 10
    }
    bottomY = addSectionHeader(doc, 'Contracts Expiring ≤ 6 Months', bottomY)

    autoTable(doc, {
      startY: bottomY,
      head: [['Player', 'Position', 'Contract End', 'Months to Expiry', 'Annual Cost']],
      body: expiring.map((r) => [
        r.name, r.position, formatDate(r.expiry),
        r.monthsToExpiry == null ? '—' : (r.monthsToExpiry < 0 ? 'expired' : `${r.monthsToExpiry} mo`),
        pdfMoney(r.total),
      ]),
      margin: { left: 14, right: 14 },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, lineColor: COLOR.slate100, lineWidth: 0.1 },
      headStyles: { fillColor: COLOR.amber500, textColor: COLOR.white, fontStyle: 'bold', fontSize: 7.5 },
      bodyStyles: { textColor: COLOR.slate700 },
      columnStyles: {
        0: { textColor: COLOR.slate900, fontStyle: 'bold' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
    })
  }

  finalizeFooters(doc)
  doc.save(`85percent-squad-${input.financials.season}.pdf`)
}

// ---------------------------------------------------------------------------

function drawStat(
  doc: jsPDF, x: number, y: number,
  label: string, value: string,
  valueColor: [number, number, number] = COLOR.slate900,
): void {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...COLOR.slate400)
  doc.text(label.toUpperCase(), x, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...valueColor)
  doc.text(value, x, y + 7)
}

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''))
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
