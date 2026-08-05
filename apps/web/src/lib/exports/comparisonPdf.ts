/**
 * exportComparisonPDF — side-by-side scenario comparison (Phase 6 §6.4).
 *
 * One PDF with three pages: Scenario A summary, Scenario B summary, delta
 * page. Each per-scenario page shows the action list + projected SCR card +
 * compliance gauge so the reader can pick the right plan at a glance.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ScenarioDetail, ClubFinancialsResponse } from '@/lib/api'
import { actionToEngineInput, computeActiveBaseline, computeThresholds, statusFromRatio } from '@/lib/scr'
import type { ScenarioActionInput } from '@85percent/engine'
import { applyScenarioActions } from '@85percent/engine'
import type { Currency } from '@85percent/shared'
import { setExportCurrency } from './exportCurrency'
import { formatPercentagePointDelta } from '../percentage'
import {
  addHeader, addSectionHeader, addStatusPill, addComplianceGauge,
  finalizeFooters, pdfMoney, pdfPct, statusLabel, COLOR,
  type ComplianceStatus,
} from './pdfBase'

interface ExportComparisonInput {
  clubName: string
  financials: ClubFinancialsResponse
  scenarioA: ScenarioDetail
  scenarioB: ScenarioDetail
  /** Workspace base currency for money formatting. Defaults to GBP. */
  currency?: Currency
}

interface Projection {
  squadCostsPence: number
  revenuePence: number
  ratio: number
  status: ComplianceStatus
}

function projectScenario(
  financials: ClubFinancialsResponse,
  rosterDerivedSquadCosts: number,
  scenario: ScenarioDetail,
): Projection {
  const ownerEquity = financials.ownerEquityUsed1yr ?? 0
  const baseline = {
    squadCostsPence: rosterDerivedSquadCosts,
    revenuePence: financials.footballRelatedRevenue + ownerEquity,
  }
  const actions: ScenarioActionInput[] = scenario.actions.map(actionToEngineInput)
  const proj = applyScenarioActions(baseline, actions)
  const ratio = proj.projectedRevenuePence === 0
    ? 0 : proj.projectedSquadCostsPence / proj.projectedRevenuePence
  return {
    squadCostsPence: proj.projectedSquadCostsPence,
    revenuePence:    proj.projectedRevenuePence,
    ratio,
    status: statusFromRatio(ratio, financials.currentAllowanceRatio),
  }
}

const ACTION_LABEL: Record<string, string> = {
  buy:      'Permanent Buy',
  sell:     'Permanent Sell',
  loan_in:  'Loan In',
  loan_out: 'Loan Out',
  release:  'Release',
}

