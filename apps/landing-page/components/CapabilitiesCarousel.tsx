'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { CapabilityCard } from './CapabilityCard'
import { Reveal } from './motion/Reveal'
import { EASE_EXPO } from './motion/variants'
import { capabilities } from '@/content/capabilities'

const GAP = 24 // px — matches the flex `gap-6`
const useIso = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * CapabilitiesCarousel — the centrepiece (spec §5.4 / §5a). A hand-rolled,
 * heavy/controlled horizontal slider: one focal card centred with neighbours
 * peeking (scale/opacity falloff), auto-play every 6s that pauses on hover,
 * focus, drag, tab-hidden and reduced-motion, draggable with velocity snap, and
 * full keyboard + ARIA carousel semantics.
 *
 * x lives in one motion value shared by drag (user) and `animate()` (programmatic),
 * so both move the same track without fighting a controlled prop.
 */
export function CapabilitiesCarousel() {
  const n = capabilities.length
  const containerRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(0)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  const x = useMotionValue(0)
  const reduce = useReducedMotion()

  // Pause inputs.
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [tabHidden, setTabHidden] = useState(false)

  const cardWidth = width * (width < 640 ? 0.84 : 0.56)
  const step = cardWidth + GAP
  const targetX = useCallback(
    (i: number) => (widthRef.current ? widthRef.current / 2 - cardWidth / 2 - i * step : 0),
    [cardWidth, step],
  )

  // Measure the viewport; re-snap (no animation) on resize.
  useIso(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      widthRef.current = el.clientWidth
      setWidth(el.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep x correct when dimensions change without animating.
  useEffect(() => {
    if (width) x.set(targetX(activeRef.current))
  }, [width, targetX, x])

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(n - 1, i))
      activeRef.current = clamped
      setActive(clamped)
      animate(x, targetX(clamped), { duration: 0.7, ease: EASE_EXPO })
    },
    [n, targetX, x],
  )

  // Auto-play (6s), paused by any of the inputs below.
  const paused = hovering || focused || dragging || tabHidden || !!reduce
  useEffect(() => {
    if (paused || !width) return
    const t = window.setTimeout(() => goTo((activeRef.current + 1) % n), 6000)
    return () => window.clearTimeout(t)
  }, [paused, width, active, n, goTo])

  // Pause when the tab is hidden.
  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  function onDragEnd(_e: unknown, info: PanInfo) {
    setDragging(false)
    const projected = x.get() + info.velocity.x * 0.2
    const i = Math.round((widthRef.current / 2 - cardWidth / 2 - projected) / step)
    goTo(i)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(active + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(active - 1) }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0) }
    else if (e.key === 'End') { e.preventDefault(); goTo(n - 1) }
  }

  const dragConstraints = width
    ? { left: targetX(n - 1), right: targetX(0) }
    : { left: 0, right: 0 }

  return (
    <section id="capabilities" data-nav-theme="light" className="scroll-mt-20 overflow-hidden bg-surface">
      <div className="mx-auto max-w-content px-6 py-28">
        <Reveal className="max-w-2xl">
          <span className="meta-label text-primary">Capabilities</span>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-foreground sm:text-4xl">
            One engine, from live position to the next signing.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Monitor where you stand, model where you’re going, and ask anything in
            between. All grounded in your club’s own numbers.
          </p>
        </Reveal>

        {/* Carousel */}
        <div
          className="relative mt-14"
          role="group"
          aria-roledescription="carousel"
          aria-label="Core capabilities"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <div ref={containerRef} className="relative overflow-hidden">
            {/* Soft edge fades so neighbouring cards dissolve into the band. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-12 bg-gradient-to-r from-surface to-transparent sm:w-24" aria-hidden />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-12 bg-gradient-to-l from-surface to-transparent sm:w-24" aria-hidden />

            <motion.div
              className="flex cursor-grab gap-6 py-6 active:cursor-grabbing"
              style={{ x, perspective: 1600 }}
              drag="x"
              dragConstraints={dragConstraints}
              dragElastic={0.08}
              dragMomentum={false}
              onDragStart={() => setDragging(true)}
              onDragEnd={onDragEnd}
            >
              {capabilities.map((cap, i) => {
                const isActive = i === active
                const offset = i - active
                return (
                  <motion.div
                    key={cap.id}
                    className="w-[84%] shrink-0 sm:w-[56%]"
                    style={{ transformStyle: 'preserve-3d' }}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`${i + 1} of ${n}`}
                    animate={{
                      scale: isActive ? 1 : 0.9,
                      opacity: isActive ? 1 : 0.4,
                      rotateY: isActive ? 0 : offset < 0 ? 9 : -9,
                      filter: isActive ? 'blur(0px)' : 'blur(3px)',
                    }}
                    transition={{ duration: 0.7, ease: EASE_EXPO }}
                  >
                    <CapabilityCard capability={cap} isActive={isActive} />
                  </motion.div>
                )
              })}
            </motion.div>
          </div>

          {/* Controls */}
          <div className="mt-10 flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={() => goTo(active - 1)}
              disabled={active === 0}
              aria-label="Previous capability"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-foreground transition-all hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="flex items-center gap-2" role="tablist" aria-label="Select capability">
              {capabilities.map((cap, i) => (
                <button
                  key={cap.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Go to ${cap.title}`}
                  onClick={() => goTo(i)}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === active ? 'w-7 bg-violet-core' : 'w-2 bg-border hover:bg-muted-foreground/40'
                  }`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => goTo(active + 1)}
              disabled={active === n - 1}
              aria-label="Next capability"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-foreground transition-all hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ArrowRight size={18} />
            </button>
          </div>

          {/* Autoplay progress — restarts each slide, freezes on hover/focus/drag. */}
          <div className="mx-auto mt-6 h-0.5 w-32 overflow-hidden rounded-full bg-border">
            {!reduce && width > 0 && (
              <div
                key={active}
                className="h-full rounded-full bg-violet-tip"
                style={{
                  animation: 'carousel-progress 6s linear forwards',
                  animationPlayState: paused ? 'paused' : 'running',
                }}
              />
            )}
          </div>

          {/* Live region — announces the active slide to assistive tech. */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {`${active + 1} of ${n}: ${capabilities[active]?.title ?? ''}`}
          </div>
        </div>
      </div>
    </section>
  )
}
