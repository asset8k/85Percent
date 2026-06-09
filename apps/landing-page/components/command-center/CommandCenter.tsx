'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Check, AlertTriangle, ShieldCheck } from 'lucide-react'
import { ScrGauge, SCR_LIMIT } from '../ScrGauge'
import { ScrComparisonBars } from './ScrComparisonBars'
import { ScrTrendChart, type TrendPoint } from './ScrTrendChart'
import { ConsequencesPanel } from './ConsequencesPanel'
import { Reveal } from '../motion/Reveal'
import { EASE_EXPO } from '../motion/variants'
import { Aurora } from '../atmosphere/Aurora'
import { Grain } from '../atmosphere/Grain'
import { Spotlight } from '../atmosphere/Spotlight'

/**
 * CommandCenter — the SCR Command Center: the interactive proof, consolidated into
 * one dark dashboard panel. The visitor stacks real transfer moves and watches the
 * whole instrument respond live — the radial gauge re-sweeps, the current-vs-
 * projected bars close on the cap, the window trajectory re-projects to deadline
 * day, the headroom recomputes, and the status flips Compliant → Breach the moment
 * a deal pushes past 85%. It folds the old standalone scenario demo and hero gauge
 * into the product's core loop, playable in miniature.
 */

const CURRENT = 0.78 // today's audited SCR

interface Move {
  id: string
  label: string
  detail: string
  delta: number // change in SCR (fraction)
}

const MOVES: Move[] = [
  { id: 'striker', label: 'Sign elite striker', detail: '£80M, amortised over 5 yrs', delta: 0.06 },
  { id: 'galactico', label: 'Sign a galáctico', detail: '£180M marquee transfer', delta: 0.14 },
  { id: 'spree', label: 'Deadline-day spree', detail: 'Three panic signings', delta: 0.1 },
  { id: 'gk', label: 'Renew the goalkeeper', detail: '+£90k / week', delta: 0.02 },
  { id: 'sell', label: 'Sell centre-back', detail: '£45M, off the wage bill', delta: -0.045 },
  { id: 'academy', label: 'Promote academy grad', detail: 'Replaces a senior wage', delta: -0.015 },
]

// The toggles that, stacked, take an 84% club clean past the cap to 110%.
const WORST_CASE = ['striker', 'galactico', 'spree', 'gk']

const fmtPts = (frac: number) => `${frac >= 0 ? '+' : '−'}${Math.abs(frac * 100).toFixed(1)} pts`

