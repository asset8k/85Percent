'use client'

import { motion } from 'framer-motion'
import { EASE_EXPO } from './motion/variants'
import type { Capability } from '@/content/capabilities'

/**
 * CapabilityCard — one pillar in the carousel (spec §5a). Icon chip (violet-tip
 * gradient, white glyph), display title, the one-line promise, a supporting
 * sentence, and a thin violet underline that draws in (scaleX 0→1, origin-left)
 * only while the card is the active/focal one. Glassy white card with a violet
 * drop shadow.
 */
export function CapabilityCard({
  capability,
  isActive,
}: {
  capability: Capability
  isActive: boolean
}) {
  const Icon = capability.icon
  return (
    <div
      className="flex h-full flex-col rounded-lg border border-border bg-white p-8 shadow-[0_1px_0_rgba(0,0,0,0.04),0_24px_48px_-24px_rgba(109,40,217,0.18)] sm:p-10"
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet-tip text-white shadow-[0_8px_20px_-8px_rgba(109,40,217,0.6)]">
        <Icon size={22} strokeWidth={1.75} />
      </span>

      <h3 className="mt-7 font-display text-2xl font-semibold tracking-tight text-foreground">
        {capability.title}
      </h3>

      {/* The violet underline — draws only on the active card. */}
      <div className="mt-3 h-px w-16 overflow-hidden">
        <motion.div
          className="h-px w-full origin-left bg-violet-tip"
          initial={false}
          animate={{ scaleX: isActive ? 1 : 0 }}
          transition={{ duration: 0.7, ease: EASE_EXPO }}
        />
      </div>

      <p className="mt-5 text-lg font-medium leading-snug text-foreground">
        {capability.promise}
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {capability.body}
      </p>
    </div>
  )
}
