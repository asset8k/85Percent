'use client'

import { RequestAccessButton } from './RequestAccessButton'

const GAUGE_TO = 81
const GAUGE_R = 46
const GAUGE_C = 2 * Math.PI * GAUGE_R

/**
 * The landing hero intentionally stays compositing-light. The previous cinematic
 * SVG/GSAP sequence was visually impressive but used a large number of animated
 * filters, blend modes and 3D transforms, which made Safari and mobile browsers
 * unreliable. This version reveals once with CSS and then becomes fully static.
 */
export function Hero() {
  return (
    <section
      data-nav-theme="dark"
      className="hero-entrance relative isolate overflow-hidden bg-charcoal text-charcoal-foreground"
    >
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(150,165,205,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(150,165,205,0.04) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />
      <div className="hero-intro-overlay pointer-events-none absolute inset-0 z-20" aria-hidden />

      <div className="relative z-10 mx-auto grid min-h-[100svh] max-w-content grid-cols-1 items-center gap-16 px-6 py-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
        <div className="hero-copy-reveal flex flex-col items-start text-left">
          <span className="meta-label inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
            The Squad Cost Engine
          </span>

          <div className="hero-heading-mask mt-6">
            <h1 className="hero-heading-reveal text-balance font-display text-4xl font-semibold leading-[1.04] tracking-[-0.01em] text-gradient-hero sm:text-5xl lg:text-[3.9rem]">
              The definitive financial compliance platform for elite football clubs.
            </h1>
          </div>

          <p className="mt-6 max-w-md text-xl font-medium text-white/85">
            Win the transfer window. Within the rules.
          </p>

          <div className="mt-9 flex flex-col items-start gap-6">
            <RequestAccessButton variant="inverse" size="lg" source="hero" />
            <div className="flex items-stretch gap-3.5">
              <span aria-hidden className="w-px shrink-0 rounded-full bg-gradient-to-b from-transparent via-violet-soft/70 to-transparent" />
              <p className="font-display text-lg italic leading-snug text-white/75">
                Maximize your squad.{' '}
                <span className="text-gradient-violet font-semibold not-italic">Protect your points.</span>
              </p>
            </div>
          </div>
        </div>

        <div className="hero-dashboard relative w-full">
          <div className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-violet-core/15 blur-3xl" aria-hidden />
          <div className="relative z-10 grid grid-cols-2 gap-3.5">
            <section className="hero-panel col-span-2">
              <div className="flex items-center gap-5 p-5 sm:p-6">
                <div className="relative h-[104px] w-[104px] shrink-0">
                  <svg width="104" height="104" viewBox="0 0 104 104" aria-label="81 percent squad cost ratio">
                    <defs>
                      <linearGradient id="heroGauge" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#A78BFA" />
                        <stop offset="1" stopColor="#6D28D9" />
                      </linearGradient>
                    </defs>
                    <circle cx="52" cy="52" r={GAUGE_R} fill="none" stroke="rgba(168,180,214,0.13)" strokeWidth="7" />
                    <circle
                      cx="52"
                      cy="52"
                      r={GAUGE_R}
                      fill="none"
                      stroke="url(#heroGauge)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={GAUGE_C}
                      strokeDashoffset={GAUGE_C * (1 - GAUGE_TO / 100)}
                      transform="rotate(-90 52 52)"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center num text-2xl font-semibold">81<small className="text-sm text-violet-soft">%</small></span>
                </div>
                <div>
                  <p className="meta-label text-white/50">Squad Cost Ratio</p>
                  <h2 className="mt-1 text-base font-semibold text-white">Holding under the 85% cap</h2>
                  <p className="mt-1 text-sm leading-relaxed text-white/55">Projected to settle at 81% on deadline day, with four full points of headroom.</p>
                  <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 meta-label text-emerald-300"><i className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Within the rules</span>
                </div>
              </div>
            </section>

            <Metric label="Wages" value="62%" detail="Share of revenue" width="62%" />
            <Metric label="Amortisation" value="19%" detail="Transfer fees, 5-year basis" width="19%" />

            <section className="hero-panel col-span-2 p-5">
              <div className="flex items-center justify-between">
                <p className="meta-label text-white/50">Squad Cost Ratio · this window</p>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300"><i className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Live</span>
              </div>
              <svg className="mt-3 h-16 w-full" viewBox="0 0 400 62" preserveAspectRatio="none" aria-hidden>
                <path d="M0 48 L40 44 L92 47 L150 38 L210 40 L268 28 L330 31 L400 20 L400 62 L0 62 Z" fill="rgba(139,92,246,0.18)" />
                <path d="M0 48 L40 44 L92 47 L150 38 L210 40 L268 28 L330 31 L400 20" fill="none" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M0 14H400" fill="none" stroke="rgba(168,180,214,0.5)" strokeDasharray="4 4" />
              </svg>
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value, detail, width }: { label: string; value: string; detail: string; width: string }) {
  return (
    <section className="hero-panel p-5">
      <p className="meta-label text-white/50">{label}</p>
      <p className="mt-1 num text-2xl font-semibold text-white">{value}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><i className="block h-full rounded-full bg-gradient-to-r from-violet-core to-violet-mid" style={{ width }} /></div>
      <p className="mt-3 text-[11px] text-white/40">{detail}</p>
    </section>
  )
}
