'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
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
 *   1. The Pitch  — a steeply-raked 3D tactical board crystallises from the centre:
 *                   mowing stripes, chrome markings, corner arcs and goals etch in
 *                   while a coaching formation of player markers twinkles like stars.
 *   2. The Pass   — a patterned soccer ball runs an erratic 3D dribble along a
 *                   MotionPath, the camera lifting to meet it as it rushes the screen.
 *   3. The Morph  — it bursts: light shards rake out, a shockwave rings, the pitch
 *                   folds away in 3D and the glass dashboard unfolds from depth, a
 *                   violet scan sweeping it into focus.
 *   4. The Reveal — the glowing gradient headline wipes open; copy and CTA fade up.
 *
 * Cold / shiny / precise: stark white highlights, deep charcoal, violet (#6D28D9)
 * only as a sharp laser accent. Strictly power4/expo easing — no linear, no bounce.
 * Reduced motion jumps the timeline straight to its end state. The section keeps
 * `data-nav-theme="dark"` so the Navbar's theme detection still reads it.
 */

// An erratic dribble across the raked pitch — sharp reversals, no smooth arc — that
// ends near centre so the camera-rush reads as the ball leaving the screen at you.
const ROUTE =
  'M 60 360 C 150 198, 190 392, 268 286 C 326 214, 372 348, 432 252 C 472 190, 392 250, 344 214'
const EASE = 'power4.inOut'
const GAUGE_TO = 81 // SCR %, under the 85% cap — the headroom story (62 wage + 19 amort)
const GAUGE_CAP = 85
const GAUGE_R = 46
const GAUGE_C = 2 * Math.PI * GAUGE_R
const PITCH_TILT = 58 // resting rake of the 3D board (deg), GSAP-managed
const PITCH_PERSP = 1080 // shorter perspective = more dramatic depth

// The 85% cap tick on the gauge ring, in the circle's pre-rotation coordinates
// (the <svg> is rotated -90°, so this lands on the ring at the 0.85 mark).
const capAngle = (GAUGE_CAP / 100) * 2 * Math.PI // from 3 o'clock, clockwise
const CAP_TICK = {
  x1: 52 + 40 * Math.cos(capAngle), y1: 52 + 40 * Math.sin(capAngle),
  x2: 52 + 53 * Math.cos(capAngle), y2: 52 + 53 * Math.sin(capAngle),
}

// ── Coaching formation: player markers (4-3-3 a side) that the manager would lay
//    on a tactical board. Each is a chrome/violet disc that catches a star sparkle.
type Team = 'h' | 'a'
const FORMATION: [number, number, Team][] = [
  // home (chrome) — attacking right
  [60, 220, 'h'], [150, 120, 'h'], [150, 320, 'h'], [245, 150, 'h'],
  [245, 290, 'h'], [310, 120, 'h'], [310, 320, 'h'],
  // away (violet) — mirrored
  [620, 220, 'a'], [530, 120, 'a'], [530, 320, 'a'], [435, 150, 'a'],
  [435, 290, 'a'], [370, 120, 'a'], [370, 320, 'a'],
]
// Shining stars scattered evenly across the whole pitch (separate from the player
// circles) — a staggered grid so the coverage reads even, not gridded.
const STAR_FIELD: [number, number][] = [
  [90, 85], [210, 85], [330, 85], [450, 85], [570, 85],
  [150, 165], [270, 165], [390, 165], [510, 165], [620, 165],
  [90, 250], [210, 250], [330, 250], [450, 250], [570, 250],
  [150, 335], [270, 335], [390, 335], [510, 335], [620, 335],
  [90, 405], [330, 405], [570, 405],
]
// A crisp 4-point star sparkle centred on (cx,cy).
function starPath(cx: number, cy: number, s: number): string {
  const i = s * 0.17
  return `M${cx},${cy - s} L${cx + i},${cy - i} L${cx + s},${cy} L${cx + i},${cy + i} ` +
    `L${cx},${cy + s} L${cx - i},${cy + i} L${cx - s},${cy} L${cx - i},${cy - i} Z`
}

// ── Soccer-ball pattern (classic Telstar) built in the ball's local space.
const R_BALL = 13
const F = R_BALL / 11 // scale the pattern with the ball radius
const deg = (a: number) => (a * Math.PI) / 180
function pentPts(cx: number, cy: number, r: number, rot: number): [number, number][] {
  return Array.from({ length: 5 }, (_, k) => {
    const a = deg(rot + k * 72 - 90)
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]
  })
}
const toPath = (p: [number, number][]) =>
  'M ' + p.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ') + ' Z'
