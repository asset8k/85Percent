import { useEffect, useRef } from 'react'
import { animate, useInView, useMotionValue, useTransform, motion } from 'framer-motion'

// Spinning count-up for big numbers. When the prop value changes, the displayed
// number eases from its previous render value to the new one. First mount
// animates from 0 → value (only when scrolled into view, so off-screen number
// changes don't trigger fake animations).
export interface AnimatedNumberProps {
  value: number
  /** Decimal places to display. */
  decimals?: number
  /** Optional formatter — runs on the interpolated number every frame. */
  format?: (n: number) => string
  /** Animation duration in seconds. */
  duration?: number
  /** Inline style props for color transitions, etc. */
  className?: string
  prefix?: string
  suffix?: string
}

const ENTER_DURATION_DEFAULT = 0.9
const UPDATE_DURATION_DEFAULT = 0.55

export function AnimatedNumber({
  value,
  decimals = 0,
  format,
  duration,
  className,
  prefix,
  suffix,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: false, margin: '0px 0px -10% 0px' })
  const motionValue = useMotionValue(0)
  const displayed = useTransform(motionValue, (latest) => {
    const n = format ? format(latest) : latest.toFixed(decimals)
    return `${prefix ?? ''}${n}${suffix ?? ''}`
  })

  const prevValue = useRef<number | null>(null)
  const hasEntered = useRef(false)

  useEffect(() => {
    if (!Number.isFinite(value)) return
    const isFirstAnimation = !hasEntered.current
    if (isFirstAnimation && !inView) return
    const from = isFirstAnimation ? 0 : prevValue.current ?? value
    const controls = animate(motionValue, value, {
      duration: duration ?? (isFirstAnimation ? ENTER_DURATION_DEFAULT : UPDATE_DURATION_DEFAULT),
      ease: [0.16, 1, 0.3, 1], // ease-out-expo-ish — fast start, soft land
      // Force the starting point on first animation so we count up from 0
      // rather than glitch from whatever the motion value's prior was.
      ...(isFirstAnimation ? { from } : {}),
    })
    hasEntered.current = true
    prevValue.current = value
    return () => controls.stop()
  }, [value, motionValue, duration, inView])

  return <motion.span ref={ref} className={className}>{displayed}</motion.span>
}
