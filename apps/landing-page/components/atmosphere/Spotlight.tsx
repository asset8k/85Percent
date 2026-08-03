'use client'

import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * Spotlight — a soft violet glow that tracks the pointer across a dark section, so
 * the surface feels lit and responsive under the cursor. Attaches to its parent
 * element (must be `relative`), writes the cursor position to CSS vars and fades in
 * only while the pointer is over the band. Disabled under reduced-motion and on
 * touch (no pointer to follow).
 */
export function Spotlight({
  color = 'hsl(263 80% 60% / 0.22)',
  size = 520,
}: {
  color?: string
  size?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce || window.matchMedia('(pointer: coarse)').matches) return
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const r = parent.getBoundingClientRect()
      el.style.setProperty('--sx', `${e.clientX - r.left}px`)
      el.style.setProperty('--sy', `${e.clientY - r.top}px`)
      el.style.opacity = '1'
    }
    const onLeave = () => {
      el.style.opacity = '0'
    }

    parent.addEventListener('pointermove', onMove)
    parent.addEventListener('pointerleave', onLeave)
    return () => {
      parent.removeEventListener('pointermove', onMove)
      parent.removeEventListener('pointerleave', onLeave)
    }
  }, [reduce])

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 ease-out"
      style={{
        background: `radial-gradient(${size}px circle at var(--sx, 50%) var(--sy, 30%), ${color}, transparent 70%)`,
      }}
    />
  )
}
