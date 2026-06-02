/**
 * LeagueImpactTable — the Consequence Engine's "before → after" visualiser.
 *
 * Renders ONLY when the club is in a points-deduction breach. It takes the live
 * real-world standings, subtracts the projected sanction from the club's points
 * on a *local copy*, re-sorts descending (points → GD → GF, the standard
 * football tiebreak), and shows the club sliding down the table.
 *
 * To keep the focus dramatic, it shows a tight 5-club window (2 up, the club,
 * 2 down) BEFORE and AFTER side by side — same row styling as the League Table
 * page, with crests — plus a Current → Projected position summary on top.
 *
 * Nothing here mutates the source standings: the dedicated League Table page
 * stays a pure view of reality.
 */

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { LeagueTableRow } from '@/lib/api'

// 1 → "1st", 12 → "12th"
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!)
}

interface ProjectedRow extends LeagueTableRow {
  afterPosition: number
  isClub: boolean
}

function project(
  standings: LeagueTableRow[],
  clubRowIndex: number,
  pointsDeducted: number,
): { rows: ProjectedRow[]; before: number; after: number; afterIndex: number } {
  const clubKey = standings[clubRowIndex]!
  // Local copy — never touch the source array.
  const adjusted = standings.map((r, i) => ({
    ...r,
    points: i === clubRowIndex ? Math.max(0, r.points - pointsDeducted) : r.points,
    isClub: i === clubRowIndex,
  }))
  adjusted.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.team.localeCompare(b.team),
  )
  const rows: ProjectedRow[] = adjusted.map((r, i) => ({ ...r, afterPosition: i + 1 }))
  const afterIndex = rows.findIndex((r) => r.isClub)
  return { rows, before: clubKey.position, after: afterIndex + 1, afterIndex }
}

// A 5-item slice centred on `targetIdx`, clamped to the array bounds so we
// always show a full window even when the club sits near the top/bottom.
function windowAround<T>(items: T[], targetIdx: number, size = 5): T[] {
  const half = Math.floor(size / 2)
  const end = Math.min(items.length, Math.max(targetIdx + half + 1, size))
  const start = Math.max(0, end - size)
  return items.slice(start, end)
}

export function LeagueImpactTable({
  standings,
  clubRowIndex,
  pointsDeducted,
  competition,
}: {
  standings: LeagueTableRow[]
  clubRowIndex: number
  pointsDeducted: number
  competition: string
}) {
  const { rows, before, after, afterIndex } = useMemo(
    () => project(standings, clubRowIndex, pointsDeducted),
    [standings, clubRowIndex, pointsDeducted],
  )

  const placesDropped = after - before
  const clubName = standings[clubRowIndex]!.shortName || standings[clubRowIndex]!.team

  // 5-club windows: live table around the current position, projected table
  // around the new position.
  const beforeWindow = windowAround(standings, clubRowIndex)
  const afterWindow = windowAround(rows, afterIndex)

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      {/* Before → After summary */}
      <div className="px-5 py-4 bg-slate-50/60 border-b border-slate-100 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-red-600" />
          <div>
            <h4 className="text-[14px] font-semibold text-slate-900 leading-tight">Projected league impact</h4>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {clubName}’s {competition} position after a −{pointsDeducted} point sanction
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PositionBlock label="Current" value={ordinal(before)} tone="neutral" />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
          </svg>
          <PositionBlock label="Projected" value={ordinal(after)} tone={placesDropped > 0 ? 'danger' : 'neutral'} />
          {placesDropped > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" /><path d="M19 12l-7 7-7-7" />
              </svg>
              {placesDropped} {placesDropped === 1 ? 'place' : 'places'}
            </span>
          )}
        </div>
      </div>

      {/* Before / After 5-club windows */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
        <MiniTable
          title="Before"
          subtitle="Live table"
          rows={beforeWindow.map((r) => ({
            position: r.position,
            crest: r.crest,
            name: r.shortName || r.team,
            points: r.points,
            isClub: standings.indexOf(r) === clubRowIndex,
            delta: 0,
          }))}
          tone="neutral"
        />
        <MiniTable
          title="After"
          subtitle={`−${pointsDeducted} pts applied`}
          rows={afterWindow.map((r) => ({
            position: r.afterPosition,
            crest: r.crest,
            name: r.shortName || r.team,
            points: r.points,
            isClub: r.isClub,
            delta: r.isClub ? -pointsDeducted : 0,
          }))}
          tone="danger"
        />
      </div>
    </div>
  )
}

interface MiniRow {
  position: number
  crest: string | null
  name: string
  points: number
  isClub: boolean
  delta: number
}

function MiniTable({
  title, subtitle, rows, tone,
}: {
  title: string
  subtitle: string
  rows: MiniRow[]
  tone: 'neutral' | 'danger'
}) {
  return (
    <div>
      <div className="px-5 py-2.5 flex items-baseline justify-between border-b border-slate-100">
        <span className="meta-label">{title}</span>
        <span className="text-[11px] text-slate-400">{subtitle}</span>
      </div>
      <table className="w-full">
        <tbody>
          {rows.map((r) => {
            const highlight = r.isClub && tone === 'danger'
            const highlightNeutral = r.isClub && tone === 'neutral'
            return (
              <tr
                key={`${r.position}-${r.name}`}
                className={cn(
                  'border-b border-slate-100 last:border-0',
                  highlight ? 'bg-red-50' : highlightNeutral ? 'bg-violet-50/70' : '',
                )}
              >
                <td className={cn(
                  'pl-5 pr-2 py-2.5 text-right num text-[13px] tabular-nums w-10',
                  highlight ? 'text-red-700 font-semibold' : highlightNeutral ? 'text-violet-700 font-semibold' : 'text-slate-500',
                )}>
                  {r.position}
                </td>
                <td className="px-1 py-2.5 w-8">
                  <Crest crest={r.crest} name={r.name} />
                </td>
                <td className="px-2 py-2.5">
                  <span className={cn(
                    'text-[13.5px]',
                    highlight ? 'text-red-900 font-semibold' : highlightNeutral ? 'text-violet-900 font-semibold' : 'text-slate-900 font-medium',
                  )}>
                    {r.name}
                  </span>
                  {r.isClub && (
                    <span className={cn(
                      'ml-2 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5',
                      tone === 'danger' ? 'text-red-700 bg-red-100' : 'text-violet-700 bg-violet-100',
                    )}>
                      You
                    </span>
                  )}
                </td>
                <td className={cn(
                  'px-5 py-2.5 text-right num text-[14px] tabular-nums font-semibold',
                  highlight ? 'text-red-700' : 'text-slate-900',
                )}>
                  {r.points}
                  {r.delta !== 0 && (
                    <span className="ml-1.5 text-[11px] font-medium text-red-500">{r.delta}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Club crest with a graceful initials fallback (the snapshot + some live rows
// may lack a logo, or a crest URL may 404).
function Crest({ crest, name }: { crest: string | null; name: string }) {
  const initials = name.slice(0, 2).toUpperCase()
  if (!crest) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold flex-shrink-0">
        {initials}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 flex-shrink-0">
      <img
        src={crest}
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

function PositionBlock({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'danger' }) {
  return (
    <div className="text-center">
      <div className="meta-label">{label}</div>
      <div className={cn('num text-[20px] font-semibold leading-none mt-1', tone === 'danger' ? 'text-red-700' : 'text-slate-900')}>
        {value}
      </div>
    </div>
  )
}