export function exportComparisonPDF(input: ExportComparisonInput): void {
  setExportCurrency(input.currency ?? 'GBP')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Baseline squad costs are already in financials.currentSquadCosts (derived
  // server-side from contracts). We use that as the projection baseline.
  const baselineSquadCosts = input.financials.currentSquadCosts

  // Pre-project both scenarios against the same baseline so the delta page
  // is an apples-to-apples comparison.
  const projA = projectScenario(input.financials, baselineSquadCosts, input.scenarioA)
  const projB = projectScenario(input.financials, baselineSquadCosts, input.scenarioB)

  // Baseline (no scenarios) for "Δ vs baseline" reference numbers
  const baseline = computeActiveBaseline(
    { ...input.financials, currentSquadCosts: baselineSquadCosts },
    [],
  )

  renderScenarioPage(doc, 'Scenario A', input.scenarioA, projA, baseline, input)
  doc.addPage()
  renderScenarioPage(doc, 'Scenario B', input.scenarioB, projB, baseline, input)
  doc.addPage()
  renderDeltaPage(doc, input, baseline, projA, projB)

  finalizeFooters(doc)

  const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'scenario'
  doc.save(`85percent-compare-${safe(input.scenarioA.name)}-vs-${safe(input.scenarioB.name)}.pdf`)
}

// ---------------------------------------------------------------------------

function renderScenarioPage(
  doc: jsPDF,
  label: string,
  scenario: ScenarioDetail,
  proj: Projection,
  baseline: ReturnType<typeof computeActiveBaseline>,
  input: ExportComparisonInput,
): void {
  const w = doc.internal.pageSize.getWidth()

  let y = addHeader(doc, {
    clubName: input.clubName,
    reportTitle: `${label}: ${scenario.name}`,
    season: scenario.season,
  })

  y = addSectionHeader(doc, 'Projected Position', y)

  // Headline ratio
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...COLOR.slate900)
  doc.text(pdfPct(proj.ratio), 14, y + 8)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR.slate500)
  doc.text('Projected SCR', 14, y + 14)
  addStatusPill(doc, proj.status, w - 50, y + 6)
  doc.setFontSize(8)
  doc.setTextColor(...COLOR.slate500)
  doc.text(statusLabel(proj.status), w - 14, y + 14, { align: 'right' })

  y += 22

  // Delta vs baseline + cost/revenue snapshot
  const deltaPp = (proj.ratio - baseline.ratio) * 100
  drawStat(doc, 14, y, 'Δ vs Active Baseline',
    formatPercentagePointDelta(deltaPp, 2),
    deltaPp >= 0 ? COLOR.red600 : COLOR.green600,
  )
  drawStat(doc, 14 + 70, y, 'Projected Costs', pdfMoney(proj.squadCostsPence))
  drawStat(doc, 14 + 140, y, 'Projected Revenue', pdfMoney(proj.revenuePence))

  y += 18

  // Compliance gauge
  y = addSectionHeader(doc, 'Compliance Gauge', y)
  const thresholds = computeThresholds(proj.revenuePence, input.financials.currentAllowanceRatio)
  const greenPct = 85
  const redPct = proj.revenuePence > 0 ? (thresholds.redPence / proj.revenuePence) * 100 : 85
  y = addComplianceGauge(doc, {
    x: 14, y, width: w - 28,
    currentPct: baseline.ratio * 100,
    projectedPct: proj.ratio * 100,
    greenPct, redPct,
  })

  y += 4

  // Action list
  y = addSectionHeader(doc, `Plan Actions (${scenario.actions.length})`, y)

  if (scenario.actions.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...COLOR.slate500)
    doc.text('No actions in this scenario.', 14, y + 4)
    return
  }

  autoTable(doc, {
    startY: y,
    head: [['#', 'Type', 'Detail']],
    body: scenario.actions.map((a, i) => {
      const p = (a.payload ?? {}) as Record<string, unknown>
      return [
        String(i + 1),
        ACTION_LABEL[a.actionType] ?? a.actionType,
        formatActionDetail(a.actionType, p),
      ]
    }),
    margin: { left: 14, right: 14 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, lineColor: COLOR.slate100, lineWidth: 0.1 },
    headStyles: { fillColor: COLOR.slate50, textColor: COLOR.slate500, fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { textColor: COLOR.slate700 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', textColor: COLOR.slate400 },
      1: { cellWidth: 32, textColor: COLOR.slate900, fontStyle: 'bold' },
    },
  })
}

