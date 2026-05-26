import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatPence, formatRatio } from '@headroom/shared'
import type { SCRResult } from '@headroom/shared'
import type { SimulationResponse } from './api'

const DISCLAIMER =
  'This report is produced by Headroom for decision-support purposes only. It does not constitute legal or financial advice. Clubs should seek independent legal counsel before completing any transfer.'

const TX_TYPE_LABEL: Record<string, string> = {
  buy:      'Buy',
  sell:     'Sell',
  loan_in:  'Loan In',
  loan_out: 'Loan Out',
}

function buildInputRows(t: Record<string, unknown>): string[][] {
  const type = (t['transactionType'] as string | undefined) ?? 'buy'
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)

  if (type === 'sell') {
    return [
      ['Sale Proceeds', formatPence(num(t['saleProceeds']))],
      ['Player Book Value', formatPence(num(t['playerBookValue']))],
      ['Annual Wage Relief', formatPence(num(t['annualWageRelief']))],
      ['Weekly Wage Released (approx)', formatPence(Math.round(num(t['annualWageRelief']) / 52))],
      ['Annual Amortisation Relief', formatPence(num(t['annualAmortisationRelief']))],
    ]
  }

  if (type === 'loan_in') {
    return [
      ['Loan Fee Paid', formatPence(num(t['transferFee']))],
      ['Loan Duration', `${num(t['contractLengthYears'])} years`],
      ['Annual Wage Contribution', formatPence(num(t['annualWage']))],
      ['Weekly Wage (approx)', formatPence(Math.round(num(t['annualWage']) / 52))],
    ]
  }

  if (type === 'loan_out') {
    return [
      ['Loan Fee Received', formatPence(num(t['loanFeeReceived']))],
      ['Loan Duration', `${num(t['loanLengthYears'])} years`],
      ['Annual Wage Covered', formatPence(num(t['annualWageCovered']))],
      ['Weekly Wage Covered (approx)', formatPence(Math.round(num(t['annualWageCovered']) / 52))],
    ]
  }

  // buy (default)
  return [
    ['Transfer Fee', formatPence(num(t['transferFee']))],
    ['Contract Length', `${num(t['contractLengthYears'])} years`],
    ['Annual Wage', formatPence(num(t['annualWage']))],
    ['Weekly Wage (approx)', formatPence(Math.round(num(t['annualWage']) / 52))],
    ['Agent Fee', formatPence(num(t['agentFee']))],
  ]
}

export function exportSimulationPDF(sim: SimulationResponse, result: SCRResult) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const transferInput = (sim.transferInput as Record<string, unknown> | null) ?? {}
  const txType = (transferInput['transactionType'] as string | undefined) ?? 'buy'

  const pageW = doc.internal.pageSize.getWidth()
  const margin = 20

  // Header
  doc.setFillColor(11, 14, 23) // slate-950
  doc.rect(0, 0, pageW, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Headroom', margin, 16)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(148, 163, 184) // slate-400
  doc.text('Financial Compliance Platform', margin, 22)

  // Title
  doc.setTextColor(30, 41, 59) // slate-800
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Transfer Simulation Report', margin, 40)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105) // slate-600
  doc.text(
    [
      `Label: ${sim.label ?? 'Unlabelled'}`,
      `Type: ${TX_TYPE_LABEL[txType] ?? 'Buy'}`,
      `Date: ${new Date(sim.createdAt).toLocaleString('en-GB')}`,
      `Season: ${sim.season}`,
    ],
    margin,
    48
  )

  let y = 70

  // Transfer Inputs
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text('Transaction Inputs', margin, y)
  y += 4

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Field', 'Value']],
    body: buildInputRows(transferInput),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // SCR Position
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text('SCR Compliance Position', margin, y)
  y += 4

  const statusLabel: Record<string, string> = {
    green: 'COMPLIANT',
    amber: 'AMBER — LEVY ZONE',
    red: 'RED — POINTS RISK',
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Metric', 'Before Transfer', 'After Transfer']],
    body: [
      ['SCR Ratio', formatRatio(result.currentSCRRatio), formatRatio(result.projectedSCRRatio)],
      [
        'Status',
        statusLabel[result.currentStatus] ?? result.currentStatus,
        statusLabel[result.projectedStatus] ?? result.projectedStatus,
      ],
      [
        'Green Threshold (85%)',
        formatPence(result.currentGreenThreshold),
        formatPence(result.currentGreenThreshold),
      ],
      [
        'Headroom to Green',
        '',
        result.headroomRemaining >= 0
          ? `+${formatPence(result.headroomRemaining)}`
          : `-${formatPence(Math.abs(result.headroomRemaining))}`,
      ],
    ],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // Sanctions
  if (result.projectedLevy || result.projectedPointsDeduction) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Projected Sanctions', margin, y)
    y += 4

    const sanctionRows: string[][] = []
    if (result.projectedLevy) {
      sanctionRows.push(['Financial Levy', formatPence(result.projectedLevy)])
    }
    if (result.projectedPointsDeduction) {
      sanctionRows.push(['Points Deduction', `${result.projectedPointsDeduction} points`])
    }

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      body: sanctionRows,
      styles: { fontSize: 9, cellPadding: 3, textColor: [180, 50, 50] },
    })

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }

  // Amortisation schedule
  if (result.amortisationSchedule.length > 0) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('Amortisation Schedule', margin, y)
    y += 4

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Season', 'Annual Amortisation', 'Remaining Book Value']],
      body: result.amortisationSchedule.map((row) => [
        row.season,
        formatPence(row.amortisationAmount),
        formatPence(row.remainingBookValue),
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })
  }

  // Footer disclaimer on every page
  const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFillColor(248, 250, 252)
    doc.rect(0, pageH - 18, pageW, 18, 'F')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(DISCLAIMER, pageW - margin * 2)
    doc.text(lines, margin, pageH - 12)
  }

  const filename = `headroom-simulation-${sim.id.slice(0, 8)}-${sim.season}.pdf`
  doc.save(filename)
}

export { DISCLAIMER }