const BALL_PENTS: string[] = (() => {
  const out = [toPath(pentPts(0, 0, 4.3 * F, 0))] // central pentagon
  for (const dir of [-54, 18, 90, 162, 234]) {
    const cx = 8.0 * F * Math.cos(deg(dir)), cy = 8.0 * F * Math.sin(deg(dir))
    out.push(toPath(pentPts(cx, cy, 3.0 * F, dir - 90))) // rim pentagons, vertex inward
  }
  return out
})()
const BALL_SEAMS: [number, number, number, number][] = pentPts(0, 0, 4.3 * F, 0).map(([x, y]) => {
  const a = Math.atan2(y, x)
  return [x, y, 10.6 * F * Math.cos(a), 10.6 * F * Math.sin(a)]
})
// 14 light shards raked from the point of impact during the morph.
const SHARDS = Array.from({ length: 14 }, (_, i) => i * (360 / 14) + (i % 2 ? 7 : -7))

// useLayoutEffect on the client (so GSAP's initial states + the reveal commit
// before the browser paints — no flash of the finished pitch), useEffect on the
// server (avoids React's SSR warning).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Per-document guard for the cinematic intro. This lives at module scope, so it
// resets on every full document load (a browser reload, a new tab, or the first
// navigation in — the intro plays) but persists across in-app soft remounts within
// the same JS context (clicking the logo to scroll back to the top must NOT replay
// it). It is recorded on a deferred tick (see the effect) so React StrictMode's
// throwaway first mount can't set it before the surviving mount gets to play.
let introHasPlayed = false

