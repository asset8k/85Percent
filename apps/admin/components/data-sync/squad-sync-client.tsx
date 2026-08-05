'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, RefreshCw } from 'lucide-react'
import type { SyncClubRow } from '@/lib/data-imports'
import type { DataImportTarget } from '@/backend/data-imports/target'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { selectVisibleClubIds, toggleClubSelection } from './ui-model'

export function SquadSyncClient({ clubs, maxClubs, concurrency, target, targets }: {
  clubs: SyncClubRow[]
  maxClubs: number
  concurrency: number
  target: DataImportTarget
  targets: DataImportTarget[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [league, setLeague] = useState<'ALL' | SyncClubRow['league']>('ALL')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerStatus, setProviderStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const visible = useMemo(() => clubs.filter((club) =>
    (league === 'ALL' || club.league === league) && club.name.toLowerCase().includes(query.toLowerCase()),
  ), [clubs, league, query])

  function toggle(id: string) {
    setError(null)
    setSelected((current) => {
      const next = new Set(current)
      const result = toggleClubSelection(current, id, maxClubs)
      if (result.limitReached) setError(`A run can contain at most ${maxClubs} clubs.`)
      return result.selection
    })
  }

  async function checkProvider() {
    setProviderStatus('checking')
    const response = await fetch('/api/admin/data-imports/squads', { cache: 'no-store' })
    setProviderStatus(response.ok ? 'ready' : 'unavailable')
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      setError(body.error ?? 'The local provider is unavailable.')
    }
  }

  useEffect(() => { void checkProvider() }, [])

  async function start() {
    setBusy(true)
    setError(null)
    const response = await fetch('/api/admin/data-imports/squads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubIds: [...selected], targetId: target.id }),
    })
    const body = await response.json() as { runId?: string; error?: string }
    setBusy(false)
    if (!response.ok || !body.runId) return setError(body.error ?? 'Could not start import.')
    router.push(`/data-sync/runs/${body.runId}?target=${encodeURIComponent(target.id)}`)
  }

  return (
    <div>
      <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${target.isProduction ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-border bg-muted/30'}`}>
        <label className="flex items-center gap-2">Target
          <select value={target.id} onChange={(event) => router.push(`/data-sync/squads?target=${encodeURIComponent(event.target.value)}`)} className="h-8 rounded border border-input bg-background px-2 text-sm">
            {targets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <span>{target.isProduction ? 'Production data: approved imports write to the live template database.' : 'Development data: imports write only to the selected non-production database.'}</span>
      </div>
      {providerStatus !== 'ready' && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Local Transfermarkt adapter {providerStatus === 'checking' ? 'is being checked…' : 'is unavailable'}. Run <code className="rounded bg-amber-100 px-1">pnpm data-sync:adapter:start</code>, then <button className="font-medium underline" onClick={() => void checkProvider()}>retry</button>.</div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clubs" className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" />
        </label>
        <select value={league} onChange={(event) => setLeague(event.target.value as typeof league)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="ALL">All leagues</option><option value="PREMIER_LEAGUE">Premier League</option><option value="CHAMPIONSHIP">Championship</option>
        </select>
        <Button variant="outline" onClick={() => setSelected(selectVisibleClubIds(visible, maxClubs))}>Select visible</Button>
        {selected.size > 0 && <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>}
        <Button disabled={busy || selected.size === 0 || providerStatus !== 'ready'} onClick={() => {
          if (target.isProduction && !window.confirm(`Update ${selected.size} club${selected.size === 1 ? '' : 's'} in Production? This writes approved results to the live template database.`)) return
          void start()
        }}><RefreshCw className="h-4 w-4" /> {busy ? 'Starting…' : `Sync ${selected.size || ''} club${selected.size === 1 ? '' : 's'}`}</Button>
      </div>
      {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p className="mb-3 text-xs text-muted-foreground">2026/27 club catalog. Up to {maxClubs} clubs per run. At most {concurrency} club tasks execute concurrently.</p>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {(['PREMIER_LEAGUE', 'CHAMPIONSHIP'] as const).map((group) => {
          const grouped = visible.filter((club) => club.league === group)
          if (!grouped.length) return null
          return <section key={group}>
            <h2 className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group === 'PREMIER_LEAGUE' ? 'Premier League' : 'Championship'}</h2>
            {grouped.map((club) => <div key={club.id} className="grid grid-cols-[24px_minmax(170px,1fr)_90px_minmax(130px,1fr)_minmax(180px,1.2fr)] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-muted/25">
              <input aria-label={`Select ${club.name}`} type="checkbox" checked={selected.has(club.id)} onChange={() => toggle(club.id)} />
              <span className="flex min-w-0 items-center gap-2">
                {club.logoUrl ? <img src={club.logoUrl} alt="" className="h-7 w-7 shrink-0 object-contain" /> : <span className="h-7 w-7 shrink-0 rounded bg-muted" />}
                <span className="min-w-0"><span className="block truncate font-medium">{club.name}</span><span className="text-xs text-muted-foreground">{club.externalClubId ? `Mapped · ${club.externalClubId}` : 'Provider mapping required'}</span></span>
              </span>
              <span className="text-muted-foreground">{club.playerCount} players</span>
              <span className="truncate text-muted-foreground">{club.headCoach ?? 'Coach not set'}</span>
              <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                {club.reviewCount > 0 ? <Badge tone="amber">{club.reviewCount} review</Badge> : club.lastStatus ? <Badge tone={club.lastStatus === 'SUCCEEDED' ? 'green' : club.lastStatus === 'FAILED' ? 'red' : undefined}>{club.lastStatus.toLowerCase()}</Badge> : <Badge>Never synced</Badge>}
                <span className="min-w-24 text-right text-xs text-muted-foreground">{club.lastSuccessfulSync ? new Date(club.lastSuccessfulSync).toLocaleDateString() : 'No success'}{club.lastDurationMs != null ? ` · ${Math.max(1, Math.round(club.lastDurationMs / 1000))}s` : ''}</span>
                {club.lastRunId && <Link className="whitespace-nowrap text-xs font-medium text-primary hover:underline" href={`/data-sync/runs/${club.lastRunId}?target=${encodeURIComponent(target.id)}`}>View result</Link>}
                {club.lastStatus && <span className="basis-full text-right text-xs text-muted-foreground">+{club.lastAddedCount} added · {club.lastUpdatedCount} updated · {club.lastUnchangedCount} unchanged · {club.lastMissingCount} missing{club.lastError ? ` · ${club.lastError}` : ''}</span>}
              </span>
            </div>)}
          </section>
        })}
      </div>
    </div>
  )
}
