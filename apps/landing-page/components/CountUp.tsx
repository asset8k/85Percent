'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, useInView, useReducedMotion } from 'framer-motion'
import { EASE_EXPO } from './motion/variants'

/**
 * CountUp — animates a number from 0 to `to` once it scrolls into view, in the
 * mono `.num` treatment. Used for the audited "85%" stat and other figures, so
 * they tick up like a live read-out instead of sitting static. Reduced motion
 * shows the final value immediately.
 */
export function CountUp({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1.4,
  className = '',
}: {
  to: number
  decimals?: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      setValue(to)
      return
    }
    const controls = animate(0, to, {
      duration,
      ease: EASE_EXPO,
      onUpdate: (v) => setValue(v),
    })
    return controls.stop
  }, [inView, to, duration, reduce])

  return (
    <span ref={ref} className={`num ${className}`}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  )
}
