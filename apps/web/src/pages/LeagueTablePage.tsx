/**
 * LeagueTablePage — dedicated, read-only view of the club's live real-world
 * league standings (Premier League or EFL Championship).
 *
 * Pure presentation of the current table as fetched from our /league-table
 * proxy. Unaffected by simulations — the Dashboard's LeagueImpactTable is where
 * the projected points-deduction drop is visualised. Highlights the user's own
 * club row and annotates promotion / play-off / relegation zones.
 */

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useClubStore } from '@/stores/club'
import { useLeagueTable, type UseLeagueTableResult } from '@/lib/useLeagueTable'
import type { LeagueTableRow } from '@/lib/api'

// ---------------------------------------------------------------------------
// Zone model — colours the left rail / position chip by promotion / relegation
// outcome. Kept league-aware: the Premier League has no play-offs.
// ---------------------------------------------------------------------------
type Zone = 'promotion' | 'playoff' | 'relegation' | null

function zoneFor(
  position: number,
  total: number,
  leagueId: 'premier-league' | 'efl-championship',
): Zone {
  if (position > total - 3) return 'relegation'
  if (leagueId === 'efl-championship') {
    if (position <= 2) return 'promotion'
    if (position <= 6) return 'playoff'
  }
  return null
}

const ZONE_RAIL: Record<NonNullable<Zone>, string> = {
  promotion: 'bg-green-500',
  playoff: 'bg-violet-400',
  relegation: 'bg-red-500',
}

export function LeagueTablePage() {
  const lt = useLeagueTable()
  return (
    <div>
      <PageHeader competition={lt.data?.competition} />
      <LeagueTableCard lt={lt} />
    </div>
  )
}

function PageHeader({ competition }: { competition?: string }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
      <div className="flex-1">
        <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
          League Table
        </h1>
        <p className="text-[13px] text-slate-500 mt-1.5">
          {competition
            ? `Live ${competition} standings — the current real-world table.`
            : 'Live standings — the current real-world table.'}
        </p>
      </div>
    </div>
  )
}

// Reusable card: header (with data-source notice) + the standings table, or a
// skeleton / error fallback. Exported shape is the hook result so the same
// component drives both states cleanly.
function LeagueTableCard({ lt }: { lt: UseLeagueTableResult }) {
  const { data, loading, error, clubRowIndex } = lt
  const clubName = useClubStore((s) => s.clubName)

  if (loading) return <TableSkeleton />

  if (error || !data) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[14px] font-medium text-slate-900">Couldn’t load the league table</p>
        <p className="text-[13px] text-slate-500 mt-1.5 max-w-md mx-auto">
          The standings service is unavailable right now. Check your connection and try again in a moment.
        </p>
        <button
          onClick={lt.reload}
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium rounded-full border border-slate-200 text-slate-700 hover:border-slate-300 transition-colors"
        >
          Retry
        </button>
      </Card>
    )
  }

  const total = data.standings.length

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{data.competition}</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {data.season} season · {total} clubs
            </p>
          </div>
        </div>
        <DataSourceTag source={data.source} fetchedAt={data.fetchedAt} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/40">
            <tr>
              <th className="meta-label px-6 py-3 text-right w-12">#</th>
              <th className="meta-label px-6 py-3 text-left">Club</th>
              <StatTh label="P" hint="Played" />
              <StatTh label="W" hint="Won" />
              <StatTh label="D" hint="Drawn" />
              <StatTh label="L" hint="Lost" />
              <StatTh label="GF" hint="Goals for" />
              <StatTh label="GA" hint="Goals against" />
              <StatTh label="GD" hint="Goal difference" />
              <th className="meta-label px-6 py-3 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {data.standings.map((row, i) => (
              <TableRow
                key={row.position}
                row={row}
                isClub={i === clubRowIndex}
                zone={zoneFor(row.position, total, data.leagueId)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <LegendFooter leagueId={data.leagueId} clubFound={clubRowIndex !== -1} clubName={clubName} />
    </Card>
  )
}

