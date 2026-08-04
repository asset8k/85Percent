'use client'

import { motion } from 'framer-motion'
import { EASE_EXPO } from '../motion/variants'

/**
 * ScrComparisonBars — the "current vs projected, closing on the cap" read, as two
 * hand-rolled animated bars sharing a 0–100% track. The current ratio sits static;
 * the projected bar grows/shrinks as the visitor stacks moves and flips to red the
 * moment it crosses the 85% cap. A dashed cap marker and a shaded red over-limit
 * zone make the headroom legible at a glance — no charting library needed.
 */

const CAP = 85

function Bar({
  label,
  pct,
  tone,
}: {
  label: string
  pct: number
  tone: 'current' | 'projected' | 'breach'
}) {
  const fill =
    tone === 'breach'
      ? 'linear-gradient(90deg,#B91C1C,#F87171)'
      : tone === 'projected'
        ? 'linear-gradient(90deg,#6D28D9,#B98AF0)'
        : 'rgba(255,255,255,0.28)'
  const readout = tone === 'breach' ? 'text-[#FCA5A5]' : 'text-white/85'

  return (
    <div>
      <div className="mb-1.5 flex min-w-0 items-baseline justify-between gap-3">
        <span className="meta-label text-white/45">{label}</span>
        <span className={`num text-sm ${readout}`}>{Math.round(pct)}%</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
        {/* Over-limit zone wash */}
        <div
          className="absolute inset-y-0 right-0 bg-[hsl(0_72%_51%/0.16)]"
          style={{ width: `${100 - CAP}%` }}
          aria-hidden
        />
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: fill }}
          initial={false}
          animate={{ width: `${Math.min(100, pct)}%` }}
          transition={{ duration: 0.9, ease: EASE_EXPO }}
        />
      </div>
    </div>
  )
}

export function ScrComparisonBars({
  current,
  projected,
  breach,
}: {
  current: number // 0–1
  projected: number // 0–1
  breach: boolean
}) {
  return (
    <div className="relative space-y-4 pt-5">
      <span className="meta-label block text-white/40 sm:hidden">85% cap</span>
      <Bar label="Current SCR" pct={current * 100} tone="current" />
      <Bar
        label="Projected SCR"
        pct={projected * 100}
        tone={breach ? 'breach' : 'projected'}
      />

      {/* Cap marker — a dashed vertical line at 85% spanning the bar stack. */}
      <div
        className="pointer-events-none absolute bottom-1 top-6 hidden w-px border-l border-dashed border-white/35 sm:block"
        style={{ left: `${CAP}%` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-0 hidden -translate-x-1/2 whitespace-nowrap sm:block"
        style={{ left: `${CAP}%` }}
        aria-hidden
      >
        <span className="meta-label text-white/40">85% cap</span>
      </div>
    </div>
  )
}
