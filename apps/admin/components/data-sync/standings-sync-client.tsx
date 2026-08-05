'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DataImportTarget } from '@/backend/data-imports/target'

interface LeagueState {
  leagueId: string
  competition: string
  season: string | null
  provider: string | null
  fetchedAt: string | null
  clubCount: number
  standings: Array<{ position: number; team: string; played: number; won: number; drawn: number; lost: number; goalDifference: number; points: number }>
  lastStatus: string | null
  lastError: string | null
  lastRunId: string | null
  lastCompletedAt: string | null
}

const LEAGUES = [
  { id: 'PREMIER_LEAGUE', label: 'Premier League', expected: 20, leagueId: 'premier-league' },
  { id: 'CHAMPIONSHIP', label: 'EFL Championship', expected: 24, leagueId: 'efl-championship' },
] as const

export function StandingsSyncClient({ states, target, targets }: { states: LeagueState[]; target: DataImportTarget; targets: DataImportTarget[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function update(competition: typeof LEAGUES[number]['id']) {
    setBusy(competition)
    setError(null)
    const response = await fetch('/api/admin/data-imports/standings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ competitions: [competition], targetId: target.id }),
    })
    const body = await response.json() as { runId?: string; error?: string }
    setBusy(null)
    if (!response.ok || !body.runId) return setError(body.error ?? 'Could not start update.')
    router.push(`/data-sync/runs/${body.runId}?target=${encodeURIComponent(target.id)}`)
  }

  return <div>
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${target.isProduction ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-border bg-muted/30'}`}><label className="flex items-center gap-2">Target <select value={target.id} onChange={(event) => router.push(`/data-sync/standings?target=${encodeURIComponent(event.target.value)}`)} className="h-8 rounded border border-input bg-background px-2 text-sm">{targets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><span>{target.isProduction ? 'Production data: published standings update the live template database.' : 'Development data target.'}</span></div>
    {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {LEAGUES.map((league) => {
        const state = states.find((candidate) => candidate.leagueId === league.leagueId)
        return <section key={league.id} className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="font-semibold">{league.label}</h2><p className="mt-1 text-sm text-muted-foreground">2026/27 only. A valid update must contain exactly {league.expected} mapped clubs.</p></div>
            <Button disabled={busy != null} onClick={() => { if (target.isProduction && !window.confirm(`Update ${league.label} in Production?`)) return; void update(league.id) }}><RefreshCw className="h-4 w-4" /> {busy === league.id ? 'Starting…' : 'Update table'}</Button>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Current season</dt><dd>{state?.season ?? 'No snapshot'}</dd>
            <dt className="text-muted-foreground">Last update</dt><dd>{state?.fetchedAt ? new Date(state.fetchedAt).toLocaleString() : '—'}</dd>
            <dt className="text-muted-foreground">Provider</dt><dd>{state?.provider ?? '—'}</dd>
            <dt className="text-muted-foreground">Clubs</dt><dd>{state?.clubCount ?? '—'}</dd>
            <dt className="text-muted-foreground">Last result</dt><dd>{state?.lastStatus ? state.lastStatus.toLowerCase() : 'Never run'}{state?.lastRunId && <> · <Link className="text-primary hover:underline" href={`/data-sync/runs/${state.lastRunId}?target=${encodeURIComponent(target.id)}`}>View result</Link></>}</dd>
          </dl>
          {state?.lastError && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.lastError}</p>}
          {state?.standings.length ? <details className="mt-4 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium text-primary">View imported table</summary>
            <div className="mt-3 max-h-80 overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="px-2 py-2">Pos</th><th className="px-2 py-2">Club</th><th className="px-2 py-2 text-right">P</th><th className="px-2 py-2 text-right">W</th><th className="px-2 py-2 text-right">D</th><th className="px-2 py-2 text-right">L</th><th className="px-2 py-2 text-right">GD</th><th className="px-2 py-2 text-right">Pts</th></tr></thead>
                <tbody>{state.standings.map((row) => <tr key={`${row.position}-${row.team}`} className="border-t border-border"><td className="px-2 py-1.5">{row.position}</td><td className="px-2 py-1.5 font-medium">{row.team}</td><td className="px-2 py-1.5 text-right">{row.played}</td><td className="px-2 py-1.5 text-right">{row.won}</td><td className="px-2 py-1.5 text-right">{row.drawn}</td><td className="px-2 py-1.5 text-right">{row.lost}</td><td className="px-2 py-1.5 text-right">{row.goalDifference}</td><td className="px-2 py-1.5 text-right font-medium">{row.points}</td></tr>)}</tbody>
              </table>
            </div>
          </details> : null}
        </section>
      })}
    </div>
    <p className="mt-4 text-sm text-muted-foreground">Updates are validated and published atomically. An invalid response never replaces the previous successful table.</p>
  </div>
}
