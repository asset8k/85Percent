'use client'

import { Stagger } from './motion/Stagger'
import { HeroVisual } from './HeroVisual'
import { RequestAccessButton } from './RequestAccessButton'

/**
 * Hero — the signature entrance (spec §5.2). Charcoal band with a violet top-glow,
 * a staggered fade-up of eyebrow → headline → sub → CTA on the left, and the
 * compliance-gauge HeroVisual on the right. The sequence plays once on mount
 * (not scroll); reduced motion collapses it to opacity via MotionConfig.
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-charcoal text-charcoal-foreground">
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden />
      <div className="mx-auto grid min-h-screen max-w-content grid-cols-1 items-center gap-16 px-6 pb-20 pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:pt-24">
        {/* Copy */}
        <Stagger className="flex flex-col items-start text-left">
          <Stagger.Item>
            <span className="meta-label inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
              The Squad Cost Engine
            </span>
          </Stagger.Item>
          <Stagger.Item>
            <h1 className="mt-6 text-balance font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              The definitive financial compliance platform for elite football clubs.
            </h1>
          </Stagger.Item>
          <Stagger.Item>
            <p className="mt-6 max-w-md text-xl font-medium text-white/85">
              Win the transfer window. Within the rules.
            </p>
          </Stagger.Item>
          <Stagger.Item>
            <div className="mt-9 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <RequestAccessButton variant="inverse" size="lg" source="hero" />
              <span className="text-sm text-white/50">
                Maximize your squad. Protect your points.
              </span>
            </div>
          </Stagger.Item>
        </Stagger>

        {/* Visual */}
        <Stagger trigger="mount" className="w-full">
          <Stagger.Item>
            <HeroVisual />
          </Stagger.Item>
        </Stagger>
      </div>
    </section>
  )
}