function TableRow({ row, isClub, zone }: { row: LeagueTableRow; isClub: boolean; zone: Zone }) {
  return (
    <tr
      className={cn(
        'border-b border-slate-100 last:border-0 transition-colors',
        isClub ? 'bg-violet-50/70 hover:bg-violet-50' : 'hover:bg-slate-50/70',
      )}
    >
      <td className="px-6 py-3 text-right w-12">
        <span className="relative inline-flex items-center justify-end">
          {zone && (
            <span className={cn('absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full', ZONE_RAIL[zone])} />
          )}
          <span className={cn('num text-[13px] tabular-nums', isClub ? 'text-violet-700 font-semibold' : 'text-slate-500')}>
            {row.position}
          </span>
        </span>
      </td>
      <td className="px-6 py-3">
        <span className="inline-flex items-center gap-2.5 align-middle">
          <Crest row={row} />
          <span className={cn('text-[14px]', isClub ? 'text-violet-900 font-semibold' : 'text-slate-900 font-medium')}>
            {row.shortName || row.team}
          </span>
          {isClub && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 bg-violet-100 rounded px-1.5 py-0.5">
              You
            </span>
          )}
        </span>
      </td>
      <StatTd value={row.played} muted />
      <StatTd value={row.won} muted />
      <StatTd value={row.drawn} muted />
      <StatTd value={row.lost} muted />
      <StatTd value={row.goalsFor} muted />
      <StatTd value={row.goalsAgainst} muted />
      <td className="px-6 py-3 text-right num text-[13px] tabular-nums text-slate-700">
        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
      </td>
      <td className={cn('px-6 py-3 text-right num text-[14px] tabular-nums font-semibold', isClub ? 'text-violet-700' : 'text-slate-900')}>
        {row.points}
      </td>
    </tr>
  )
}

// Crest with graceful fallback to a monochrome initials chip when the sports
// API gives us no logo (e.g. the bundled snapshot).
function Crest({ row }: { row: LeagueTableRow }) {
  const initials = (row.shortName || row.team).slice(0, 2).toUpperCase()
  if (!row.crest) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold flex-shrink-0">
        {initials}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 flex-shrink-0">
      <img
        src={row.crest}
        alt=""
        className="w-6 h-6 object-contain"
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          const sib = e.currentTarget.nextElementSibling as HTMLElement | null
          if (sib) sib.style.display = 'inline-flex'
        }}
      />
      <span className="hidden items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">
        {initials}
      </span>
    </span>
  )
}

function StatTh({ label, hint }: { label: string; hint: string }) {
  return (
    <th className="meta-label px-6 py-3 text-right" title={hint}>
      {label}
    </th>
  )
}

function StatTd({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <td className={cn('px-6 py-3 text-right num text-[13px] tabular-nums', muted ? 'text-slate-500' : 'text-slate-700')}>
      {value}
    </td>
  )
}

function DataSourceTag({ source, fetchedAt }: { source: 'live' | 'fallback'; fetchedAt: string }) {
  const when = new Date(fetchedAt)
  const time = isNaN(when.getTime())
    ? ''
    : when.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
  if (source === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
        Live · updated {time}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"
      title="The live standings service was unreachable — showing the most recent cached table."
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
      Cached snapshot
    </span>
  )
}

function LegendFooter({
  leagueId,
  clubFound,
  clubName,
}: {
  leagueId: 'premier-league' | 'efl-championship'
  clubFound: boolean
  clubName: string | null
}) {
  return (
    <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-4 flex-wrap">
        {leagueId === 'efl-championship' && (
          <>
            <LegendDot className="bg-green-500" label="Automatic promotion" />
            <LegendDot className="bg-violet-400" label="Play-offs" />
          </>
        )}
        <LegendDot className="bg-red-500" label="Relegation" />
      </div>
      {!clubFound && clubName && (
        <span className="text-[11px] text-slate-400">
          {clubName} not matched in the live table
        </span>
      )}
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block w-1.5 h-4 rounded-full', className)} />
      <span className="text-[11px] text-slate-500">{label}</span>
    </span>
  )
}

function TableSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-slate-200" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <div className="px-6 py-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-3.5 border-b border-slate-100 last:border-0">
            <Skeleton className="h-4 w-5" />
            <Skeleton className="h-6 w-6 rounded" />
            <Skeleton className="h-4 flex-1 max-w-[180px]" />
            <div className="ml-auto flex items-center gap-6">
              {Array.from({ length: 7 }).map((__, j) => (
                <Skeleton key={j} className="h-4 w-5" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