function renderDeltaPage(
  doc: jsPDF,
  input: ExportComparisonInput,
  baseline: ReturnType<typeof computeActiveBaseline>,
  projA: Projection,
  projB: Projection,
): void {
  let y = addHeader(doc, {
    clubName: input.clubName,
    reportTitle: 'Scenario Comparison — Delta',
    season: input.financials.season,
  })

  y = addSectionHeader(doc, 'B vs A', y)

  const deltaSCR    = (projB.ratio - projA.ratio) * 100
  const deltaCosts  = projB.squadCostsPence - projA.squadCostsPence
  const deltaRev    = projB.revenuePence - projA.revenuePence

  // Three big stat blocks
  drawDelta(doc, 14, y, 'Δ SCR',
    formatPercentagePointDelta(deltaSCR, 2),
    deltaSCR > 0 ? COLOR.red600 : deltaSCR < 0 ? COLOR.green600 : COLOR.slate900,
  )
  drawDelta(doc, 14 + 65, y, 'Δ Squad Costs',
    pdfMoney(deltaCosts, { signed: true }),
    deltaCosts > 0 ? COLOR.red600 : deltaCosts < 0 ? COLOR.green600 : COLOR.slate900,
  )
  drawDelta(doc, 14 + 130, y, 'Δ Revenue',
    pdfMoney(deltaRev, { signed: true }),
    deltaRev < 0 ? COLOR.red600 : deltaRev > 0 ? COLOR.green600 : COLOR.slate900,
  )

  y += 26

  // Side-by-side summary table
  y = addSectionHeader(doc, 'Side-by-Side Summary', y)

  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Scenario A', 'Scenario B', 'Δ (B − A)']],
    body: [
      ['Name', input.scenarioA.name, input.scenarioB.name, ''],
      ['Action count', String(input.scenarioA.actions.length), String(input.scenarioB.actions.length),
        String(input.scenarioB.actions.length - input.scenarioA.actions.length)],
      ['Projected SCR', pdfPct(projA.ratio), pdfPct(projB.ratio), formatPercentagePointDelta(deltaSCR, 2)],
      ['Status', statusLabel(projA.status), statusLabel(projB.status), ''],
      ['Projected Squad Costs', pdfMoney(projA.squadCostsPence), pdfMoney(projB.squadCostsPence), pdfMoney(deltaCosts, { signed: true })],
      ['Projected Revenue', pdfMoney(projA.revenuePence), pdfMoney(projB.revenuePence), pdfMoney(deltaRev, { signed: true })],
    ],
    margin: { left: 14, right: 14 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3, lineColor: COLOR.slate100, lineWidth: 0.1 },
    headStyles: { fillColor: COLOR.violet700, textColor: COLOR.white, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { textColor: COLOR.slate700 },
    columnStyles: {
      0: { cellWidth: 50, textColor: COLOR.slate500, fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', textColor: COLOR.slate900, fontStyle: 'bold' },
    },
  })

  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  const bottomY = (lastTable?.finalY ?? y + 40) + 12

  // Baseline reference
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR.slate500)
  doc.text(
    `Active Baseline (no scenarios applied): ${pdfPct(baseline.ratio)} — ${pdfMoney(baseline.baselineSquadCosts)} squad costs, ${pdfMoney(baseline.adjustedRevenue)} revenue.`,
    14, bottomY, { maxWidth: doc.internal.pageSize.getWidth() - 28 },
  )
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

function drawDelta(
  doc: jsPDF, x: number, y: number,
  label: string, value: string,
  color: [number, number, number],
): void {
  // Slightly larger than drawStat — used on the delta hero row
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR.slate400)
  doc.text(label.toUpperCase(), x, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...color)
  doc.text(value, x, y + 10)
}

function formatActionDetail(actionType: string, p: Record<string, unknown>): string {
  const m = (k: string) => {
    const v = p[k]
    return typeof v === 'number' && Number.isFinite(v) ? pdfMoney(v) : '—'
  }
  const yrs = (k: string) => {
    const v = p[k]
    return typeof v === 'number' && Number.isFinite(v) ? `${v}yr` : ''
  }
  switch (actionType) {
    case 'buy':
      return `Fee ${m('transferFeePence')} · Wage ${m('annualWagePence')} · Agent ${m('agentFeePence')} · ${yrs('contractLengthYears')}`
    case 'sell':
      return `Proceeds ${m('saleProceedsPence')} · Book ${m('playerBookValuePence')} · Wage relief ${m('annualWageReliefPence')}`
    case 'loan_in':
      return `Loan fee ${m('transferFeePence')} · Wage ${m('annualWagePence')} · ${yrs('loanLengthYears')}`
    case 'loan_out':
      return `Fee received ${m('loanFeeReceivedPence')} · Wage covered ${m('annualWageCoveredPence')} · ${yrs('loanLengthYears')}`
    case 'release':
      return `Wage relief ${m('annualWageReliefPence')} · Amort relief ${m('annualAmortisationReliefPence')}`
    default:
      return ''
  }
}
