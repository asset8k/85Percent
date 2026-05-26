import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { SimulationResponse, SimulationListResponse, ClubFinancialsResponse } from '@/lib/api'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SCRResultPanel } from '@/components/simulator/SCRResultPanel'
import { formatPence } from '@headroom/shared'
import { useClubStore } from '@/stores/club'
import { exportSimulationPDF } from '@/lib/pdf'
import type { ComplianceStatus, TransactionType } from '@headroom/shared'

const TX_TYPE_LABEL: Record<string, string> = {
  buy:      'Buy',
  sell:     'Sell',
  loan_in:  'Loan In',
  loan_out: 'Loan Out',
}

export function HistoryPage() {
  const { id } = useParams<{ id?: string }>()
  const { financials } = useClubStore()

  if (id) {
    return <SimulationDetail id={id} financials={financials} />
  }
  return <SimulationList />
}

function SimulationList() {
  const navigate = useNavigate()
  const { financials, setStackedHistory } = useClubStore()
  const [data, setData] = useState<SimulationListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Per-row edit/delete state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    api.simulations
      .list()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Keep global stacked history totals in sync whenever this page's sim list changes
  useEffect(() => {
    if (!data) return
    const sims = data.simulations
    const total = sims.reduce((sum, s) => sum + (s.scrResult?.totalAnnualCostImpact ?? 0), 0)
    setStackedHistory(sims.length, total)
  }, [data, setStackedHistory])

  const startEdit = (sim: SimulationResponse, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(sim.id)
    setEditValue(sim.label ?? '')
  }

  const saveEdit = async (id: string) => {
    try {
      await api.simulations.updateLabel(id, editValue)
      setData((prev) =>
        prev
          ? {
              ...prev,
              simulations: prev.simulations.map((s) =>
                s.id === id ? { ...s, label: editValue || null } : s
              ),
            }
          : prev
      )
    } finally {
      setEditingId(null)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await api.simulations.delete(id)
      setData((prev) => {
        if (!prev) return prev
        const next = { ...prev, simulations: prev.simulations.filter((s) => s.id !== id), total: prev.total - 1 }
        const newTotal = next.simulations.reduce((sum, s) => sum + (s.scrResult?.totalAnnualCostImpact ?? 0), 0)
        setStackedHistory(next.total, newTotal)
        return next
      })
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading simulations…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>

  const simulations = data?.simulations ?? []

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
            Simulation History
          </h1>
          <p className="text-[13px] text-slate-500 mt-1.5">
            Every compliance check you've run, with the projection frozen at run-time.
          </p>
        </div>
      </div>

      {simulations.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-slate-500">
            No simulations yet. Run your first compliance check from the Simulator.
          </p>
          <Link to="/simulator">
            <Button className="mt-4">Go to Simulator</Button>
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-slate-100">
              <tr>
                <Th>Date</Th>
                <Th>Label</Th>
                <Th>Type</Th>
                <Th align="right">Transfer Fee</Th>
                <Th align="right">Projected SCR</Th>
                <Th>Status</Th>
                <Th align="right">Run By</Th>
                <Th align="right">{''}</Th>
              </tr>
            </thead>
            <tbody>
              {simulations.map((sim) => {
                const result = sim.scrResult
                const input = sim.transferInput as Record<string, unknown> | null
                const isEditing = editingId === sim.id
                const isDeleting = deletingId === sim.id

                return (
                  <tr
                    key={sim.id}
                    onClick={() => {
                      if (!isEditing) navigate(`/history/${sim.id}`)
                    }}
                    className="border-b border-slate-100 last:border-0 hover:bg-violet-50/60 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5 text-[13px] text-slate-500 num whitespace-nowrap">
                      {new Date(sim.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>

                    {/* Label cell — inline edit */}
                    <td className="px-5 py-3.5 text-[14px]" onClick={(e) => e.stopPropagation()}>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(sim.id)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            className="text-[14px] text-slate-900 bg-transparent border-b border-violet-400 focus:outline-none focus:border-violet-600 py-0 min-w-0 flex-1"
                            placeholder="Enter label…"
                          />
                          <button
                            onClick={() => saveEdit(sim.id)}
                            className="text-[12px] font-medium text-violet-600 hover:text-violet-700 whitespace-nowrap flex-shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={(e) => startEdit(sim, e)}
                          className="flex items-center gap-1.5 cursor-text"
                          title="Click to rename"
                        >
                          {sim.label ? (
                            <span className="text-slate-900 font-medium">{sim.label}</span>
                          ) : (
                            <span className="italic text-slate-400">Unnamed simulation</span>
                          )}
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-slate-400 flex-shrink-0"
                          >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5">
                      <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 whitespace-nowrap">
                        {TX_TYPE_LABEL[(input?.['transactionType'] as string) ?? 'buy']}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] num text-right text-slate-900 whitespace-nowrap">
                      {input?.['transferFee'] != null ? formatPence(input['transferFee'] as number) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] num text-right text-slate-900 font-medium whitespace-nowrap">
                      {(result.projectedSCRRatio * 100).toFixed(1)}%
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={result.projectedStatus as ComplianceStatus} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span
                        className="inline-flex items-center justify-center rounded-full bg-violet-600 text-white font-medium text-[10px]"
                        style={{ width: 26, height: 26, letterSpacing: 0.4 }}
                      >
                        {sim.user?.fullName
                          ?.split(' ')
                          .map((n: string) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase() ?? 'JM'}
                      </span>
                    </td>

                    {/* Actions cell */}
                    <td
                      className="px-5 py-3.5 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => handleDelete(sim.id, e)}
                        disabled={isDeleting}
                        className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40"
                        title="Delete simulation"
                      >
                        {isDeleting ? (
                          <span className="text-[12px]">…</span>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" /><path d="M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-5 py-3 text-${align} meta-label font-medium`}>{children}</th>
}

function SimulationDetail({
  id,
  financials,
}: {
  id: string
  financials: ClubFinancialsResponse | null
}) {
  const navigate = useNavigate()
  const [sim, setSim] = useState<SimulationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [labelEdit, setLabelEdit] = useState('')
  const [labelSaving, setLabelSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    api.simulations
      .get(id)
      .then((s) => {
        setSim(s)
        setLabelEdit(s.label ?? '')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const saveLabel = async () => {
    if (!sim) return
    setLabelSaving(true)
    try {
      await api.simulations.updateLabel(sim.id, labelEdit)
      setSim({ ...sim, label: labelEdit || null })
      setEditing(false)
    } finally {
      setLabelSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!sim) return
    setDeleting(true)
    try {
      await api.simulations.delete(sim.id)
      navigate('/history')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading simulation…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!sim) return null

  const result = sim.scrResult

  return (
    <div>
      <Link
        to="/history"
        className="text-[14px] text-violet-600 hover:text-violet-700 font-medium mb-4 inline-flex items-center gap-1"
      >
        <span aria-hidden="true">←</span> Back to History
      </Link>

      <div className="flex items-start justify-between mb-1 mt-4">
        {editing ? (
          <input
            value={labelEdit}
            autoFocus
            onChange={(e) => setLabelEdit(e.target.value)}
            onBlur={saveLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLabel()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="text-[24px] font-bold text-slate-900 tracking-tight bg-transparent border-b border-violet-300 focus:outline-none focus:border-violet-600 px-0 py-0 w-full max-w-2xl"
            disabled={labelSaving}
          />
        ) : (
          <h1
            onClick={() => setEditing(true)}
            className="text-[24px] font-bold tracking-tight cursor-text hover:text-violet-700 transition-colors"
            title="Click to rename"
          >
            {sim.label ?? (
              <span className="italic text-slate-400 font-normal">Unnamed simulation</span>
            )}
          </h1>
        )}

        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          <Button variant="outline" onClick={() => exportSimulationPDF(sim, result)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
            </svg>
            Export as PDF
          </Button>

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-red-600">Delete this simulation?</span>
              <Button
                variant="ghost"
                onClick={handleDelete}
                disabled={deleting}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} className="px-3">
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="text-slate-400 hover:text-red-500 hover:bg-red-50 px-2"
              title="Delete simulation"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </Button>
          )}
        </div>
      </div>

      <p className="text-[13px] text-slate-500 mb-6">
        <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 mr-2">
          {TX_TYPE_LABEL[((sim.transferInput as Record<string, unknown>)?.['transactionType'] as string) ?? 'buy']}
        </span>
        {new Date(sim.createdAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })}
        {' · '}
        {new Date(sim.createdAt).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {sim.user?.fullName ? (
          <>
            {' '}by <span className="text-slate-700">{sim.user.fullName}</span>
          </>
        ) : null}
      </p>

      <SCRResultPanel
        result={result}
        transactionType={(sim.transferInput as { transactionType?: TransactionType } | null)?.transactionType}
      />
    </div>
  )
}
