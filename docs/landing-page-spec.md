# 85Percent — Landing Page Specification

> **The Squad Cost Engine.** Public marketing site for CFOs and Sporting Directors of
> elite football clubs. This document is the architectural plan. **No production code is
> written yet** — it defines the stack, component tree, design tokens, and the carousel +
> animation systems so implementation is mechanical once approved.

---

## 0. Reconciliation: brief vs. real monorepo

The brief assumes a layout (`/landing-page`, `/main-app`, `/admin-panel`, `/shared`) and a
shared UI library that do **not** exist in this repository. The actual structure is:

| Brief term      | Reality in this repo                                                        |
| --------------- | -------------------------------------------------------------------------- |
| `/landing-page` | **new** → `apps/landing-page` (this spec lives here)                             |
| `/main-app`     | `apps/web` — Vite + React 18.3 + Tailwind 3.4 + framer-motion 12 + RR7      |
| `/admin-panel`  | `apps/admin`                                                                |
| `/shared`       | `packages/shared` — **pure logic only** (zod, money, types). No React/UI.   |
| "the 85% Logo"  | `apps/web/src/components/ui/{Mark85,Wordmark}.tsx` + `design/Logo/mark85.js`|

Tooling: **pnpm 11 workspaces + Turborepo**, `pnpm-workspace.yaml` globs `apps/*` and
`packages/*`. Workspace scope is `@85percent/*` (internal; unrelated to the 85Percent brand).

**Two architectural decisions this spec makes (overridable):**

1. **Framework → Next.js 14 (App Router).** See §2.1 for rationale vs. staying on Vite.
2. **Logo sharing → promote the mark to a new `packages/brand` package** consumed by *both*
   `apps/web` and `apps/landing-page`, instead of copy-pasting. See §6. This honours the brief's
   "import shared assets from /shared, don't bleed code" intent within the real monorepo.

---

## 1. Design north star

Institutional trust × pristine financial infrastructure × modern sports tech —
**"Stripe meets high-end football analytics."** Motion is **heavy, precise, expensive**:
slow easings, generous distances, zero bounce/overshoot. The violet is used as a
**"violet-tip" accent** (gradient highlights, focus, the mark), never as flat fill spam.

