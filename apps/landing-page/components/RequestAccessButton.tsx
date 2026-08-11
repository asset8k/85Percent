'use client'

import { useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { DemoRequestDialog } from './DemoRequestDialog'
import { EASE_EXPO } from './motion/variants'
import { CTA_LABEL } from '@/content/nav'
import { trackAnalytics } from '@/lib/analytics'

type Variant = 'primary' | 'inverse' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  // Violet-tip gradient on light surfaces — the default CTA.
  primary:
    'bg-violet-tip text-white shadow-[0_8px_24px_-8px_rgba(109,40,217,0.6)] hover:opacity-95',
  // White button for the charcoal hero band.
  inverse: 'bg-white text-charcoal hover:bg-white/90',
  // Quiet text-style CTA for the navbar at rest.
  ghost: 'bg-transparent text-foreground hover:bg-surface',
}

const SIZES = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
} as const

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v))

/**
 * RequestAccessButton — the shared CTA. Every instance owns its own
 * DemoRequestDialog, so the same component drops into the navbar, hero, and footer
 * without any shared open-state plumbing. `source` records which CTA fired.
 *
 * Optional flourishes (all reduced-motion safe): `pulse` (breathing glow + stroke
 * ring), `magnetic` (the button leans toward the cursor on hover), and
 * `gradientShift` (a violet gradient that slowly drifts hue, for the nav CTA).
 */
export function RequestAccessButton({
  variant = 'primary',
  size = 'md',
  source = 'navbar',
  label = CTA_LABEL,
  className = '',
  pulse = false,
  magnetic = false,
  gradientShift = false,
}: {
  variant?: Variant
  size?: keyof typeof SIZES
  source?: string
  label?: string
  className?: string
  pulse?: boolean
  magnetic?: boolean
  gradientShift?: boolean
}) {
  const [open, setOpen] = useState(false)
  const reduce = useReducedMotion()

  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const x = useSpring(mx, { stiffness: 160, damping: 14, mass: 0.3 })
  const y = useSpring(my, { stiffness: 160, damping: 14, mass: 0.3 })

  // NB: structure/style below must depend only on PROPS, never on `reduce` —
  // useReducedMotion resolves differently on the server vs the client's first
  // render, so branching the DOM on it causes a hydration mismatch. Reduced-motion
  // for the animations is handled globally by MotionConfig; here we only consult
  // `reduce` at runtime inside the pointer handler.
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!magnetic || reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set(clamp((e.clientX - (r.left + r.width / 2)) * 0.3, 10))
    my.set(clamp((e.clientY - (r.top + r.height / 2)) * 0.4, 8))
  }
  const onLeave = () => {
    mx.set(0)
    my.set(0)
  }

  const surface = gradientShift
    ? 'bg-violet-tip text-white shadow-[0_8px_24px_-8px_rgba(109,40,217,0.7)] hover:brightness-110'
    : VARIANTS[variant]

  const btn = (
    <button
      type="button"
      onClick={() => {
        trackAnalytics('landing_cta_clicked', {
          cta_name: label,
          location: source,
          destination: 'request_access_dialog',
        })
        trackAnalytics('request_access_clicked', { location: source })
        setOpen(true)
      }}
      className={`relative z-10 inline-flex items-center justify-center rounded-md font-medium transition-all duration-200 ease-gentle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${surface} ${SIZES[size]} ${className}`}
    >
      {label}
    </button>
  )

  const wrap = pulse || magnetic

  return (
    <>
      {wrap ? (
        <motion.span
          className="relative inline-flex"
          style={magnetic ? { x, y } : undefined}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          animate={pulse ? { scale: [1, 1.025, 1] } : undefined}
          transition={{ duration: 2.4, repeat: Infinity, ease: EASE_EXPO }}
        >
          {/* Expanding stroke ring — radiates out and fades, on a slow loop. */}
          {pulse && (
            <>
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-violet-mid/60"
                animate={{ scale: [1, 1.35], opacity: [0.55, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.span
                aria-hidden
                className="pointer-events-none absolute -inset-1 rounded-lg bg-violet-core/30 blur-md"
                animate={{ opacity: [0.25, 0.6, 0.25] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: EASE_EXPO }}
              />
            </>
          )}
          {btn}
        </motion.span>
      ) : (
        btn
      )}
      <DemoRequestDialog open={open} onClose={() => setOpen(false)} source={source} />
    </>
  )
}
