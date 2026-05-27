import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Spinner, PageLoader } from '@/components/ui/spinner'
import { SCRResultPanel } from '@/components/simulator/SCRResultPanel'
import { formatPence } from '@headroom/shared'
import { useClubStore } from '@/stores/club'
import type { StoredSimulation } from '@/stores/club'
import { exportSimulationPDF } from '@/lib/pdf'
import { computeActiveBaseline, computeBeforeAfter } from '@/lib/scr'
import type { TransactionType } from '@headroom/shared'

const TX_TYPE_LABEL: Record<string, string> = {
  buy:      'Buy',
  sell:     'Sell',
  loan_in:  'Loan In',
  loan_out: 'Loan Out',
}

export function HistoryPage() {
  const { id } = useParams<{ id?: string }>()
  if (id) return <SimulationDetail id={id} />
  return <SimulationList />
}

function SimulationList() {
  const navigate = useNavigate()
  const { simulations, setSimulations, setInclusion, setLabel, removeSimulation } = useClubStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // AppLayout already populates the store, but hydrate ourselves if we got here first.
  useEffect(() => {
    if (simulations.length > 0) {
      setLoading(false)
      return
    }
    api.simulations
      .list(1, 100)
      .then((data) => {
        setSimulations(
          data.simulations.map((s) => ({
            id: s.id,
            label: s.label,
            season: s.season,
            transferInput: s.transferInput,
            isIncluded: s.isIncluded,
            createdAt: s.createdAt,
            user: s.user,
          }))
        )
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
    // intentionally only on mount — re-hydration is owned by AppLayout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startEdit = (sim: StoredSimulation, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(sim.id)
    setEditValue(sim.label ?? '')
  }

  const saveEdit = async (id: string) => {
    setSavingId(id)
    try {
      await api.simulations.updateLabel(id, editValue)
      setLabel(id, editValue || null)
    } finally {
      setSavingId(null)
      setEditingId(null)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await api.simulations.delete(id)
      removeSimulation(id)
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggle = async (id: string, next: boolean, e: React.MouseEvent) => {
    e.stopPropagation()
    setTogglingId(id)
    setInclusion(id, next) // optimistic — pill recomputes instantly
    try {
      await api.simulations.setInclusion(id, next)
    } catch {
      setInclusion(id, !next) // rollback on failure
    } finally {
      setTogglingId(null)
    }
  }

  if (loading) return <PageLoader />
  if (error) return <p className="text-sm text-red-600">{error}</p>

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
            Simulation History
          </h1>
          <p className="text-[13px] text-slate-500 mt-1.5">
            Tick a simulation to include it in your active baseline. The Current SCR pill updates instantly.
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
                <Th align="center" width={56}>Active</Th>
                <Th>Date</Th>
                <Th>Label</Th>
                <Th>Type</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Run By</Th>
                <Th align="right">{''}</Th>
              </tr>
            </thead>
            <tbody>
              {simulations.map((sim) => {
                const input = sim.transferInput as Record<string, unknown> | null
                const isEditing = editingId === sim.id
                const isSaving = savingId === sim.id
                const isDeleting = deletingId === sim.id
                const isToggling = togglingId === sim.id

                return (
                  <tr
                    key={sim.id}
                    onClick={() => {
                      if (!isEditing) navigate(`/history/${sim.id}`)
                    }}
                    className="border-b border-slate-100 last:border-0 hover:bg-violet-50/60 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sim.isIncluded}
                          disabled={isToggling}
                          onChange={(e) => handleToggle(sim.id, e.target.checked, e as unknown as React.MouseEvent)}
                          className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-2 focus:ring-violet-500 cursor-pointer accent-violet-600"
                        />
                      </label>
                    </td>

                    <td className="px-5 py-3.5 text-[13px] text-slate-500 num whitespace-nowrap">
                      {new Date(sim.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>

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
                            disabled={isSaving}
                            className="flex items-center gap-1 text-[12px] font-medium text-violet-600 hover:text-violet-700 whitespace-nowrap flex-shrink-0 disabled:opacity-60"
                          >
                            {isSaving ? <Spinner size={11} /> : null}
                            {isSaving ? 'Saving…' : 'Save'}
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
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 flex-shrink-0">
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
                      {(() => {
                        const type = (input?.['transactionType'] as string) ?? 'buy'
                        const n = (key: string) => input?.[key] != null ? formatPence(input[key] as number) : '—'
                        if (type === 'sell') return n('saleProceeds')
                        if (type === 'loan_out') return n('loanFeeReceived')
                        return n('transferFee')
                      })()}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span
                        className="inline-flex items-center justify-center rounded-full bg-violet-600 text-white font-medium text-[10px]"
                        style={{ width: 26, height: 26, letterSpacing: 0.4 }}
                      >
                        {sim.user?.fullName
                          ?.split(' ')
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase() ?? 'CF'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleDelete(sim.id, e)}
                        disabled={isDeleting}
                        className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40"
                        title="Delete simulation"
                      >
                        {isDeleting ? <Spinner size={15} /> : (
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

function Th({
  children,
  align = 'left',
  width,
}: {
  children: React.ReactNode
  align?: 'left' | 'right' | 'center'
  width?: number
}) {
  return (
    <th
      className={`px-5 py-3 text-${align} meta-label font-medium`}
      style={width ? { width } : undefined}
    >
      {children}
    </th>
  )
}

function SimulationDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const { financials, leagueId, simulations, setLabel, setInclusion, removeSimulation } = useClubStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [labelEdit, setLabelEdit] = useState('')
  const [labelSaving, setLabelSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)

  const sim = simulations.find((s) => s.id === id) ?? null

  // If the sim isn't in the store yet (deep link), fetch it.
  useEffect(() => {
    if (sim) {
      setLabelEdit(sim.label ?? '')
      setLoading(false)
      return
    }
    api.simulations
      .get(id)
      .then((s) => {
        // We don't write to the store here — the store hydrates from AppLayout.
        // But we do need the data to render. Fall back to a transient view.
        useClubStore.getState().upsertSimulation({
          id: s.id,
          label: s.label,
          season: s.season,
          transferInput: s.transferInput,
          isIncluded: s.isIncluded,
          createdAt: s.createdAt,
          user: s.user,
        })
        setLabelEdit(s.label ?? '')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, sim])

  // Compute BEFORE/AFTER dynamically from the engine.
  const result = useMemo(() => {
    if (!sim || !financials || !leagueId) return null
    return computeBeforeAfter(sim, financials, leagueId, simulations)
  }, [sim, financials, leagueId, simulations])

  // Subtext N: count of OTHER active sims (excludes the current one regardless of its state),
  // because BEFORE always represents the baseline without this sim per the spec.
  const subtextN = useMemo(() => {
    if (!sim || !financials || !leagueId) return 0
    return computeActiveBaseline(financials, leagueId, simulations, sim.id).includedCount
  }, [sim, financials, leagueId, simulations])

  const saveLabel = async () => {
    if (!sim) return
    setLabelSaving(true)
    try {
      await api.simulations.updateLabel(sim.id, labelEdit)
      setLabel(sim.id, labelEdit || null)
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
      removeSimulation(sim.id)
      navigate('/history')
    } finally {
      setDeleting(false)
    }
  }

  const handleToggle = async (next: boolean) => {
    if (!sim) return
    setToggling(true)
    setInclusion(sim.id, next)
    try {
      await api.simulations.setInclusion(sim.id, next)
    } catch {
      setInclusion(sim.id, !next)
    } finally {
      setToggling(false)
    }
  }

  if (loading) return <PageLoader />
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!sim || !result) return null

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
          <div className="flex items-center gap-3 flex-1 max-w-2xl">
            <input
              value={labelEdit}
              autoFocus
              onChange={(e) => setLabelEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLabel()
                if (e.key === 'Escape') setEditing(false)
              }}
              className="text-[24px] font-bold text-slate-900 tracking-tight bg-transparent border-b border-violet-300 focus:outline-none focus:border-violet-600 px-0 py-0 flex-1"
              disabled={labelSaving}
            />
            <button
              onClick={saveLabel}
              disabled={labelSaving}
              className="flex items-center gap-1.5 text-[13px] font-medium text-violet-600 hover:text-violet-700 whitespace-nowrap disabled:opacity-60"
            >
              {labelSaving ? <Spinner size={12} /> : null}
              {labelSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
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
          <Button
            variant="ghost"
            onClick={() => exportSimulationPDF({
              id: sim.id,
              clubId: '',
              createdBy: '',
              season: sim.season,
              label: sim.label,
              transferInput: sim.transferInput,
              isIncluded: sim.isIncluded,
              createdAt: sim.createdAt,
              user: sim.user,
            }, result)}
            className="text-slate-400 hover:text-violet-600 hover:bg-violet-50 px-2"
            title="Download as PDF"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </Button>

          <Button
            variant="ghost"
            onClick={handleDelete}
            disabled={deleting}
            className="text-slate-400 hover:text-red-500 hover:bg-red-50 px-2"
            title="Delete simulation"
          >
            {deleting ? <Spinner size={15} /> : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            )}
          </Button>
        </div>
      </div>

      <p className="text-[13px] text-slate-500 mb-4">
        <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 mr-2">
          {TX_TYPE_LABEL[((sim.transferInput as Record<string, unknown>)?.['transactionType'] as string) ?? 'buy']}
        </span>
        {new Date(sim.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
        {' · '}
        {new Date(sim.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        {sim.user?.fullName ? (
          <> {' '}by <span className="text-slate-700">{sim.user.fullName}</span></>
        ) : null}
      </p>

      {/* Inclusion toggle row */}
      <div className="mb-5 flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 bg-slate-50">
        <div>
          <div className="text-[13px] font-medium text-slate-900">Active in master plan</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {sim.isIncluded
              ? 'This simulation is currently applied to your Current SCR.'
              : 'This simulation is a draft — it does not affect your Current SCR.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sim.isIncluded}
          onClick={() => handleToggle(!sim.isIncluded)}
          disabled={toggling}
          className="toggle"
          data-on={sim.isIncluded ? 'true' : 'false'}
        />
      </div>

      <SCRResultPanel
        result={result}
        transactionType={(sim.transferInput as { transactionType?: TransactionType } | null)?.transactionType}
        beforeSubtext={`Base Settings + ${subtextN} active simulation${subtextN === 1 ? '' : 's'}`}
        activeSide={sim.isIncluded ? 'after' : 'before'}
      />
    </div>
  )
}
