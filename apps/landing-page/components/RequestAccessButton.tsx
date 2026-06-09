'use client'

import { useState } from 'react'
import { DemoRequestDialog } from './DemoRequestDialog'
import { CTA_LABEL } from '@/content/nav'

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

/**
 * RequestAccessButton — the shared CTA. Every instance owns its own
 * DemoRequestDialog, so the same component drops into the navbar, hero, and
 * footer without any shared open-state plumbing. `source` records which CTA fired
 * for lead triage.
 */
export function RequestAccessButton({
  variant = 'primary',
  size = 'md',
  source = 'navbar',
  label = CTA_LABEL,
  className = '',
}: {
  variant?: Variant
  size?: keyof typeof SIZES
  source?: string
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center rounded-md font-medium transition-all duration-200 ease-gentle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      >
        {label}
      </button>
      <DemoRequestDialog open={open} onClose={() => setOpen(false)} source={source} />
    </>
  )
}