export function Hero() {
  const root = useRef<HTMLDivElement>(null)

  useIsoLayoutEffect(() => {
    const el = root.current
    if (!el) return
    gsap.registerPlugin(MotionPathPlugin)
    // Reduced motion, or an intro already played in this document (a logo-click soft
    // remount), both skip straight to the resolved end state rather than replaying.
    const skip = window.matchMedia('(prefers-reduced-motion: reduce)').matches || introHasPlayed

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el)

      // the raked board: GSAP owns the 3D transform from the start (so its later
      // camera-lift / fold tweens compose cleanly off a known matrix)
      gsap.set(q('.he-pitch-tilt'), { transformPerspective: PITCH_PERSP, rotationX: PITCH_TILT, transformOrigin: '50% 60%' })
      // the ball starts ON the trajectory (path origin), never at the SVG corner
      gsap.set(q('.he-ball'), { x: 60, y: 360 })

      const tl = gsap.timeline({ defaults: { ease: EASE } })

      /* ── ambient on ── */
      tl.fromTo(q('.he-bg-grid'), { opacity: 0 }, { opacity: 1, duration: 1.0, ease: 'power2.out' }, 0)
        .fromTo(q('.he-bg-glow'), { opacity: 0 }, { opacity: 1, duration: 1.3, ease: 'power2.out' }, 0)

      /* ── PHASE 1 — the pitch ignites at the centre and crystallises outward ── */
      tl.fromTo(q('.he-ignite'),
        { opacity: 0, scale: 0.12 },
        { opacity: 0.95, scale: 1, duration: 0.7, ease: 'power2.out' }, 0.15)
        .to(q('.he-ignite'), { opacity: 0, scale: 1.7, duration: 1.1, ease: 'power2.inOut' }, 0.8)

      // mowing stripes wash in under the markings (the richer pitch surface)
      tl.fromTo(q('.he-stripes'), { opacity: 0 }, { opacity: 1, duration: 1.0, ease: 'power2.out' }, 0.3)

      // chrome strokes draw on from the centre out, brightening as they lock in
      tl.fromTo(q('.he-pl'),
        { strokeDashoffset: (_i: number, t: SVGPathElement) => t.getTotalLength?.() ?? 420, opacity: 0.12 },
        { strokeDashoffset: 0, opacity: 1, duration: 1.3, ease: 'power3.inOut', stagger: { each: 0.04, from: 'center' } },
        0.3)
      tl.fromTo(q('.he-spot'), { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.05 }, 1.35)

      // the coaching formation lands, then the star field fades up across the pitch
      tl.fromTo(q('.he-marker-disc'),
        { opacity: 0, scale: 0 },
        { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)', stagger: { each: 0.04, from: 'random' } }, 0.7)
      tl.fromTo(q('.he-star'),
        { opacity: 0, scale: 0.4 },
        { opacity: 0.45, scale: 1, duration: 0.5, ease: 'power2.out', stagger: { each: 0.03, from: 'random' } }, 0.85)

      /* ── PHASE 2a — the patterned ball runs an erratic 3D dribble ── */
      tl.fromTo(q('.he-ball'),
        { opacity: 0, scale: 0.3 },
        { opacity: 1, scale: 1, duration: 0.35, ease: 'expo.out' }, 1.55)
      // NB: MotionPathPlugin reads a string `path` as a *selector*, not raw path
      // data — so we hand it the trail element. Ball and trail share the SVG space,
      // so we follow the path's ABSOLUTE coords (no `align`). Crucially, NO
      // `alignOrigin` either: that registers the ball by its *bounding-box* centre,
      // which shifts every frame as the asymmetric pattern spins — making the ball
      // wander off the line. All ball geometry is centred at local (0,0), so the
      // default origin registration lands its true centre exactly on the path.
      const trailEl = q('.he-trail')[0] as unknown as SVGPathElement
      tl.to(q('.he-ball'), {
        duration: 1.75, ease: 'power3.inOut', // ~17% slower than before
        motionPath: { path: trailEl, autoRotate: false },
      }, 1.7)
      // the ball rolls — its pattern spins as it travels
      tl.to(q('.he-ball-spin'), { rotation: 540, transformOrigin: 'center', duration: 1.75, ease: 'power1.inOut' }, 1.7)
      // the specular trail draws right behind it
      tl.fromTo(q('.he-trail'),
        { strokeDashoffset: (_i: number, t: SVGPathElement) => t.getTotalLength?.() ?? 800,
          strokeDasharray: (_i: number, t: SVGPathElement) => t.getTotalLength?.() ?? 800 },
        { strokeDashoffset: 0, duration: 1.75, ease: 'power3.inOut' }, 1.7)

      // the camera lifts to meet the ball — the board rakes up toward level so the
      // last strides of the dribble come straight at the viewer
      tl.to(q('.he-pitch-tilt'), { rotationX: 14, duration: 0.65, ease: 'power3.inOut' }, 3.0)

      /* ── PHASE 2b — the ball swells at the camera, then strikes the screen ── */
      // first it grows crisp — the soccer pattern reads big as it comes at you
      tl.to(q('.he-ball'), { scale: 7.5, duration: 0.45, ease: 'power2.in' }, 3.3)
      // then it whites out on impact, motion-blurring to a bloom
      tl.to(q('.he-ball'), {
        scale: 19, filter: 'blur(9px) drop-shadow(0 0 60px rgba(255,255,255,0.97))',
        duration: 0.42, ease: 'power3.in',
      }, 3.75)
        .to(q('.he-ball'), { opacity: 0, duration: 0.18, ease: 'power2.out' }, 4.0)
      tl.to(q('.he-trail'), { opacity: 0, duration: 0.45 }, 3.6)

      // impact: specular flash + raking shards + an expanding shockwave ring
      tl.fromTo(q('.he-flash'),
        { opacity: 0, scale: 0.4 },
        { opacity: 1, scale: 1.25, duration: 0.26, ease: 'expo.out' }, 3.95)
        .to(q('.he-flash'), { opacity: 0, scale: 1.7, duration: 0.75, ease: 'power3.out' }, 4.2)
      tl.fromTo(q('.he-shard'), { opacity: 0 }, { opacity: 1, duration: 0.12 }, 3.95)
      tl.fromTo(q('.he-shard b'),
        { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'power3.out', stagger: { each: 0.012, from: 'random' } }, 3.95)
        .to(q('.he-shard'), { opacity: 0, duration: 0.5, ease: 'power2.in' }, 4.25)
      tl.fromTo(q('.he-ring'),
        { opacity: 0, scale: 0.2 }, { opacity: 0.9, scale: 1, duration: 0.5, ease: 'expo.out' }, 3.97)
        .to(q('.he-ring'), { opacity: 0, scale: 1.7, duration: 0.7, ease: 'power3.out' }, 4.27)

      // the pitch folds away in 3D — rotating off-axis and receding into depth
      tl.to(q('.he-pitch-tilt'), {
        duration: 1.0, ease: EASE,
        opacity: 0, scale: 0.5, rotationY: 42, rotationX: -8, z: -320, xPercent: 14, yPercent: -4,
      }, 4.0)

      /* ── PHASE 2c — the glass dashboard unfolds from depth, holding a 3D rake ── */
      // the rack swings level to a resting tilt; panels rotate in from a receded stack
      tl.fromTo(q('.he-dash'),
        { rotationY: -18, rotationX: 8, y: 16 },
        { rotationY: -10, rotationX: 3, y: 0, duration: 1.2, ease: EASE }, 4.15)
      const panels = q('.he-panel')
      // NB: no blur() here — animating a filter on backdrop-filtered glass panels
      // thrashes the compositor and was a key source of the post-morph stutter.
      tl.fromTo(panels,
        { opacity: 0, z: -300, rotationY: -34, rotationX: 16, yPercent: 22 },
        { opacity: 1, z: 0, rotationY: 0, rotationX: 0, yPercent: 0, duration: 1.0, ease: 'power4.out', stagger: 0.12 },
        4.2)
      panels.forEach((p, i) => {
        const sp = p.querySelector('.he-spec')
        if (sp) tl.fromTo(sp, { x: '-130%' }, { x: '130%', duration: 0.9, ease: 'power2.inOut' }, 4.35 + i * 0.1)
      })
      // a violet scan sweeps down the rack as it resolves into focus
      tl.fromTo(q('.he-dash-scan'),
        { yPercent: -130, opacity: 0 }, { opacity: 1, duration: 0.2 }, 4.22)
      tl.to(q('.he-dash-scan'), { yPercent: 340, duration: 1.05, ease: 'power2.inOut' }, 4.22)
        .to(q('.he-dash-scan'), { opacity: 0, duration: 0.3 }, 5.0)

      /* gauge: arc sweep + count-up */
      const gp = { v: 0 }
      tl.to(gp, {
        v: GAUGE_TO, duration: 1.2, ease: 'power3.inOut',
        onUpdate: () => { const n = q('.he-gnum-val')[0]; if (n) n.textContent = String(Math.round(gp.v)) },
      }, 4.45)
      tl.fromTo(q('.he-gauge-arc'),
        { strokeDashoffset: GAUGE_C },
        { strokeDashoffset: GAUGE_C * (1 - GAUGE_TO / 100), duration: 1.2, ease: 'power3.inOut' }, 4.45)

      /* stat count-ups */
      q('.he-statval').forEach((node) => {
        const el2 = node as HTMLElement
        const to = parseFloat(el2.dataset.to || '0')
        const dec = parseInt(el2.dataset.dec || '0', 10)
        const o = { v: 0 }
        tl.fromTo(o, { v: 0 }, {
          v: to, duration: 1.0, ease: 'power2.out',
          onUpdate: () => { el2.textContent = o.v.toFixed(dec) },
        }, 4.6)
      })

      /* track fills + sparkline */
      tl.fromTo(q('.he-track-fill'),
        { width: 0 },
        { width: (_i: number, t: HTMLElement) => `${t.dataset.w}%`, duration: 1.0, ease: 'power3.inOut' }, 4.7)
      const ln = q('.he-ln')[0] as SVGPathElement | undefined
      if (ln?.getTotalLength) {
        const L = ln.getTotalLength()
        tl.fromTo(ln, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, 4.6)
        tl.fromTo(q('.he-area'), { opacity: 0 }, { opacity: 1, duration: 0.8 }, 5.05)
        tl.fromTo(q('.he-dot'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 5.45)
      }

      /* ── PHASE 3 — the glowing gradient headline wipes open, then copy & CTA ── */
      tl.fromTo(q('.he-kicker'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 4.05)
        .fromTo(q('.he-h1'), { clipPath: 'inset(0 100% 0 0)', y: 10 }, { clipPath: 'inset(0 0% 0 0)', y: 0, duration: 1.0, ease: EASE }, 4.35)
        .fromTo(q('.he-sub'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 5.2)
        .fromTo(q('.he-actions'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 5.4)

      // The infinite star twinkle is a 3D + mix-blend + drop-shadow layer repainting
      // every frame — once the ball strikes and the dashboard takes over it is pure
      // off-screen cost that janks the UI. Kill it the instant the morph begins, then
      // drop the whole pitch overlay from the compositor once the fold finishes.
      let twinkle: gsap.core.Tween | null = null
      tl.add(() => twinkle?.kill(), 3.9)
      tl.add(() => gsap.set(q('.he-pitch-layer'), { display: 'none' }), 5.05)

      if (skip) {
        tl.progress(1)
      } else {
        // the star field twinkles like a sky over the pitch while it's on screen
        twinkle = gsap.fromTo(q('.he-star'),
          { opacity: 0.45, scale: 0.85 },
          { opacity: 1, scale: 1.35, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true,
            stagger: { each: 0.13, from: 'random' }, delay: 1.3 })
      }
    }, el)

    // Reveal the pitch overlay now that GSAP has applied its initial (hidden) states.
    // Until this class lands, CSS keeps the layer at opacity:0 so the fully-drawn
    // pitch can never flash before the timeline takes over.
    el.classList.add('he-ready')

    // Record the play on a deferred tick. StrictMode mounts → cleans up → remounts
    // synchronously in dev; the throwaway first mount's cleanup cancels this timer
    // before it fires, so the flag is set only by the surviving mount — and the intro
    // still animates in dev. A later logo-click remount finds the flag and skips.
    let markTimer = 0
    if (!skip) markTimer = window.setTimeout(() => { introHasPlayed = true }, 0)

    return () => {
      clearTimeout(markTimer)
      ctx.revert()
      el.classList.remove('he-ready')
    }
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

        {/* ── Glass dashboard (unfolds from 3D after the morph, holds a resting rake) ── */}
        <div className="relative w-full" style={{ perspective: '1600px' }}>
          <div className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-violet-core/15 blur-3xl" aria-hidden />
          <div className="he-dash relative">
            {/* A — compliance gauge (cap-forward) */}
            <TiltCard className="he-cell-full" max={6}>
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
                    <p>Projected to settle at 81% on deadline day, with +4 full points of headroom still in hand.</p>
                    <div className="he-pill-row">
                      <span className="he-pill meta-label"><i className="he-led" /> Within the rules</span>
                    </div>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* B — wages share */}
            <TiltCard max={7}>
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
            <TiltCard max={7}>
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
            <TiltCard className="he-cell-full" max={6}>
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
          {/* violet scan that rakes the dashboard into focus during the morph */}
          <div className="he-dash-scan" aria-hidden />
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
              <radialGradient id="heBall" cx="0.36" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#FFFFFF" /><stop offset="0.42" stopColor="#EEF2FB" />
                <stop offset="0.8" stopColor="#C2CBE0" /><stop offset="1" stopColor="#8D97B3" />
              </radialGradient>
              <radialGradient id="heGlintGrad" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#FFFFFF" /><stop offset="0.5" stopColor="#D8C8FF" /><stop offset="1" stopColor="rgba(216,200,255,0)" />
              </radialGradient>
              <clipPath id="heBallClip"><circle r={R_BALL} /></clipPath>
            </defs>

            {/* mowing stripes — the richer pitch surface (alternating cold bands) */}
            <g className="he-stripes">
              {Array.from({ length: 8 }).map((_, i) => (
                <rect key={i} x={20 + i * 80} y={20} width={80} height={400}
                  fill={i % 2 ? 'rgba(150,170,220,0.055)' : 'rgba(120,140,190,0.02)'} />
              ))}
            </g>

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
            {/* corner arcs */}
            <path className="he-pl" d="M20 32 A12 12 0 0 0 32 20" />
            <path className="he-pl" d="M648 20 A12 12 0 0 0 660 32" />
            <path className="he-pl" d="M32 420 A12 12 0 0 0 20 408" />
            <path className="he-pl" d="M660 408 A12 12 0 0 0 648 420" />
            {/* goals */}
            <rect className="he-pl" x="10" y="186" width="10" height="68" />
            <rect className="he-pl" x="660" y="186" width="10" height="68" />
            <circle className="he-spot" cx="340" cy="220" r="3.4" />
            <circle className="he-spot" cx="92" cy="220" r="3" />
            <circle className="he-spot" cx="588" cy="220" r="3" />

            {/* coaching formation — player marker circles */}
            <g className="he-markers">
              {FORMATION.map(([x, y, team], i) => (
                <g key={i} className="he-marker" data-team={team} transform={`translate(${x} ${y})`}>
                  <circle className="he-marker-disc" cx={0} cy={0} r={5.4} />
                </g>
              ))}
            </g>

            {/* shining stars spread evenly over the pitch (outside the circles).
                Each is translated, with the path at local (0,0), so GSAP scales it
                about its own centre — never drifting toward the SVG origin. */}
            <g className="he-stars">
              {STAR_FIELD.map(([x, y], i) => (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <path className="he-star" d={starPath(0, 0, 4.6)} />
                </g>
              ))}
            </g>

            {/* the chrome pass */}
            <path className="he-trail" d={ROUTE} />
            <g className="he-ball">
              <circle className="he-ball-base" r={R_BALL} fill="url(#heBall)" />
              {/* static clip wrapper keeps the pattern inside the ball; the inner
                  group is the one GSAP spins (so rotation can't drag the clip) */}
              <g clipPath="url(#heBallClip)">
                <g className="he-ball-spin">
                  {BALL_PENTS.map((d, i) => <path key={i} className="he-ball-pent" d={d} />)}
                  {BALL_SEAMS.map(([x1, y1, x2, y2], i) => (
                    <line key={i} className="he-ball-seam" x1={x1} y1={y1} x2={x2} y2={y2} />
                  ))}
                </g>
              </g>
              <circle className="he-ball-rim" r={R_BALL} fill="none" />
              <ellipse className="he-ball-spec" cx={-3.6 * F} cy={-4 * F} rx={3.4 * F} ry={2.3 * F} />
            </g>
          </svg>
        </div>
        {/* impact FX — face the camera (flat, screen-blended) */}
        <div className="he-ring" />
        <div className="he-shards">
          {SHARDS.map((d, i) => (
            <i key={i} className="he-shard" style={{ transform: `rotate(${d}deg)` }}>
              <b style={{ width: `${150 + (i % 5) * 22}px` }} />
            </i>
          ))}
        </div>
        <div className="he-flash" />
      </div>
    </section>
  )
}
