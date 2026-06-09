'use client'

import { useEffect, useId, useState } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { EASE_EXPO } from './motion/variants'

/**
 * ScrGauge — the shared, value-driven Squad Cost Ratio gauge. A top semicircle
 * with green/amber/red zones, a violet-tip progress arc, a needle, and a centre
 * read-out. Driven by a single motion value, so it both DRAWS in on mount AND
 * smoothly re-sweeps whenever `value` changes — that's what powers the hero
 * (static 81%) and the interactive CommandCenter (value moves as you toggle moves).
 *
 * The read-out and needle turn red the moment `value` crosses `limit`, so a breach
 * reads instantly. Reduced motion snaps instead of sweeping.
 */

// Geometry (viewBox units). Top semicircle: theta 180°(left) → 0°(right).
const CX = 280
const CY = 296
const R = 168
// Round to 2dp: Math.cos/sin aren't bit-identical across the Node (SSR) and V8
// (browser) math libs, so the raw floats serialise differently and trip a
// hydration mismatch on the static SVG coords. 2dp is sub-pixel at this viewBox.
const r2 = (n: number) => Math.round(n * 100) / 100
const polar = (deg: number, radius = R) => {
  const rad = (deg * Math.PI) / 180
  return { x: r2(CX + radius * Math.cos(rad)), y: r2(CY - radius * Math.sin(rad)) }
}
const angleAt = (f: number) => 180 - Math.max(0, Math.min(1, f)) * 180
const arcStart = polar(180)
const arcEnd = polar(0)
const TRACK_D = `M ${arcStart.x} ${arcStart.y} A ${R} ${R} 0 0 1 ${arcEnd.x} ${arcEnd.y}`

export function ScrGauge({
  value,
  limit = 0.85,
  className,
}: {
  value: number
  limit?: number
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const grad = `scr-violet-${uid}`
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)
  const [pct, setPct] = useState(0)

  // Draw in on mount, then re-sweep on every value change.
  useEffect(() => {
    const controls = animate(mv, value, {
      duration: reduce ? 0 : 1.2,
      ease: EASE_EXPO,
    })
    return controls.stop
  }, [value, mv, reduce])

  // Mirror the live value into a rounded read-out.
  useEffect(() => {
    const unsub = mv.on('change', (v) => setPct(Math.round(v * 100)))
    return unsub
  }, [mv])

  const needleX = useTransform(mv, (v) => polar(angleAt(v)).x)
  const needleY = useTransform(mv, (v) => polar(angleAt(v)).y)

  const breach = pct > Math.round(limit * 100)
  const readout = breach ? '#F87171' : '#FFFFFF'
  const limOn = polar(angleAt(limit), R)
  const limInner = polar(angleAt(limit), R - 19)
  const limOuter = polar(angleAt(limit), R + 19)

  return (
    <svg
      viewBox="0 0 560 360"
      className={className}
      role="img"
      aria-label={`Squad Cost Ratio gauge reading ${pct} percent, limit ${Math.round(limit * 100)} percent.`}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="560" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6D28D9" />
          <stop offset="0.55" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#B98AF0" />
        </linearGradient>
      </defs>

      {/* Faint pitch geometry watermark */}
      <g stroke="#ffffff" strokeOpacity="0.06" fill="none" strokeWidth="1.5">
        <line x1="280" y1="40" x2="280" y2="340" />
        <circle cx="280" cy="296" r="54" />
        <rect x="120" y="300" width="320" height="40" rx="2" />
      </g>

      {/* Track */}
      <path d={TRACK_D} fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="22" strokeLinecap="round" />

      {/* Zone band: green (safe) / amber (watch) / red (past the limit) */}
      <g fill="none" strokeWidth="6" strokeLinecap="round" pathLength={100}>
        <path d={TRACK_D} stroke="hsl(142 70% 45%)" strokeOpacity="0.85" strokeDasharray="73 100" strokeDashoffset="0" />
        <path d={TRACK_D} stroke="hsl(38 92% 50%)" strokeOpacity="0.85" strokeDasharray="12 100" strokeDashoffset="-73" />
        <path d={TRACK_D} stroke="hsl(0 72% 51%)" strokeOpacity="0.85" strokeDasharray="15 100" strokeDashoffset="-85" />
      </g>

      {/* The 85% limit — the whole point of the product, so it's the loudest mark on
          the dial: a bright radial tick, a pulsing marker on the arc, and a bold
          read of the number itself. */}
      <line x1={limInner.x} y1={limInner.y} x2={limOuter.x} y2={limOuter.y} stroke="#ffffff" strokeOpacity="0.92" strokeWidth="3.5" strokeLinecap="round" />
      {/* Pulsing halo — always rendered (stable initial, so SSR matches), animation
          gated by reduced-motion at the `animate` level, not by conditional render. */}
      <motion.circle
        cx={limOn.x}
        cy={limOn.y}
        fill="none"
        stroke="#C4B5FD"
        strokeWidth="2"
        initial={{ r: 6, opacity: 0 }}
        animate={reduce ? { r: 6, opacity: 0 } : { r: [6, 18], opacity: [0.7, 0] }}
        transition={reduce ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
      />
      <circle cx={limOn.x} cy={limOn.y} r="5.5" fill="#FFFFFF" />
      <circle cx={limOn.x} cy={limOn.y} r="5.5" fill="none" stroke="#8B5CF6" strokeWidth="2" />
      <text x={limOuter.x + 10} y={limOuter.y - 3} textAnchor="start" className="num" fill="#ffffff" style={{ fontSize: 23, fontWeight: 600, letterSpacing: '-0.02em' }}>
        {Math.round(limit * 100)}%
      </text>
      <text x={limOuter.x + 10} y={limOuter.y + 12} textAnchor="start" fill="#C4B5FD" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em' }}>
        THE LIMIT
      </text>

      {/* Violet progress arc (pathLength bound to the motion value) */}
      <motion.path
        d={TRACK_D}
        fill="none"
        stroke={`url(#${grad})`}
        strokeWidth="14"
        strokeLinecap="round"
        style={{ pathLength: mv }}
      />

      {/* Needle + hub */}
      <motion.line x1={CX} y1={CY} x2={needleX} y2={needleY} stroke={readout} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx={CX} cy={CY} r="11" fill={`url(#${grad})`} />
      <circle cx={CX} cy={CY} r="11" fill="none" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="1.5" />

      {/* Read-out */}
      <text x={CX} y={CY - 26} textAnchor="middle" className="num" fill={readout} style={{ fontSize: 62, fontWeight: 600, letterSpacing: '-0.02em' }}>
        {pct}%
      </text>
    </svg>
  )
}

export const SCR_LIMIT = 0.85
