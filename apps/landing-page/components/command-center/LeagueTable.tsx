'use client'

import { motion } from 'framer-motion'
import { EASE_EXPO } from '../motion/variants'

/**
 * LeagueTable — the sporting consequence made literal. The club starts 4th (a
 * Champions League place); when a Squad Cost Ratio breach triggers a points
 * deduction, its points drop and the table physically re-sorts, the club's row
 * sliding down past its rivals via framer-motion `layout`. That reorder is the
 * whole point: a financial number becoming a league position.
 *
 * Clubs are illustrative placeholders, not real sides.
 */

const RIVALS = [
  { name: 'Manchester North', pts: 78 },
  { name: 'City Athletic', pts: 74 },
  { name: 'Kingsbridge', pts: 68 },
  { name: 'Riverside', pts: 61 },
  { name: 'North London', pts: 59 },
  { name: 'Tyneside', pts: 57 },
  { name: 'Old Harbour', pts: 55 },
  { name: 'Seaford', pts: 53 },
  { name: 'Wearmouth', pts: 51 },
]

const BASE_PTS = 64 // your club, sitting 4th before any deduction

const ordinal = (n: number) => {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

export function LeagueTable({ pointsDeducted }: { pointsDeducted: number }) {
  const yourPts = BASE_PTS - pointsDeducted
  const rankBefore = 1 + RIVALS.filter((r) => r.pts > BASE_PTS).length
  const rankAfter = 1 + RIVALS.filter((r) => r.pts > yourPts).length

  const rows = [
    ...RIVALS.map((r) => ({ ...r, you: false })),
    { name: 'Your club', pts: yourPts, you: true },
  ].sort((a, b) => b.pts - a.pts)

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="meta-label text-white/45">Premier League table</span>
        {pointsDeducted > 0 && (
          <span className="num inline-flex items-center gap-1.5 text-xs text-[#FCA5A5]">
            {ordinal(rankBefore)}
            <span className="text-white/30">→</span>
            {ordinal(rankAfter)}
          </span>
        )}
      </div>

      <ul className="space-y-0.5">
        {rows.map((row, i) => (
          <motion.li
            key={row.name}
            layout
            transition={{ duration: 0.7, ease: EASE_EXPO }}
            className={`flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm ${
              row.you ? 'bg-[hsl(0_72%_51%/0.16)] ring-1 ring-[#F87171]/40' : ''
            }`}
          >
            <span className={`num w-5 text-right text-xs ${i < 4 ? 'text-violet-soft' : 'text-white/40'}`}>
              {i + 1}
            </span>
            <span className={`flex-1 truncate ${row.you ? 'font-semibold text-white' : 'text-white/70'}`}>
              {row.name}
              {row.you && i >= 4 && (
                <span className="ml-2 hidden text-[10px] uppercase tracking-wide text-[#FCA5A5] sm:inline">
                  out of the top four
                </span>
              )}
            </span>
            {row.you && pointsDeducted > 0 && (
              <span className="num text-xs text-[#FCA5A5]">−{pointsDeducted}</span>
            )}
            <span className={`num w-7 text-right ${row.you ? 'text-white' : 'text-white/60'}`}>
              {row.pts}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}
