'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { RequestAccessButton } from './RequestAccessButton'
import { TiltCard } from './TiltCard'
import { Aurora } from './atmosphere/Aurora'
import { Grain } from './atmosphere/Grain'
import { Spotlight } from './atmosphere/Spotlight'

/**
 * Hero — the cinematic entrance (spec §5.2), rebuilt as a single GSAP-orchestrated
 * sequence on the charcoal band:
 *
 *   1. The Pitch  — top-down pitch geometry etched in by a clinical icy light sweep,
 *                   chrome strokes drawing on under a heavy power-ease.
 *   2. The Pass   — a chrome football enters and runs a tactical MotionPath across
 *                   the pitch, drawing a fading specular trail behind it.
 *   3. The Morph  — it reaches its target, flashes, and the pitch folds away in 3D
 *                   as the glassmorphism dashboard unfolds from depth in its place.
 *   4. The Reveal — the glowing gradient headline wipes open; copy and CTA fade up.
 *
 * Cold / shiny / precise: stark white highlights, deep charcoal, violet (#6D28D9)
 * only as a sharp laser accent. Strictly power4/expo easing — no linear, no bounce.
 * Reduced motion jumps the timeline straight to its end state. The section keeps
 * `data-nav-theme="dark"` so the Navbar's theme detection still reads it.
 */

// An erratic dribble across the pitch — several sharp reversals, no smooth arc,
// so the run reads as unpredictable before the ball rushes the camera.
const ROUTE =
  'M 54 384 C 134 196, 168 402, 250 286 C 300 212, 330 366, 398 252 C 446 170, 470 318, 540 236 C 576 196, 596 214, 624 196'
const EASE = 'power4.inOut'
const GAUGE_TO = 81 // SCR %, under the 85% cap — the headroom story (62 wage + 19 amort)
const GAUGE_CAP = 85
const GAUGE_R = 46
const GAUGE_C = 2 * Math.PI * GAUGE_R

// Specular sparkles scattered across the pitch markings — they flick on as the
// lines crystallise, then settle to a slow shimmer (the "shiny pitch").
const GLINTS: [number, number][] = [
  [20, 20], [660, 20], [20, 420], [660, 420], [340, 20], [340, 420],
  [340, 220], [92, 220], [588, 220], [130, 120], [130, 320], [550, 120],
  [550, 320], [340, 162], [340, 278], [20, 120], [660, 320], [398, 162],
]

// The 85% cap tick on the gauge ring, in the circle's pre-rotation coordinates
// (the <svg> is rotated -90°, so this lands on the ring at the 0.85 mark).
const capAngle = (GAUGE_CAP / 100) * 2 * Math.PI // from 3 o'clock, clockwise
const CAP_TICK = {
  x1: 52 + 40 * Math.cos(capAngle), y1: 52 + 40 * Math.sin(capAngle),
  x2: 52 + 53 * Math.cos(capAngle), y2: 52 + 53 * Math.sin(capAngle),
}

