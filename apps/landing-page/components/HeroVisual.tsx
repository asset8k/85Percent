'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { ScrGauge } from './ScrGauge'
import { TiltCard } from './TiltCard'

/**
 * HeroVisual — the abstract "dashboard-meets-pitch-geometry" showpiece (spec §5.2):
 * the shared SCR compliance gauge floating in a glassy panel. The story it tells,
 * internally consistent: a club running at an 81% SCR under the regulatory 85%
 * limit — wages 62 + amortisation 19 = 81, leaving +4 pts of headroom, Compliant.
 *
 * Motion: the gauge draws itself in on mount (ScrGauge); a ≤28px scroll parallax
 * adds depth here. Both collapse under prefers-reduced-motion.
 */
export function HeroVisual() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 28])

  return (
    <motion.div ref={ref} style={{ y }} className="relative w-full">
      {/* Soft violet aura behind the panel */}
      <div
        className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-violet-core/20 blur-3xl"
        aria-hidden
      />
      <TiltCard className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_40px_80px_-32px_rgba(0,0,0,0.7)] backdrop-blur-sm sm:p-8">
        {/* Card header — reads like a product panel */}
        <div className="mb-2 flex items-center justify-between">
          <span className="meta-label text-white/50">Squad Cost Ratio</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(142_70%_45%)]" />
            Compliant
          </span>
        </div>

        <ScrGauge value={0.81} className="w-full" />

        {/* Footnote row — the figures that sum to the 81% reading */}
        <div className="mt-1 grid grid-cols-3 gap-3 text-center">
          {[
            { k: 'Wages', v: '62%' },
            { k: 'Amortisation', v: '19%' },
            { k: 'Headroom', v: '+4 pts' },
          ].map((c) => (
            <div key={c.k} className="rounded-lg bg-white/[0.03] py-2.5">
              <div className="num text-sm text-white/85">{c.v}</div>
              <div className="meta-label mt-0.5 text-white/40">{c.k}</div>
            </div>
          ))}
        </div>
      </TiltCard>
    </motion.div>
  )
}
