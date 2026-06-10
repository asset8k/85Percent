'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Lock, Gavel, TrendingDown } from 'lucide-react'
import { LeagueTable } from './LeagueTable'
import { EASE_EXPO } from '../motion/variants'

/**
 * ConsequencesPanel — what a breach actually costs, escalating with severity. It
 * opens the moment the projection crosses 85% and climbs a three-rung ladder as the
 * ratio worsens: registration/transfer restrictions → formal breach → automatic
 * points deduction. Past 115% the deduction bites, the points badge appears and the
 * LeagueTable re-sorts the club out of the top four. This is the answer to "so
 * what?" — the SCR number turning into lost points and a lost European place.
 */

const RUNGS = [
  {
    at: 0.85,
    icon: Lock,
    title: 'Squad registration & transfer restrictions',
    body: 'New signings can be blocked from registration until you’re back under the cap.',
  },
  {
    at: 1.0,
    icon: Gavel,
    title: 'Formal breach · points deduction in play',
    body: 'The breach is referred; a sporting sanction moves from possible to likely.',
  },
  {
    at: 1.15,
    icon: TrendingDown,
    title: 'Automatic points deduction',
    body: 'Past 115% the penalty hits the league table, not just the balance sheet.',
  },
]

export function ConsequencesPanel({
  projected,
  pointsDeducted,
  breach,
}: {
  projected: number
  pointsDeducted: number
  breach: boolean
}) {
  return (
    <AnimatePresence initial={false}>
      {breach && (
        <motion.div
          key="consequences"
          id="sporting-consequences"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.5, ease: EASE_EXPO }}
          className="overflow-hidden"
        >
          <div className="mt-8 rounded-2xl border border-[#F87171]/25 bg-[hsl(0_72%_51%/0.06)] p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <span className="meta-label text-[#FCA5A5]">Sporting consequences</span>
              <AnimatePresence>
                {pointsDeducted > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.4, ease: EASE_EXPO }}
                    className="num rounded-lg bg-[hsl(0_72%_51%/0.2)] px-3 py-1.5 text-lg font-semibold text-[#FCA5A5]"
                  >
                    −{pointsDeducted} pts
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
              {/* The escalation ladder */}
              <ol className="space-y-3">
                {RUNGS.map((rung) => {
                  const reached = projected >= rung.at
                  const Icon = rung.icon
                  return (
                    <li key={rung.at} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          reached ? 'bg-[hsl(0_72%_51%/0.2)] text-[#FCA5A5]' : 'bg-white/[0.04] text-white/30'
                        }`}
                      >
                        <Icon size={15} />
                      </span>
                      <span>
                        <span
                          className={`block text-sm font-medium ${reached ? 'text-white' : 'text-white/40'}`}
                        >
                          {rung.title}
                        </span>
                        <span
                          className={`block text-xs leading-relaxed ${reached ? 'text-white/55' : 'text-white/25'}`}
                        >
                          {rung.body}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ol>

              {/* The league-table consequence (only once points actually bite) */}
              {pointsDeducted > 0 ? (
                <LeagueTable pointsDeducted={pointsDeducted} />
              ) : (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-white/12 p-6 text-center text-sm text-white/45">
                  Push the projection past 115% to see the points deduction hit the
                  league table.
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
