'use client'

import { useReducedMotion } from 'framer-motion'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * ScrTrendChart — the Squad Cost Ratio trajectory across the transfer window, the
 * one genuine multi-series chart on the page so it's worth the recharts dependency
 * (the radial gauge stays hand-rolled). The line climbs from the season opening to
 * today's 78%, then projects to deadline day based on the moves the visitor has
 * stacked. A dashed red reference line marks the 85% hard cap; the live "deadline"
 * dot turns red the instant the projection breaches it.
 *
 * Restyled top-to-bottom for the charcoal command-center surface — recharts' stock
 * look is discarded for violet-tip gradients, mono ticks, and EASE-OUT animation
 * that honours the no-bounce doctrine. Reduced motion disables the draw-in.
 */

export interface TrendPoint {
  m: string
  scr: number
}

export function ScrTrendChart({
  data,
  projectedPct,
  breach,
  limitPct = 85,
}: {
  data: TrendPoint[]
  projectedPct: number
  breach: boolean
  limitPct?: number
}) {
  const reduce = useReducedMotion()
  const last = data[data.length - 1] ?? { m: '', scr: projectedPct }
  const dotColor = breach ? '#F87171' : '#B98AF0'

  // Keep the cap line and a breach spike (up to ~110%) in frame.
  const peak = Math.max(90, ...data.map((d) => d.scr), limitPct)
  const yMax = Math.ceil((peak + 6) / 10) * 10
  const ticks = Array.from({ length: (yMax - 60) / 10 + 1 }, (_, i) => 60 + i * 10)

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="scrTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.38} />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="scrTrendStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6D28D9" />
              <stop offset="100%" stopColor="#B98AF0" />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="rgba(255,255,255,0.06)"
            vertical={false}
          />

          <XAxis
            dataKey="m"
            tick={{ fill: 'rgba(255,255,255,0.42)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            dy={4}
          />
          <YAxis
            domain={[60, yMax]}
            ticks={ticks}
            tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={42}
            tickFormatter={(v) => `${v}%`}
          />

          <ReferenceLine
            y={limitPct}
            stroke="#F87171"
            strokeDasharray="4 4"
            strokeOpacity={0.8}
            label={{
              value: `${limitPct}% cap`,
              position: 'insideTopRight',
              fill: '#FCA5A5',
              fontSize: 11,
            }}
          />

          <Area
            type="monotone"
            dataKey="scr"
            stroke="url(#scrTrendStroke)"
            strokeWidth={2.5}
            fill="url(#scrTrendFill)"
            isAnimationActive={!reduce}
            animationDuration={1100}
            animationEasing="ease-out"
            dot={false}
            activeDot={false}
          />

          {/* Live "deadline-day" marker — re-positions and recolours as moves change. */}
          <ReferenceDot
            x={last.m}
            y={projectedPct}
            r={5}
            fill={dotColor}
            stroke="#0B1020"
            strokeWidth={2}
            isFront
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
