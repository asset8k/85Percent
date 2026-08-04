'use client'

import { motion } from 'framer-motion'
import { EASE_EXPO } from './motion/variants'
import { TiltCard } from './TiltCard'
import type { Capability } from '@/content/capabilities'

/**
 * CapabilityCard — one pillar in the carousel (spec §5a). Icon chip (violet-tip
 * gradient, white glyph), display title, the one-line promise, a supporting
 * sentence, and a thin violet underline that draws in (scaleX 0→1, origin-left)
 * only while the card is the active/focal one. The whole card lifts on focus: its
 * border and shadow warm to violet and the icon chip gains a glow, so the centred
 * card reads as lit while neighbours sit back.
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
    <TiltCard className="h-full" enable={isActive} max={5}>
    <motion.div
      className="flex h-full flex-col rounded-2xl border bg-white p-6 sm:p-10"
      initial={false}
      animate={{
        // Literal rgba (not CSS vars) so framer can interpolate the colour.
        borderColor: isActive ? 'rgba(139, 92, 246, 0.45)' : 'rgba(217, 223, 232, 1)',
        boxShadow: isActive
          ? '0 1px 0 rgba(0,0,0,0.04), 0 32px 64px -28px rgba(109,40,217,0.4)'
          : '0 1px 0 rgba(0,0,0,0.04), 0 24px 48px -24px rgba(109,40,217,0.12)',
      }}
      transition={{ duration: 0.7, ease: EASE_EXPO }}
    >
      <motion.span
        className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet-tip text-white"
        initial={false}
        animate={{
          boxShadow: isActive
            ? '0 10px 26px -6px rgba(109,40,217,0.75)'
            : '0 8px 20px -8px rgba(109,40,217,0.4)',
        }}
        transition={{ duration: 0.7, ease: EASE_EXPO }}
      >
        <Icon size={22} strokeWidth={1.75} />
      </motion.span>

      <h3 className="mt-6 font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
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
    </motion.div>
    </TiltCard>
  )
}
