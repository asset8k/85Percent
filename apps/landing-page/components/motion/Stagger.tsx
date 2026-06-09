'use client'

import { motion, type HTMLMotionProps } from 'framer-motion'
import { staggerParent, fadeUp } from './variants'

/**
 * Stagger — a parent that reveals its children one after another. Powers the hero
 * entrance and the capability intro. Wrap the group in <Stagger> and each child in
 * <Stagger.Item>; the parent orchestrates timing (staggerChildren), the items
 * carry the fade-up motion.
 *
 * `trigger="mount"` (default) plays once on mount — used by the hero, which should
 * animate immediately, not on scroll. `trigger="inView"` defers until the group
 * scrolls into view.
 */
export function Stagger({
  children,
  trigger = 'mount',
  className,
  ...props
}: {
  children: React.ReactNode
  trigger?: 'mount' | 'inView'
} & HTMLMotionProps<'div'>) {
  const animateProps =
    trigger === 'mount'
      ? { animate: 'visible' as const }
      : {
          whileInView: 'visible' as const,
          viewport: { once: true, amount: 0.3 } as const,
        }
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      {...animateProps}
      {...props}
    >
      {children}
    </motion.div>
  )
}

/** A single staggered child — fades up in sequence under its <Stagger> parent. */
function Item({
  children,
  className,
  ...props
}: { children: React.ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <motion.div className={className} variants={fadeUp} {...props}>
      {children}
    </motion.div>
  )
}

Stagger.Item = Item