**Theme decision: light-mode primary, deep-charcoal hero band.** A predominantly white /
slate-50 page reads as audited, regulated, trustworthy (the target persona's instinct);
a single **charcoal hero section** with a violet-core glow delivers the "premium tech"
moment without committing the whole site to dark mode. (Full dark-mode is a later toggle —
the token system in §4 is authored to support it from day one.)

---

## 2. Tech stack

### 2.1 Framework decision — Next.js 14 (App Router)

| Criterion             | Next.js 14 (chosen)                                  | Vite SPA (the app's stack)            |
| --------------------- | ---------------------------------------------------- | ------------------------------------- |
| SEO / OG / meta       | ✅ first-class metadata API, per-route OG images     | ⚠️ needs prerender plugin + hacks     |
| First paint for cold  | ✅ SSG → HTML on the wire, instant LCP                | ⚠️ JS-then-render                     |
| Public marketing fit  | ✅ industry standard (the "Stripe" baseline)         | built for authed app shells           |
| Image optimisation    | ✅ `next/image` (AVIF/WebP, responsive)              | manual                                |
| Monorepo cost         | Turbo already orchestrates per-app builds — additive | zero new framework                    |

A public B2B marketing page lives or dies on **SEO, OG link previews (LinkedIn/WhatsApp
outreach is in the brief), and cold-load LCP** — all Next.js strengths. The app stays Vite;
the two coexist cleanly under Turbo. **If the team prefers a single build system**, the
fallback is Vite + `vite-plugin-ssg` — the component tree, tokens, and animation specs below
are framework-agnostic and port unchanged.

### 2.2 Full stack

- **Next.js 14** (App Router, React Server Components where static; `'use client'` only for
  interactive islands — carousel, mobile nav, scroll/hover motion).
- **TypeScript 5.8** (matches repo `tsconfig.base.json`).
- **Tailwind CSS 3.4** — same major as `apps/web`, so the token system transfers 1:1.
- **framer-motion 12.40** — same version as `apps/web`; the heavy-easing motion language.
- **Inter** (body/UI) + **Space Grotesk** (display headlines + the "Percent" wordmark) via
  `next/font` (self-hosted, no layout shift, no external request).
- **lucide-react** — icon set already used app-side, keeps iconography consistent.
- **@85percent/brand** (new shared package, §6) — `Mark85`, `Wordmark`, design tokens.
- **@supabase/supabase-js** — lead capture only. The landing page talks to the **existing
  Supabase project** with the **anon key**, scoped to a single INSERT-only table
  (`demo_requests`). It carries **no service-role key and has no read access to any core
  table** — see §5b.
- No CMS for v1 — copy is colocated in `content/` TS modules (typed, reviewable in PRs).

---

## 3. Directory structure (`apps/landing-page`)

```
apps/landing-page/
├─ landing-page-spec.md          ← this document
├─ next.config.mjs
├─ tailwind.config.ts            ← §4 tokens
├─ postcss.config.js
├─ tsconfig.json                 ← extends ../../tsconfig.base.json
├─ package.json                  ← name: @85percent/landing-page
├─ app/
│  ├─ layout.tsx                 ← fonts, <html lang>, metadata, JSON-LD
│  ├─ page.tsx                   ← composes the sections (RSC)
│  ├─ globals.css                ← @tailwind + CSS-var tokens (mirrors web)
│  ├─ opengraph-image.tsx        ← dynamic OG card (mark + headline)
│  ├─ api/
│  │  └─ demo-request/route.ts   ← POST handler: validate → anon-insert into demo_requests (§5b)
│  ├─ terms/page.tsx
│  ├─ privacy/page.tsx
│  └─ ssr-disclaimer/page.tsx
├─ components/
│  ├─ Navbar.tsx                 ← 'use client' (scroll state + mobile menu)
│  ├─ Hero.tsx                   ← 'use client' (staggered reveal)
│  ├─ HeroVisual.tsx             ← abstract dashboard/pitch-geometry SVG + motion
│  ├─ ProblemSolution.tsx        ← scroll-triggered fade-ins
│  ├─ CapabilitiesCarousel.tsx   ← 'use client' (§5)
│  ├─ CapabilityCard.tsx
│  ├─ Footer.tsx
│  ├─ RequestAccessButton.tsx    ← shared CTA → opens DemoRequestDialog
│  ├─ DemoRequestDialog.tsx      ← 'use client' (lead form modal, posts to /api/demo-request)
│  └─ motion/
│     ├─ Reveal.tsx              ← scroll-triggered wrapper (whileInView)
│     ├─ Stagger.tsx             ← parent orchestrator + item variants
│     └─ variants.ts             ← the single source of motion truth (§7)
├─ lib/
│  ├─ supabase.ts                ← anon client factory (anon key only; server-side, §5b)
│  └─ demoRequest.ts             ← zod schema + insert helper (shared by route + form types)
├─ content/
│  ├─ capabilities.ts            ← the 3 pillars (typed)
│  ├─ nav.ts
│  └─ site.ts                    ← contact, legal, social, copy strings
└─ public/
   └─ og/ (static fallbacks)
```

**Strict isolation:** all landing work stays in `apps/landing-page`. The only cross-package import
is `@85percent/brand`. Nothing is written into `apps/web`, `apps/api`, or `apps/admin`.

---

## 4. Design tokens → `tailwind.config.ts`

Authored as **HSL CSS variables** to match `apps/web/src/index.css` exactly (so the brand is
bit-identical across app and site, and a dark-mode toggle is a variable swap). Pulled from the
real app: `--primary: 263 70% 50%` (violet-600), gauge/active `#7c3aed`, mark core `#6D28D9`.

### 4.1 `globals.css` — CSS variables

```css
@tailwind base; @tailwind components; @tailwind utilities;

@layer base {
  :root {
    /* surfaces */
    --background: 0 0% 100%;        /* white */
    --surface-1:  210 40% 98%;      /* slate-50 alt sections */
    --foreground: 222 47% 6%;       /* near-black slate */
    --muted-foreground: 215 16% 47%;
    --border: 215 25% 88%;

    /* brand — identical to apps/web */
    --primary: 263 70% 50%;         /* violet-600 — CTAs, focus, accents */
    --primary-foreground: 0 0% 100%;
    --ring: 263 70% 50%;

    /* violet-tip scale (from the Mark85 gradient stops) */
    --v-core: 263 71% 50%;          /* #6D28D9 */
    --v-mid:  258 90% 66%;          /* #8B5CF6 */
    --v-soft: 268 76% 74%;          /* #B98AF0 */
    --v-wash: 270 79% 92%;          /* #EADBFB */

    /* the charcoal hero band */
    --charcoal: 230 33% 8%;         /* #0B1020 — matches mark dark fadeBg */
    --charcoal-foreground: 0 0% 100%;

    --radius: 0.75rem;              /* matches app */
  }
}
@layer base {
  html, body { font-family: var(--font-inter), Inter, system-ui, sans-serif;
               -webkit-font-smoothing: antialiased; }
}
```

### 4.2 `tailwind.config.ts` — theme.extend

```ts
import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './content/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background:  'hsl(var(--background))',
        surface:     'hsl(var(--surface-1))',
        foreground:  'hsl(var(--foreground))',
        border:      'hsl(var(--border))',
        ring:        'hsl(var(--ring))',
        muted:       { foreground: 'hsl(var(--muted-foreground))' },
        primary:     { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        violet:      { core: 'hsl(var(--v-core))', mid: 'hsl(var(--v-mid))',
                       soft: 'hsl(var(--v-soft))', wash: 'hsl(var(--v-wash))' },
        charcoal:    { DEFAULT: 'hsl(var(--charcoal))', foreground: 'hsl(var(--charcoal-foreground))' },
      },
      fontFamily: {
        sans:    ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'Space Grotesk', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],   // financial figures (.num)
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      backgroundImage: {
        'violet-tip': 'linear-gradient(135deg, hsl(var(--v-core)) 0%, hsl(var(--v-mid)) 55%, hsl(var(--v-soft)) 100%)',
        'hero-glow':  'radial-gradient(60% 50% at 50% 0%, hsl(var(--v-core)/0.22), transparent 70%)',
      },
      transitionTimingFunction: {
        // the "expensive" curve — used everywhere, no bounce
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
        gentle: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      },
      maxWidth: { content: '72rem' },   // 1152px premium reading measure
    },
  },
  plugins: [],
} satisfies Config
```

---

## 5. Section-by-section specification

### 5.1 Navbar (`Navbar.tsx`, client)

- **Left:** `<Wordmark />` from `@85percent/brand` (the gradient "85" + "Percent" in Space
  Grotesk, weight 400, `strokeWidth={16.95}` — identical to the app sidebar/login).
- **Right (desktop):** anchor links (Platform · The Rule · Capabilities) + **primary CTA
  `Request Access`**. Mobile: hamburger → full-height sheet, motion-driven slide.
- **Behavior:** transparent over the charcoal hero; on scroll past hero, transitions to
  `bg-white/80 backdrop-blur-md border-b` (a `useScroll`-driven boolean, animated opacity —
  **no jump**). Sticky, `z-50`.

### 5.2 Hero (`Hero.tsx` + `HeroVisual.tsx`, client)

- **Band:** `bg-charcoal` with `bg-hero-glow` overlay (violet core glow from the top center,
  echoing the Mark85 gradient). White type.
- **Headline (display, balanced):** *"The definitive financial compliance platform for elite
  football clubs."*
- **Sub-headline:** *"Maximize your squad. Protect your points."*
- **Primary CTA:** *"Win the transfer window. Within the rules."* → `RequestAccessButton`.
- **Visual:** abstract **dashboard-meets-pitch-geometry** — a stylised SCR compliance gauge
  (reusing the app's gauge zone language) layered over faint pitch line geometry, rendered as
  inline SVG so strokes inherit the violet-tip gradient. Subtle parallax on scroll (`useScroll`
  → `y` transform, ≤24px), respects `prefers-reduced-motion`.
- **Entrance:** staggered fade-up (§7 `staggerParent` → `fadeUp` items): eyebrow → headline →
  sub → CTA → visual, ~90ms apart, each `y: 24→0`, `duration: 0.8`, `ease: expo`. One time, on
  mount (not scroll).

### 5.3 Problem / Solution (`ProblemSolution.tsx`)

Two-beat narrative, scroll-triggered `Reveal` fade-ins:

1. **The end of the unlimited-spending era.** Short, declarative: the old model (spend to the
   limit of an owner's patience) is over.
2. **Enter the Squad Cost Ratio.** Define SCR plainly — wages + amortisation + agent fees as a
   capped percentage of football revenue — and frame 85Percent as the deterministic engine
   that keeps a club the right side of the line. Optional inline stat band (e.g., the headline
   ratio "85%") using the `.num` mono treatment for an audited feel.

### 5.4 Core Capabilities — Interactive Carousel (`CapabilitiesCarousel.tsx`, client)

The centrepiece. Three pillars (`content/capabilities.ts`):

1. **Real-Time Threshold Monitoring** — live SCR vs. the limit, zone gauge, breach alerts.
2. **Transfer Window Scenario Planning** — model signings/sales/renewals against the cap
   before you commit.
3. **AI-Powered Compliance Analyst** — natural-language interrogation of your compliance
   position, grounded in the club's own numbers.

Full mechanics in §5a below.

### 5.5 Footer (`Footer.tsx`, trust & contact)

- **Brand block:** `<Wordmark />` + tagline **"The Squad Cost Engine."**
- **Jurisdictional & legal:** Terms of Service · Privacy Policy · **SSR Compliance Disclaimer**
  (internal routes `/terms`, `/privacy`, `/ssr-disclaimer`).
- **Contact:** LinkedIn icon (→ company page), email **contact@85percent.com** (`mailto:`),
  **WhatsApp Business** deep link (`https://wa.me/<number>` — number TBD, see §10).
- Quiet, monochrome, slate-600 on white, violet hover. Bottom rule: `© 2026 85Percent`.

---

## 5a. Carousel architecture (the buttery, expensive one)

**Library decision: hand-rolled on framer-motion** (no carousel dep). We need exactly one
behaviour — a heavy, controlled horizontal slide — and framer-motion's `drag` + `animate`
gives full control over easing without fighting a library's defaults (which trend bouncy).

**Model**

```ts
// state: active index 0..2; direction (for slide sign); paused (hover/focus/drag)
// transform: track translateX = -active * slideWidth, animated, ease: expo, dur 0.7
```

- **Layout:** a viewport (`overflow-hidden`) + a flex track of `CapabilityCard`s. Desktop shows
  one focal card centered with neighbours peeking (scale/opacity falloff for depth); mobile is
  one card, full-width.
- **Auto-play:** advances every **6s**, `ease: expo`. **Pauses** on hover, focus-within, drag,
  tab-hidden (`visibilitychange`), and `prefers-reduced-motion` (then it's static, manual-only).
- **Drag:** `drag="x"` with `dragConstraints` + `dragElastic: 0.08` (minimal — premium, not
  rubbery). On release, `onDragEnd` snaps to nearest index using offset+velocity threshold.
- **Controls:** prev/next arrow buttons (lucide `ArrowLeft/Right`) + dot indicators. Dots are
  buttons (a11y), active dot fills `bg-violet-core`, others `bg-border`; transition `width`.
- **Transition:** track `x` via `animate` with `transition: { duration: 0.7, ease: expo }`.
  Card depth (neighbours): `scale 0.92`, `opacity 0.45`, animated on the same curve.
- **A11y:** `role="group" aria-roledescription="carousel"`, each slide
  `aria-roledescription="slide" aria-label="N of 3"`, live region announces index, arrows have
  labels, full keyboard (← →, Home/End), focus never trapped, auto-play stops on focus.

**`CapabilityCard.tsx`:** icon chip (violet-tip gradient bg, white lucide glyph), title
(display), one-line promise, supporting sentence, a thin violet underline that draws on active
(`scaleX 0→1`, `origin-left`, ease expo). Glassy card: `bg-white border border-border rounded-lg
shadow-[0_1px_0_rgba(0,0,0,0.04),0_24px_48px_-24px_rgba(109,40,217,0.18)]`.

---

## 5b. Lead capture & data layer (Supabase)

Every CTA ("Request Access" in the navbar, the hero CTA, footer) opens
`DemoRequestDialog` — a motion-driven modal form. Submitting captures a sales lead into the
**existing Supabase project**. This is the **only** backend the landing page touches.

### 5b.1 Hard security contract

> The public site holds the Supabase **anon** key and can do exactly one thing: **insert a row
> into `demo_requests`**. It cannot read, update, or delete that row, and it has **no read
> access to any core application table** (clubs, users, players, contracts, scenarios, …).

Enforced on two reinforcing layers — see the migration
**`apps/api/prisma/migrations/20260609000001_demo_requests_lead_capture/migration.sql`**:

| Layer            | What the migration does                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| **RLS policy**   | `ENABLE` + `FORCE ROW LEVEL SECURITY`; the *only* policy is `FOR INSERT TO anon, authenticated WITH CHECK (true)`. No SELECT/UPDATE/DELETE policy exists → Postgres default-denies them. |
| **GRANT**        | `REVOKE ALL … FROM PUBLIC, anon, authenticated`, then `GRANT INSERT … TO anon, authenticated`. The privilege layer agrees with the policy layer: insert and nothing else. |
| **service-role** | Reads/triage happen API- or admin-side with the service-role key (BYPASSRLS) — never on the landing page, which never holds that key. |
| **core tables**  | Keep RLS enabled with **no anon policy** (see `20260530000002_rls_managers_and_templates`). The migration ships an audit query that must return **zero** public tables exposed to anon. |

### 5b.2 `demo_requests` shape

`id` (uuid pk) · `created_at` · `full_name?` · `work_email` (required, format + length
CHECKed) · `club?` · `role?` (job title) · `message?` · `source?` (which CTA fired) ·
`status` (default `'new'`, triaged service-role-side). DB CHECK constraints cap every field
length so anon — which can insert freely — can't push oversized/junk payloads. Modeled in
Prisma as `DemoRequest` to keep the schema authoritative (Prisma models the schema; it is not
auto-applied at runtime).

### 5b.3 Write path & abuse defence

- **Server-side route handler** `app/api/demo-request/route.ts` (POST), *not* a direct
  browser→Supabase call: lets us validate with zod (`lib/demoRequest.ts`), run a hidden
  **honeypot** + timing check, and apply lightweight per-IP rate-limiting before the insert.
- It uses the **anon** Supabase client from `lib/supabase.ts` (anon key only — even the server
  half of the landing app cannot read core data). `.from('demo_requests').insert(payload)`.
- Env vars (landing-app-owned, isolated per the deployment rules):
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY` (server-only; no service-role key is ever set
  for this app).
- On success the dialog shows a calm confirmation state; on failure, a non-blocking retry.

### 5b.4 Architecture note (no rule violation)

The migration lives under `apps/api/prisma/migrations/` because that directory is the
single, version-controlled source of truth for the **shared database** schema — it is not the
landing page importing API *code*. At runtime the landing page only opens its own Supabase
anon client against the shared project; there is **no cross-app code import**, and the landing
app keeps its own `package.json`, env, and deploy target.

---

## 6. Logo / shared-asset strategy → `packages/brand`

The brief says "import the logo from /shared, don't bleed code." The real `@85percent/shared`
is logic-only and the logo lives inside `apps/web`. Cleanest honouring of intent:

**Create `packages/brand`** (`@85percent/brand`), a tiny presentational package:

```
packages/brand/
├─ package.json         ← name @85percent/brand, peer: react
├─ tsconfig.json
└─ src/
   ├─ Mark85.tsx        ← moved verbatim from apps/web (no app deps; uses only React useId)
   ├─ Wordmark.tsx      ← moved verbatim (imports Mark85 from sibling, not '@/')
   ├─ tokens.ts         ← exported gradient stops, #6D28D9 core, strokeWidth 16.95
   └─ index.ts
```

- **Migration:** move the two components out of `apps/web/src/components/ui/`, re-export them
  from `@85percent/brand`, and leave a one-line shim (`export { Wordmark } from '@85percent/brand'`)
  in the old path so `apps/web` keeps compiling with zero churn. This is the **only** edit
  outside `apps/landing-page` and it is a non-breaking move, not new app logic.
- **Next.js note:** `Mark85` calls `useId()` → it (and `Wordmark`) ship as **client
  components** (`'use client'` at the top of each). Pure SVG, no app coupling — safe.
- **Source of truth stays** `design/Logo/mark85.js`; `packages/brand` is the React port, exactly
  as the current header comment in `Mark85.tsx` already documents.

If promoting the package is deemed out of scope for v1, the fallback is to **copy** `Mark85.tsx`
+ `Wordmark.tsx` into `apps/landing-page/components/brand/` (they have no dependencies). Spec
recommends the package — one mark, one place.

---

## 7. Animation system (`components/motion/`)

**Doctrine:** heavy, precise, expensive. **Banned:** spring with bounce, `type: 'spring'` with
low damping, overshoot, scale-pop > 1, rotation gimmicks, anything < 0.4s on a reveal. Every
motion uses `ease: expo` (`[0.16, 1, 0.3, 1]`) or `gentle`, durations 0.6–0.9s.

`variants.ts` — single source of truth:

```ts
export const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16,1,0.3,1] } },
}
export const fadeIn = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.7, ease: [0.16,1,0.3,1] } },
}
export const staggerParent = {
  hidden: {}, visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}
