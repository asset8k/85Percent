'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Check, AlertTriangle, ShieldCheck } from 'lucide-react'
import { ScrGauge, SCR_LIMIT } from './ScrGauge'
import { Reveal } from './motion/Reveal'
import { EASE_EXPO } from './motion/variants'

/**
 * ScenarioDemo — the interactive proof. The visitor stacks real transfer moves and
 * watches the live Squad Cost Ratio gauge re-sweep, the headroom recompute, and the
 * status flip from Compliant to Breach the moment a move pushes them over 85%. It's
 * the hero's 81% gauge made playable — the product's core loop in miniature.
 */

const BASE = 0.81 // starting SCR

interface Move {
  id: string
  label: string
  detail: string
  delta: number // change in SCR (fraction)
}

const MOVES: Move[] = [
  { id: 'striker', label: 'Sign £60M striker', detail: 'Wages + amortisation', delta: 0.055 },
  { id: 'renew', label: 'Renew the captain', detail: '+£90k / week', delta: 0.02 },
  { id: 'loan', label: 'Loan in a winger', detail: 'Loan fee + wages', delta: 0.011 },
  { id: 'sell', label: 'Sell centre-back', detail: '£45M, off the wage bill', delta: -0.041 },
  { id: 'academy', label: 'Promote academy grad', detail: 'Replaces a senior wage', delta: -0.014 },
]

const fmtPts = (frac: number) => `${frac >= 0 ? '+' : '−'}${Math.abs(frac * 100).toFixed(1)} pts`

export function ScenarioDemo() {
  const [active, setActive] = useState<Set<string>>(new Set(['striker']))

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const delta = MOVES.filter((m) => active.has(m.id)).reduce((s, m) => s + m.delta, 0)
  const projected = Math.max(0, Math.min(1.2, BASE + delta))
  const breach = projected > SCR_LIMIT
  const headroomPts = (SCR_LIMIT - projected) * 100

  return (
    <section className="relative isolate overflow-hidden bg-charcoal text-charcoal-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_100%,hsl(var(--v-core)/0.18),transparent_70%)]" aria-hidden />
      <div className="mx-auto grid max-w-content grid-cols-1 items-center gap-14 px-6 py-28 lg:grid-cols-2 lg:gap-16">
        {/* Controls */}
        <div>
          <Reveal>
            <span className="meta-label text-violet-soft">Try it</span>
            <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Model the window. Watch the line.
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-white/65">
              Stack the moves you’re weighing up and see the Squad Cost Ratio
              respond in real time — the instant a deal pushes you past 85%, you
              know.
            </p>
          </Reveal>

          <div className="mt-8 flex flex-col gap-2.5">
            {MOVES.map((m) => {
              const on = active.has(m.id)
              const cost = m.delta >= 0
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-pressed={on}
                  className={`group flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal ${
                    on
                      ? 'border-violet-mid/50 bg-white/[0.07]'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                        on ? 'bg-violet-tip text-white' : 'bg-white/10 text-white/50'
                      }`}
                    >
                      {on ? <Check size={15} /> : <Plus size={15} />}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-white">{m.label}</span>
                      <span className="block text-xs text-white/45">{m.detail}</span>
                    </span>
                  </span>
                  <span
                    className={`num rounded-md px-2 py-0.5 text-xs ${
                      cost ? 'bg-[hsl(0_72%_51%/0.15)] text-[#FCA5A5]' : 'bg-[hsl(142_70%_45%/0.15)] text-[#86EFAC]'
                    }`}
                  >
                    {fmtPts(m.delta)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Live gauge panel */}
        <Reveal delay={0.1}>
          <motion.div
            className="relative rounded-2xl border bg-white/[0.04] p-6 backdrop-blur-sm sm:p-8"
            animate={{
              borderColor: breach ? 'hsl(0 72% 51% / 0.5)' : 'rgba(255,255,255,0.1)',
              boxShadow: breach
                ? '0 40px 80px -32px hsl(0 72% 51% / 0.4)'
                : '0 40px 80px -32px rgba(0,0,0,0.7)',
            }}
            transition={{ duration: 0.5, ease: EASE_EXPO }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="meta-label text-white/50">Projected SCR</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={breach ? 'breach' : 'ok'}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.25 }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
                    breach ? 'bg-[hsl(0_72%_51%/0.16)] text-[#FCA5A5]' : 'bg-[hsl(142_70%_45%/0.16)] text-[#86EFAC]'
                  }`}
                >
                  {breach ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                  {breach ? 'Breach' : 'Compliant'}
                </motion.span>
              </AnimatePresence>
            </div>

            <ScrGauge value={projected} className="w-full" />

            <div className="mt-1 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-white/[0.03] py-3">
                <div className={`num text-base ${breach ? 'text-[#FCA5A5]' : 'text-[#86EFAC]'}`}>
                  {headroomPts >= 0 ? '+' : '−'}
                  {Math.abs(headroomPts).toFixed(1)} pts
                </div>
                <div className="meta-label mt-0.5 text-white/40">
                  {breach ? 'Over the limit' : 'Headroom'}
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.03] py-3">
                <div className="num text-base text-white/85">{active.size}</div>
                <div className="meta-label mt-0.5 text-white/40">Moves in plan</div>
              </div>
            </div>
          </motion.div>
        </Reveal>
      </div>
    </section>
  )
}