export function CommandCenter() {
  const [active, setActive] = useState<Set<string>>(new Set(['striker']))

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const delta = MOVES.filter((m) => active.has(m.id)).reduce((s, m) => s + m.delta, 0)
  const projected = Math.max(0, Math.min(1.2, CURRENT + delta))
  const breach = projected > SCR_LIMIT
  const headroomPts = (SCR_LIMIT - projected) * 100
  const projectedPct = Math.round(projected * 100)

  // Sporting sanction escalates with severity; the deduction only bites past ~105%.
  const pointsDeducted = projected >= 1.1 ? 10 : projected >= 1.05 ? 6 : 0

  // The window trajectory: the audited climb to today, then the live projection.
  const trend: TrendPoint[] = [
    { m: 'Jun', scr: 73 },
    { m: 'Jul', scr: 75 },
    { m: 'Aug', scr: 77 },
    { m: 'Today', scr: 78 },
    { m: 'Deadline', scr: projectedPct },
  ]

  return (
    <section id="command-center" className="relative isolate scroll-mt-20 overflow-hidden bg-charcoal text-charcoal-foreground">
      <Aurora className="opacity-70" />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,hsl(var(--v-core)/0.16),transparent_70%)]"
        aria-hidden
      />
      <Spotlight />
      <Grain />
      <div className="relative z-10 mx-auto max-w-content px-6 py-28">
        <Reveal className="max-w-2xl">
          <span className="meta-label text-violet-soft">The SCR Command Center</span>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] sm:text-4xl">
            Model the window. Watch the line.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-white/65">
            Stack the moves you’re weighing up and watch the Squad Cost Ratio respond
            live. Gauge, trajectory and headroom recompute the instant a deal pushes
            you toward the 85% cap, and past it.
          </p>
        </Reveal>

        {/* The dashboard panel */}
        <Reveal delay={0.1} className="mt-12">
          <motion.div
            className="relative rounded-2xl border bg-white/[0.04] p-5 backdrop-blur-sm sm:p-7"
            animate={{
              borderColor: breach ? 'hsl(0 72% 51% / 0.5)' : 'rgba(255,255,255,0.1)',
              boxShadow: breach
                ? '0 40px 90px -40px hsl(0 72% 51% / 0.45)'
                : '0 40px 90px -40px rgba(0,0,0,0.7)',
            }}
            transition={{ duration: 0.5, ease: EASE_EXPO }}
          >
            {/* Panel header */}
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-white/85">Your club</div>
                <div className="meta-label text-white/40">2025/26 · Premier League</div>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={breach ? 'breach' : 'ok'}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.25 }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                    breach
                      ? 'bg-[hsl(0_72%_51%/0.16)] text-[#FCA5A5]'
                      : 'bg-[hsl(142_70%_45%/0.16)] text-[#86EFAC]'
                  }`}
                >
                  {breach ? <AlertTriangle size={13} /> : <ShieldCheck size={13} />}
                  {breach ? 'Breach · over 85%' : 'Compliant'}
                </motion.span>
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
              {/* Gauge + headline stats */}
              <div className="lg:col-span-5">
                <ScrGauge value={projected} className="w-full" />
                <div className="mt-1 grid grid-cols-3 gap-2.5 text-center">
                  <Stat label="Current" value="78%" />
                  <Stat label="Projected" value={`${projectedPct}%`} tone={breach ? 'red' : 'violet'} />
                  <Stat
                    label={breach ? 'Over cap' : 'Headroom'}
                    value={`${headroomPts >= 0 ? '+' : '−'}${Math.abs(headroomPts).toFixed(1)} pts`}
                    tone={breach ? 'red' : 'green'}
                  />
                </div>
              </div>

              {/* Bars + trajectory */}
              <div className="lg:col-span-7">
                <ScrComparisonBars current={CURRENT} projected={projected} breach={breach} />
                <div className="mt-7 border-t border-white/10 pt-5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="meta-label text-white/45">SCR across the window</span>
                    <span className="meta-label text-white/30">Jun → deadline day</span>
                  </div>
                  <ScrTrendChart data={trend} projectedPct={projectedPct} breach={breach} />
                </div>
              </div>
            </div>

            {/* Scenario move rail */}
            <div className="mt-8 border-t border-white/10 pt-7">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="meta-label text-white/45">Model a move</span>
                <div className="flex items-center gap-2">
                  <span className="num mr-1 text-xs text-white/40">{active.size} in plan</span>
                  <button
                    type="button"
                    onClick={() => setActive(new Set(WORST_CASE))}
                    className="rounded-md border border-[#F87171]/30 bg-[hsl(0_72%_51%/0.1)] px-2.5 py-1 text-xs font-medium text-[#FCA5A5] transition-colors hover:bg-[hsl(0_72%_51%/0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal"
                  >
                    Show a points deduction
                  </button>
                  <button
                    type="button"
                    onClick={() => setActive(new Set(['striker']))}
                    className="rounded-md border border-white/12 px-2.5 py-1 text-xs font-medium text-white/55 transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {MOVES.map((m) => {
                  const on = active.has(m.id)
                  const cost = m.delta >= 0
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(m.id)}
                      aria-pressed={on}
                      className={`group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal ${
                        on
                          ? 'border-violet-mid/50 bg-white/[0.07]'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                            on ? 'bg-violet-tip text-white' : 'bg-white/10 text-white/50'
                          }`}
                        >
                          {on ? <Check size={15} /> : <Plus size={15} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-white">{m.label}</span>
                          <span className="block truncate text-xs text-white/45">{m.detail}</span>
                        </span>
                      </span>
                      <span
                        className={`num shrink-0 rounded-md px-2 py-0.5 text-xs ${
                          cost
                            ? 'bg-[hsl(0_72%_51%/0.15)] text-[#FCA5A5]'
                            : 'bg-[hsl(142_70%_45%/0.15)] text-[#86EFAC]'
                        }`}
                      >
                        {fmtPts(m.delta)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Sporting consequences — opens on breach, escalates to a points
                deduction and a league-table drop past ~105%. */}
            <ConsequencesPanel
              projected={projected}
              pointsDeducted={pointsDeducted}
              breach={breach}
            />
          </motion.div>
        </Reveal>
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  tone = 'white',
}: {
  label: string
  value: string
  tone?: 'white' | 'violet' | 'green' | 'red'
}) {
  const color =
    tone === 'red'
      ? 'text-[#FCA5A5]'
      : tone === 'green'
        ? 'text-[#86EFAC]'
        : tone === 'violet'
          ? 'text-violet-soft'
          : 'text-white/85'
  return (
    <div className="rounded-lg bg-white/[0.03] py-2.5">
      <div className={`num text-sm ${color}`}>{value}</div>
      <div className="meta-label mt-0.5 text-white/40">{label}</div>
    </div>
  )
}
