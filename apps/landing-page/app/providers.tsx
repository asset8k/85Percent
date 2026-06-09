'use client'

import { MotionConfig } from 'framer-motion'

/**
 * Client providers for the marketing site.
 *
 * The reduced-motion gate (spec §7) lives here, once, for the whole tree:
 * `reducedMotion="user"` makes framer-motion automatically drop transform and
 * layout animation — keeping opacity-only fades — whenever the visitor's OS
 * prefers reduced motion. No component opts in or out by accident; carousel
 * auto-play and parallax read the same `useReducedMotion()` signal.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
