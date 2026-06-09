import type { Variants } from 'framer-motion'

/**
 * The single source of motion truth (spec §7).
 *
 * Doctrine: heavy, precise, expensive. Every motion uses the `expo` curve
 * (`[0.16, 1, 0.3, 1]`) or `gentle`, durations 0.6–0.9s. Banned: bouncy springs,
 * overshoot, scale-pop > 1, rotation gimmicks, anything < 0.4s on a reveal.
 *
 * Reduced motion is handled centrally by `<MotionConfig reducedMotion="user">`
 * (see app/providers.tsx): framer-motion then drops transform/distance animation
 * and keeps opacity only, so these variants need no per-component guard.
 */

/** The "expensive" easing curve — used everywhere, no bounce. */
export const EASE_EXPO = [0.16, 1, 0.3, 1] as const

/** The gentler curve for small, frequent transitions (hover, nav state). */
export const EASE_GENTLE = [0.25, 0.1, 0.25, 1] as const

/** Fade up from 24px — the default reveal for text blocks and cards. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: EASE_EXPO },
  },
}

/** Plain opacity fade — for visuals where vertical motion would read as jumpy. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.7, ease: EASE_EXPO },
  },
}

/** Parent orchestrator: reveals children in sequence (hero, capability intro). */
export const staggerParent: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.05 },
  },
}