export function Hero() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    gsap.registerPlugin(MotionPathPlugin)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el)
      const tl = gsap.timeline({ defaults: { ease: EASE } })

      /* ── ambient on ── */
      tl.fromTo(q('.he-bg-grid'), { opacity: 0 }, { opacity: 1, duration: 1.0, ease: 'power2.out' }, 0)
        .fromTo(q('.he-bg-glow'), { opacity: 0 }, { opacity: 1, duration: 1.3, ease: 'power2.out' }, 0)

      /* ── PHASE 1 — the pitch ignites at the centre and crystallises outward ── */
      // a cold light blooms from the centre spot (replacing the old flat sweep)
      tl.fromTo(q('.he-ignite'),
        { opacity: 0, scale: 0.12 },
        { opacity: 0.95, scale: 1, duration: 0.7, ease: 'power2.out' }, 0.15)
        .to(q('.he-ignite'), { opacity: 0, scale: 1.7, duration: 1.1, ease: 'power2.inOut' }, 0.8)

      // chrome strokes draw on from the centre out, brightening as they lock in
      tl.fromTo(q('.he-pl'),
        { strokeDashoffset: (_i: number, t: SVGPathElement) => t.getTotalLength?.() ?? 420, opacity: 0.15 },
        { strokeDashoffset: 0, opacity: 1, duration: 1.3, ease: 'power3.inOut', stagger: { each: 0.05, from: 'center' } },
        0.3)
      tl.fromTo(q('.he-spot'), { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.05 }, 1.35)

      // specular sparkles flick on across the markings, then settle to a shimmer
      tl.fromTo(q('.he-glint'),
        { opacity: 0, scale: 0 },
        { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out', stagger: { each: 0.05, from: 'random' } }, 0.7)
        .to(q('.he-glint'),
          { opacity: 0.3, duration: 0.9, ease: 'sine.inOut', stagger: { each: 0.04, from: 'random' }, yoyo: true, repeat: 1 }, 1.5)

      /* ── PHASE 2a — the chrome pass along a tactical MotionPath ── */
      tl.fromTo(q('.he-ball'),
        { opacity: 0, scale: 0.3 },
        { opacity: 1, scale: 1, duration: 0.35, ease: 'expo.out' }, 1.55)
      // Follow the trail <path> (same SVG coordinate space as the ball <g>).
      // NB: MotionPathPlugin reads a string `path` as a *selector*, not raw path
      // data — so we hand it the element, never the `d` string.
      const trailEl = q('.he-trail')[0] as unknown as SVGPathElement
      tl.to(q('.he-ball'), {
        duration: 1.5, ease: 'power3.inOut',
        motionPath: { path: trailEl, align: trailEl, alignOrigin: [0.5, 0.5], autoRotate: false },
      }, 1.7)
      // the specular trail draws right behind the ball
      tl.fromTo(q('.he-trail'),
        { strokeDashoffset: (_i: number, t: SVGPathElement) => t.getTotalLength?.() ?? 800,
          strokeDasharray: (_i: number, t: SVGPathElement) => t.getTotalLength?.() ?? 800 },
        { strokeDashoffset: 0, duration: 1.5, ease: 'power3.inOut' }, 1.7)

      /* ── PHASE 2b — the ball rushes the camera and bursts into the dashboard ── */
      // it leaves the tactical path and accelerates straight at the viewer: scaling
      // up hard with motion blur, brightening to white — like it leaves the screen.
      tl.to(q('.he-ball'), {
        scale: 12, filter: 'blur(7px) drop-shadow(0 0 42px rgba(255,255,255,0.95))',
        duration: 0.5, ease: 'power3.in',
      }, 2.82)
        .to(q('.he-ball'), { opacity: 0, duration: 0.16, ease: 'power2.out' }, 3.16)
      tl.to(q('.he-trail'), { opacity: 0, duration: 0.45 }, 3.02)

      // the specular flash at the point of impact
      tl.fromTo(q('.he-flash'),
        { opacity: 0, scale: 0.4 },
        { opacity: 1, scale: 1.2, duration: 0.26, ease: 'expo.out' }, 3.04)
        .to(q('.he-flash'), { opacity: 0, scale: 1.65, duration: 0.7, ease: 'power3.out' }, 3.3)

      // the pitch folds away in 3D — rotating off-axis and receding into depth
      tl.to(q('.he-pitch-tilt'), {
        duration: 1.0, ease: EASE,
        opacity: 0, scale: 0.5, rotationY: 42, rotationX: -8, z: -320, xPercent: 14, yPercent: -4,
      }, 3.0)

      // the dashboard unfolds from depth: the rack swings level while each panel
      // rotates in from a tilted, receded stack (shared vanishing point via the
      // wrapper's `perspective`).
      tl.fromTo(q('.he-dash'),
        { rotationY: -16, y: 14 },
        { rotationY: 0, y: 0, duration: 1.15, ease: EASE }, 3.25)
      const panels = q('.he-panel')
      tl.fromTo(panels,
        { opacity: 0, z: -300, rotationY: -34, rotationX: 16, yPercent: 22, filter: 'blur(8px)' },
        { opacity: 1, z: 0, rotationY: 0, rotationX: 0, yPercent: 0, filter: 'blur(0px)', duration: 1.0, ease: 'power4.out', stagger: 0.12 },
        3.3)
      panels.forEach((p, i) => {
        const sp = p.querySelector('.he-spec')
        if (sp) tl.fromTo(sp, { x: '-130%' }, { x: '130%', duration: 0.9, ease: 'power2.inOut' }, 3.44 + i * 0.1)
      })

      /* gauge: arc sweep + count-up */
      const gp = { v: 0 }
      tl.to(gp, {
        v: GAUGE_TO, duration: 1.2, ease: 'power3.inOut',
        onUpdate: () => { const n = q('.he-gnum-val')[0]; if (n) n.textContent = String(Math.round(gp.v)) },
      }, 3.55)
      tl.fromTo(q('.he-gauge-arc'),
        { strokeDashoffset: GAUGE_C },
        { strokeDashoffset: GAUGE_C * (1 - GAUGE_TO / 100), duration: 1.2, ease: 'power3.inOut' }, 3.55)

      /* stat count-ups */
      q('.he-statval').forEach((node) => {
        const el2 = node as HTMLElement
        const to = parseFloat(el2.dataset.to || '0')
        const dec = parseInt(el2.dataset.dec || '0', 10)
        const o = { v: 0 }
        tl.fromTo(o, { v: 0 }, {
          v: to, duration: 1.0, ease: 'power2.out',
          onUpdate: () => { el2.textContent = o.v.toFixed(dec) },
        }, 3.7)
      })

      /* track fills + sparkline */
      tl.fromTo(q('.he-track-fill'),
        { width: 0 },
        { width: (_i: number, t: HTMLElement) => `${t.dataset.w}%`, duration: 1.0, ease: 'power3.inOut' }, 3.8)
      const ln = q('.he-ln')[0] as SVGPathElement | undefined
      if (ln?.getTotalLength) {
        const L = ln.getTotalLength()
        tl.fromTo(ln, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, 3.7)
        tl.fromTo(q('.he-area'), { opacity: 0 }, { opacity: 1, duration: 0.8 }, 4.15)
        tl.fromTo(q('.he-dot'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 4.55)
      }

      /* ── PHASE 3 — the glowing gradient headline wipes open, then copy & CTA ── */
      tl.fromTo(q('.he-kicker'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 3.15)
        .fromTo(q('.he-h1'), { clipPath: 'inset(0 100% 0 0)', y: 10 }, { clipPath: 'inset(0 0% 0 0)', y: 0, duration: 1.0, ease: EASE }, 3.45)
        .fromTo(q('.he-sub'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 4.3)
        .fromTo(q('.he-actions'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 4.5)

      if (reduce) tl.progress(1)
    }, el)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={root} data-nav-theme="dark" className="hero-entrance relative isolate overflow-hidden bg-charcoal text-charcoal-foreground">
      <Aurora />
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden />
      <Spotlight />
      <Grain />

      {/* full-bleed cold ambient layers (driven by the timeline) — these span the
          whole hero band, not just the centred content column */}
      <div
        className="he-bg-grid pointer-events-none absolute inset-0 z-0 opacity-0"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(150,165,205,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(150,165,205,0.05) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          WebkitMaskImage: 'radial-gradient(150% 130% at 50% 38%, #000 72%, transparent 100%)',
          maskImage: 'radial-gradient(150% 130% at 50% 38%, #000 72%, transparent 100%)',
        }}
      />
      <div
        className="he-bg-glow pointer-events-none absolute inset-0 z-0 opacity-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(40% 50% at 78% 16%, rgba(109,40,217,0.20), transparent 70%), radial-gradient(50% 60% at 14% 96%, rgba(80,40,170,0.14), transparent 70%)',
        }}
      />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-content grid-cols-1 items-center gap-16 px-6 pb-20 pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:pt-24">

        {/* ── Copy ── */}
        <div className="flex flex-col items-start text-left">
          <span className="he-kicker meta-label inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
            The Squad Cost Engine
          </span>

          <h1 className="he-h1 mt-6 text-balance font-display text-4xl font-semibold leading-[1.04] tracking-[-0.01em] text-gradient-hero text-shimmer sm:text-5xl lg:text-[3.9rem]">
            The definitive financial compliance platform for elite football clubs.
          </h1>

          <p className="he-sub mt-6 max-w-md text-xl font-medium text-white/85">
            Win the transfer window. Within the rules.
          </p>

          <div className="he-actions mt-9 flex flex-col items-start gap-6">
            <RequestAccessButton variant="inverse" size="lg" source="hero" pulse magnetic />
            <div className="flex items-stretch gap-3.5">
              <span aria-hidden className="w-px shrink-0 rounded-full bg-gradient-to-b from-transparent via-violet-soft/70 to-transparent" />
              <p className="font-display text-lg italic leading-snug text-white/75">
                Maximize your squad.{' '}
                <span className="text-gradient-violet font-semibold not-italic">Protect your points.</span>
              </p>
            </div>
          </div>
        </div>

        {/* ── Glass dashboard (unfolds from 3D after the morph) ── */}
        <div className="relative w-full" style={{ perspective: '1600px' }}>
          <div className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-violet-core/15 blur-3xl" aria-hidden />
          <div className="he-dash relative">
            {/* A — compliance gauge (cap-forward) */}
            <TiltCard className="he-cell-full" max={5}>
              <div className="he-panel he-pa">
                <span className="he-spec" />
                <div className="he-inner">
                  <div className="he-gauge">
                    <svg width="104" height="104" viewBox="0 0 104 104">
                      <defs>
                        <linearGradient id="heGaugeGrad" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stopColor="#A78BFA" />
                          <stop offset="0.6" stopColor="#8B5CF6" />
                          <stop offset="1" stopColor="#6D28D9" />
                        </linearGradient>
                      </defs>
                      <circle cx="52" cy="52" r={GAUGE_R} fill="none" stroke="rgba(168,180,214,0.13)" strokeWidth="7" />
                      <circle
                        className="he-gauge-arc"
                        cx="52" cy="52" r={GAUGE_R} fill="none"
                        stroke="url(#heGaugeGrad)" strokeWidth="7" strokeLinecap="round"
                        strokeDasharray={GAUGE_C} strokeDashoffset={GAUGE_C}
                        style={{ filter: 'drop-shadow(0 0 6px rgba(139,92,246,0.55))' }}
                      />
                      {/* the 85% cap tick — the line the ratio must stay under */}
                      <line
                        className="he-cap-tick"
                        x1={CAP_TICK.x1} y1={CAP_TICK.y1} x2={CAP_TICK.x2} y2={CAP_TICK.y2}
                      />
                    </svg>
                    <div className="he-gnum num"><span className="he-gnum-val">0</span><small>%</small></div>
                  </div>
                  <div className="he-gmeta">
                    <p className="he-plabel meta-label">Squad Cost Ratio</p>
                    <h3>Holding under the <span className="he-cap-em">85% cap</span></h3>
                    <p>Projected 81% at deadline day, with +4 pts of headroom in hand.</p>
                    <div className="he-pill-row">
                      <span className="he-pill meta-label"><i className="he-led" /> Within the rules</span>
                      <span className="he-cap-chip meta-label">Cap 85%</span>
                    </div>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* B — wages share */}
            <TiltCard max={6}>
              <div className="he-panel he-pb">
                <span className="he-spec" />
                <div className="he-inner">
                  <p className="he-plabel meta-label">Wages</p>
                  <div className="he-pstat">
                    <span className="he-v num"><span className="he-statval" data-to="62" data-dec="0">0</span>%</span>
                  </div>
                  <div className="he-track"><i className="he-track-fill" data-w="62" /></div>
                  <p className="meta-label mt-2.5 text-white/40">Share of revenue</p>
                </div>
              </div>
            </TiltCard>

            {/* C — amortisation share */}
            <TiltCard max={6}>
              <div className="he-panel he-pc">
                <span className="he-spec" />
                <div className="he-inner">
                  <p className="he-plabel meta-label">Amortisation</p>
                  <div className="he-pstat">
                    <span className="he-v num"><span className="he-statval" data-to="19" data-dec="0">0</span>%</span>
                  </div>
                  <div className="he-track"><i className="he-track-fill" data-w="19" /></div>
                  <p className="meta-label mt-2.5 text-white/40">Transfer fees, 5-yr basis</p>
                </div>
              </div>
            </TiltCard>

            {/* D — SCR trajectory across the window, under the 85% cap */}
            <TiltCard className="he-cell-full" max={5}>
              <div className="he-panel he-pd">
                <span className="he-spec" />
                <div className="he-inner">
                  <div className="he-sparkhead">
                    <p className="he-plabel meta-label">Squad Cost Ratio · this window</p>
                    <span className="he-pill meta-label"><i className="he-led" /> Live</span>
                  </div>
                  <div className="he-spark-wrap">
                    <span className="he-cap-label meta-label">85% cap</span>
                    <svg className="he-spark" viewBox="0 0 400 62" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="heSparkStroke" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0" stopColor="#6D28D9" /><stop offset="1" stopColor="#A78BFA" />
                        </linearGradient>
                        <linearGradient id="heSparkFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="rgba(139,92,246,0.32)" /><stop offset="1" stopColor="rgba(139,92,246,0)" />
                        </linearGradient>
                      </defs>
                      <g className="he-grid">
                        <line x1="0" y1="16" x2="400" y2="16" /><line x1="0" y1="34" x2="400" y2="34" /><line x1="0" y1="52" x2="400" y2="52" />
                      </g>
                      <line className="he-cap" x1="0" y1="14" x2="400" y2="14" />
                      <path className="he-area" d="M0 48 L40 44 L92 47 L150 38 L210 40 L268 28 L330 31 L400 20 L400 62 L0 62 Z" />
                      <path className="he-ln" d="M0 48 L40 44 L92 47 L150 38 L210 40 L268 28 L330 31 L400 20" />
                      <circle className="he-dot" cx="400" cy="20" r="3.6" />
                    </svg>
                  </div>
                </div>
              </div>
            </TiltCard>
          </div>
        </div>
      </div>

      {/* ── Pitch + chrome pass overlay (phases 1–2, folds away on morph) ── */}
      <div className="he-pitch-layer" aria-hidden>
        {/* cold light blooms from the centre spot and crystallises the lines */}
        <div className="he-ignite" />
        <div className="he-pitch-tilt">
          <svg className="he-pitch" viewBox="0 0 680 440">
            <defs>
              <linearGradient id="heChrome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFFFFF" /><stop offset="0.45" stopColor="#D6DEF2" /><stop offset="1" stopColor="#7E8BAC" />
              </linearGradient>
              <linearGradient id="heTrail" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="rgba(201,184,255,0)" /><stop offset="0.6" stopColor="rgba(201,184,255,0.85)" /><stop offset="1" stopColor="#FFFFFF" />
              </linearGradient>
              <radialGradient id="heBall" cx="0.35" cy="0.3" r="0.75">
                <stop offset="0" stopColor="#FFFFFF" /><stop offset="0.32" stopColor="#EAF0FC" />
                <stop offset="0.7" stopColor="#A8B4D0" /><stop offset="1" stopColor="#3C476680" />
              </radialGradient>
              <radialGradient id="heGlintGrad" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#FFFFFF" /><stop offset="0.5" stopColor="#D8C8FF" /><stop offset="1" stopColor="rgba(216,200,255,0)" />
              </radialGradient>
            </defs>

            {/* boundary + markings */}
            <rect className="he-pl" x="20" y="20" width="640" height="400" rx="2" />
            <line className="he-pl" x1="340" y1="20" x2="340" y2="420" />
            <circle className="he-pl" cx="340" cy="220" r="58" />
            <rect className="he-pl" x="20" y="120" width="110" height="200" />
            <rect className="he-pl" x="20" y="180" width="42" height="80" />
            <path className="he-pl" d="M130 176.2 A58 58 0 0 1 130 263.8" />
            <rect className="he-pl" x="550" y="120" width="110" height="200" />
            <rect className="he-pl" x="618" y="180" width="42" height="80" />
            <path className="he-pl" d="M550 176.2 A58 58 0 0 0 550 263.8" />
            <circle className="he-spot" cx="340" cy="220" r="3.4" />
            <circle className="he-spot" cx="92" cy="220" r="3" />
            <circle className="he-spot" cx="588" cy="220" r="3" />

            {/* specular sparkles across the markings — the "shiny pitch" */}
            <g className="he-glints">
              {GLINTS.map(([cx, cy], i) => (
                <circle key={i} className="he-glint" cx={cx} cy={cy} r="4.5" fill="url(#heGlintGrad)" />
              ))}
            </g>

            {/* the chrome pass */}
            <path className="he-trail" d={ROUTE} />
            <g className="he-ball">
              <circle r="9" fill="url(#heBall)" />
              <circle r="3" cx="-2.6" cy="-2.8" fill="rgba(255,255,255,0.95)" />
            </g>
          </svg>
        </div>
        <div className="he-flash" />
      </div>
    </section>
  )
}
