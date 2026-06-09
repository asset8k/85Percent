'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Reveal } from './motion/Reveal'
import { EASE_EXPO, staggerParent, fadeUp } from './motion/variants'
import { features } from '@/content/features'

/**
 * PlatformFeatures — the depth section (#platform): the complete platform surface
 * beyond the three headline pillars, as a staggered grid. The three pillars are the
 * focus; this is the "and everything else" that closes the value case. Two cards are
 * live — a ticking transfer-deadline countdown and a cycling notifications feed — so
 * the grid shows the product working, not just lists it. Each card lifts a violet
 * top-accent on hover without shifting the seamless 1px-gap grid.
 */
export function PlatformFeatures() {
  return (
    <section id="platform" className="scroll-mt-20 bg-background">
      <div className="mx-auto max-w-content px-6 py-28">
        <Reveal className="max-w-2xl">
          <span className="meta-label text-primary">The platform</span>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-foreground sm:text-4xl">
            Everything a compliance operation needs, in{' '}
            <span className="text-gradient-violet">one place</span>.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Monitoring, scenarios and the AI analyst are the core. Around them sits
            the full toolkit your finance and recruitment teams run on every day.
          </p>
        </Reveal>

        <motion.div
          variants={staggerParent}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.15 }}
          className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((f) => {
            const Icon = f.icon
            const isCalendar = f.title.includes('calendar')
            const isNotifications = f.title.startsWith('Notifications')
            return (
              <motion.div
                key={f.title}
                variants={fadeUp}
                className="group relative overflow-hidden bg-background p-7 transition-colors duration-300 hover:bg-surface"
              >
                {/* Violet top-accent that draws in on hover (no layout shift). */}
                <span className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-violet-tip transition-transform duration-500 ease-out group-hover:scale-x-100" />

                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-primary transition-all duration-300 group-hover:scale-105 group-hover:border-primary/40 group-hover:bg-violet-tip group-hover:text-white group-hover:shadow-[0_10px_24px_-8px_rgba(109,40,217,0.6)]">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  {f.body}
                </p>

                {isCalendar && <DeadlineCountdown />}
                {isNotifications && <NotificationToasts />}
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}

/**
 * DeadlineCountdown — a live transfer-deadline countdown. Mounts client-only (state
 * starts null) to avoid an SSR/first-paint mismatch, then ticks every second.
 */
function DeadlineCountdown() {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (now === null) return null

  const target = new Date('2026-09-01T23:00:00Z').getTime()
  let diff = Math.max(0, target - now)
  const d = Math.floor(diff / 86_400_000)
  diff -= d * 86_400_000
  const h = Math.floor(diff / 3_600_000)
  diff -= h * 3_600_000
  const m = Math.floor(diff / 60_000)
  diff -= m * 60_000
  const s = Math.floor(diff / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-core" />
      <span className="num text-sm text-foreground">
        {d}d {pad(h)}h {pad(m)}m {pad(s)}s
      </span>
      <span className="meta-label text-muted-foreground">to deadline</span>
    </div>
  )
}

const ALERTS = [
  { tone: 'bg-[hsl(0_72%_51%)]', text: 'Breach risk: one move from the cap' },
  { tone: 'bg-[hsl(38_92%_50%)]', text: 'Contract expiring in 14 days' },
  { tone: 'bg-[hsl(142_70%_45%)]', text: 'SSR liquidity test passed' },
] as const

/** NotificationToasts — a small feed that cycles real-looking alerts on a loop. */
function NotificationToasts() {
  const [i, setI] = useState(0)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setI((p) => (p + 1) % ALERTS.length), 2600)
    return () => clearInterval(id)
  }, [reduce])

  const a = ALERTS[i % ALERTS.length]!

  return (
    <div className="mt-4 h-10 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: EASE_EXPO }}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${a.tone}`} />
          <span className="text-sm text-foreground">{a.text}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
