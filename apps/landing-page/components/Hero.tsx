'use client'

import { Stagger } from './motion/Stagger'
import { HeroVisual } from './HeroVisual'
import { RequestAccessButton } from './RequestAccessButton'
import { Aurora } from './atmosphere/Aurora'
import { Grain } from './atmosphere/Grain'
import { Spotlight } from './atmosphere/Spotlight'

/**
 * Hero — the signature entrance (spec §5.2). Charcoal band with a violet top-glow,
 * a staggered fade-up of eyebrow → headline → sub → CTA on the left, and the
 * compliance-gauge HeroVisual on the right. The sequence plays once on mount
 * (not scroll); reduced motion collapses it to opacity via MotionConfig.
 */
export function Hero() {
  return (
    <section data-nav-theme="dark" className="relative isolate overflow-hidden bg-charcoal text-charcoal-foreground">
      <Aurora />
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden />
      <Spotlight />
      <Grain />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-content grid-cols-1 items-center gap-16 px-6 pb-20 pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:pt-24">
        {/* Copy */}
        <Stagger className="flex flex-col items-start text-left">
          <Stagger.Item>
            <span className="meta-label inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
              The Squad Cost Engine
            </span>
          </Stagger.Item>
          <Stagger.Item>
            <h1 className="mt-6 text-balance font-display text-4xl font-semibold leading-[1.04] tracking-[-0.01em] text-gradient-hero text-shimmer sm:text-5xl lg:text-[3.9rem]">
              The definitive financial compliance platform for elite football clubs.
            </h1>
          </Stagger.Item>
          <Stagger.Item>
            <p className="mt-6 max-w-md text-xl font-medium text-white/85">
              Win the transfer window. Within the rules.
            </p>
          </Stagger.Item>
          <Stagger.Item>
            <div className="mt-9 flex flex-col items-start gap-6">
              <RequestAccessButton variant="inverse" size="lg" source="hero" pulse magnetic />
              <div className="flex items-stretch gap-3.5">
                <span
                  aria-hidden
                  className="w-px shrink-0 rounded-full bg-gradient-to-b from-transparent via-violet-soft/70 to-transparent"
                />
                <p className="font-display text-lg italic leading-snug text-white/75">
                  Maximize your squad.{' '}
                  <span className="text-gradient-violet font-semibold not-italic">
                    Protect your points.
                  </span>
                </p>
              </div>
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
