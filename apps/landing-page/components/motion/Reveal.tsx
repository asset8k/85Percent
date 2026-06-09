'use client'

import { motion, type HTMLMotionProps, type Variants } from 'framer-motion'
import { EASE_EXPO } from './variants'

/**
 * Reveal — the scroll-triggered fade-up wrapper used by every section's text
 * blocks. Plays once when ~30% of the element enters the viewport. Reduced motion
 * is handled globally by MotionConfig (see app/providers.tsx), so this collapses
 * to an opacity-only fade automatically when the user asks for less motion.
 *
 * Pass `delay` to offset the start (e.g. staggering two sibling Reveals). The
 * delay is baked into the variant's own transition so it survives framer-motion's
 * variant/prop merge (a top-level `transition` prop would be ignored here).
 */
export function Reveal({
  children,
  delay = 0,
  className,
  ...props
}: {
  children: React.ReactNode
  delay?: number
} & HTMLMotionProps<'div'>) {
  // NB: keep this variant reduced-motion-independent — it's the SSR initial style,
  // so branching it on useReducedMotion would mismatch on hydration. MotionConfig
  // neutralises the transform for reduced-motion users; the blur/opacity fade that
  // remains is gentle and non-vestibular.
  const variants: Variants = {
    hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
    visible: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.8, ease: EASE_EXPO, delay },
    },
  }
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