```

- **`Reveal.tsx`** — wraps `motion.div`, `initial="hidden"`, `whileInView="visible"`,
  `viewport={{ once: true, amount: 0.3 }}`, variant `fadeUp`. Used by every scroll-in text block.
- **`Stagger.tsx`** — `staggerParent` on the container, `fadeUp` on children; powers the hero
  sequence and capability intro.
- **Hero parallax:** `useScroll` + `useTransform` (≤24px `y`), spring-free.
- **Reduced motion (mandatory):** a top-level `useReducedMotion()` gate — when true, all
  variants collapse to opacity-only with `duration: 0` distances, carousel auto-play disabled,
  parallax off. Authored centrally so no component opts out by accident.
- **Route/page transitions:** Next App Router; keep it minimal — a single `fadeIn` on
  `template.tsx` so internal nav (legal pages) feels composed, not flashy.

---

## 8. Content & copy (`content/`)

All strings centralised and typed so copy review happens in PRs, and i18n is a later drop-in:

- `site.ts`: brand name, tagline, contact (email/LinkedIn/WhatsApp), legal link list, SEO meta.
- `capabilities.ts`: `{ id, icon, title, promise, body }[]` for the three pillars.
- `nav.ts`: anchor + CTA definitions.

Voice: declarative, institutional, scarce adjectives. Numbers in mono (`.num`). No exclamation
marks outside the CTA.

---

## 9. Cross-cutting: SEO, a11y, performance, build

- **SEO/OG:** App Router `metadata` export per route; dynamic `opengraph-image.tsx` (mark +
  headline on charcoal) for rich LinkedIn/WhatsApp previews; `JSON-LD` Organization +
  SoftwareApplication in `layout.tsx`; `robots`, `sitemap.ts`, canonical URLs.
- **Accessibility:** WCAG 2.2 AA. Violet-on-white CTA passes contrast; charcoal hero text is
  white (AAA). Full keyboard path, visible `focus-visible` ring (`--ring`), carousel a11y per
  §5a, `prefers-reduced-motion` honoured globally, semantic landmarks, `lang` set.
- **Performance budget:** SSG HTML, `next/font` (no FOUT/CLS), `next/image` AVIF/WebP, client JS
  only on the four interactive islands. Target LCP < 1.5s, CLS < 0.02, no hydration jank on hero.
- **Turborepo wiring:** `apps/landing-page/package.json` scripts `dev`/`build`/`start`/`typecheck`;
  `turbo.json` picks it up via the existing `apps/*` glob. Dev port distinct from `apps/web`
  (e.g. 3100). `tsconfig.json` extends `../../tsconfig.base.json`.
- **Deploy:** standalone Next build (Vercel-native or `output: 'standalone'` for the existing
  Docker flow — see `DOCKER.md`).

---

## 10. Open decisions (need a human before/at build time)

1. **Framework sign-off** — Next.js (recommended, §2.1) vs. stay-on-Vite SSG. Affects scaffolding
   only; everything else is portable.
2. **`packages/brand` promotion** (recommended) vs. copy logo into `apps/landing-page` (§6).
3. **WhatsApp Business number** + **LinkedIn company URL** — placeholders until provided.
4. **Legal copy** for `/terms`, `/privacy`, `/ssr-disclaimer` — needs real text (counsel-owned);
   spec scaffolds the routes only.
5. **Hero visual fidelity** — abstract SVG (spec'd, in-house) vs. a commissioned 3D/render. Spec
   assumes the SVG so it ships with the codebase and animates with the violet-tip gradient.

**Resolved:** Lead capture uses the **existing Supabase project** with a new INSERT-only
`demo_requests` table (anon insert, no read/update/delete, no core-table access). Migration
written: `apps/api/prisma/migrations/20260609000001_demo_requests_lead_capture/` (§5b) — run it
against the live DB before the form goes live.

---

## 11. Build order (once approved)

1. Scaffold `apps/landing-page` (Next 14, Tailwind tokens §4, fonts, Turbo wiring) — empty page.
2. `packages/brand` extraction + `apps/web` shim (§6); verify app still builds.
3. `Navbar` + `Footer` + `RequestAccessButton` + `content/` (the frame).
4. Motion primitives (`Reveal`, `Stagger`, `variants`) + reduced-motion gate.
5. `Hero` + `HeroVisual` (the signature entrance).
6. `ProblemSolution`.
7. `CapabilitiesCarousel` + `CapabilityCard` (the centrepiece, §5a).
8. **Lead capture** (§5b): run the `demo_requests` migration, wire `lib/supabase.ts` +
   `app/api/demo-request/route.ts` + `DemoRequestDialog`, verify anon can insert but cannot
   read (RLS smoke test).
9. SEO/OG, legal route stubs, a11y + Lighthouse pass against the §9 budget.

— end of spec —
```
