# 85Percent — Vercel + Namecheap Production Deployment

Companion to `DEPLOYMENT_SOP.md` (which covers Git branches + Supabase). This
doc is the **hosting** runbook: the three Vercel projects, their env vars, and
the Namecheap DNS records for `85percent.pro`.

> Verify-first: the directory names below were read from `apps/`. The original
> brief said `apps/main-app` / `apps/admin-panel` — **those do not exist**. The
> real names are `apps/web` and `apps/admin`.

---

## 0. What deploys where

| App | Directory | Package | Framework | Domain |
|---|---|---|---|---|
| Landing | `apps/landing-page` | `@85percent/landing-page` | Next.js | **85percent.pro** (+ www) |
| Web app | `apps/web` | `@85percent/web` | Vite SPA | **app.85percent.pro** |
| Admin | `apps/admin` | `@85percent/admin` | Next.js | **admin.85percent.pro** |
| API | `apps/api` | `@85percent/api` | Fastify | **api.85percent.pro** — *NOT Vercel* |

`apps/api` is a long-running Fastify server and **cannot run on Vercel**. It is
hosted on **Railway** with the public hostname `api.85percent.pro` (§4). Both the
web app and the admin panel depend on it.

---

## ⚠️ 1. Blockers to clear BEFORE the first deploy

These are real, found in the code — not theoretical.

### 1a. Web app has no production API URL (`apps/web`)
`apps/web/src/lib/api.ts:18` hardcodes `const BASE = '/api'`. In dev that's the
Vite proxy → `localhost:3001`. On Vercel there is no proxy, so calls go to
`app.85percent.pro/api/*` and 404. The app also uses `BrowserRouter`, so a
refresh on `/scenarios` 404s without an SPA fallback.

**Fix — add `apps/web/vercel.json`:**
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.85percent.pro/:path*" },
    { "source": "/((?!assets/).*)", "destination": "/index.html" }
  ]
}
```
The first rule proxies the API (keeping the SPA same-origin, so the Supabase
bearer token flows and there's no CORS). The second is the SPA history fallback.
Order matters: `/api` must come first.

### 1b. Admin "jobs" spawn a subprocess (`apps/admin`)
`apps/admin/lib/jobs.ts:106` does `spawn('pnpm', ['--filter','@85percent/api', …])`.
Vercel's serverless functions have no `pnpm`, no monorepo on disk, and an
ephemeral read-only FS — **this will throw in production.**

**Decision: move the jobs into the API.** The job scripts become HTTP endpoints
on the Fastify server (which already runs the exact same scripts), and admin
calls them over HTTP instead of spawning a subprocess. This keeps admin on Vercel
and makes jobs work in prod. Tracked as follow-up work (see §5 step 2); until
it's done, the admin job buttons are the only broken surface — login, the Leads
CRM, and account provisioning all work.

### 1c. Workspace packages must be built first
`@85percent/shared`, `@85percent/engine`, `@85percent/brand` all resolve via
`"exports" → ./dist/index.js`. A bare `next build` / `vite build` won't build
those dists. The **build command override** in §2 routes through Turbo, whose
`build` task `dependsOn: ["^build"]`, so dependencies build first.

---

## 2. Create the 3 Vercel projects (single repo)

Do this **three times** — once per app. New Project → Import the
`asset8k/85Percent` repo → then per-project:

**Common to all three**
- **Root Directory:** set to the app's folder (table below). Turn **ON**
  "Include source files outside of the Root Directory" (needed — the lockfile +
  `packages/*` live at the repo root).
- **Install Command (override):** `cd ../.. && pnpm install --frozen-lockfile`
- **Node version:** 20.x (matches `engines.node >=20`).

**Per-app settings**

| Setting | Landing | Web | Admin |
|---|---|---|---|
| Root Directory | `apps/landing-page` | `apps/web` | `apps/admin` |
| Framework Preset | Next.js | Vite | Next.js |
| Build Command (override) | `cd ../.. && pnpm turbo run build --filter=@85percent/landing-page` | `cd ../.. && pnpm turbo run build --filter=@85percent/web` | `cd ../.. && pnpm turbo run build --filter=@85percent/admin` |
| Output Directory | *(default `.next`)* | `dist` | *(default `.next`)* |

**Git / branch behaviour (all three, per `DEPLOYMENT_SOP.md`):**
- Production Branch = `main` → push to `main` = Production deploy.
- `dev` (and any branch) = Preview deploy with its own URL.

> Why the `cd ../..` dance: with Root Directory set to an app, Vercel runs
> commands from that app dir. Going up to the repo root lets pnpm see the
> workspace and lets Turbo build the `packages/*` dists before the app.

---

## 3. Environment variables per project

Set these in **Vercel → Project → Settings → Environment Variables**, scoped to
**Production** (use the **prod** Supabase project `fkyexcddvogkngbbrefz`). For the
**Preview** scope, add the same keys with the **dev** project values
(`deebcfzsgdwnmeoqphgm`) so `dev`-branch previews hit dev. Real values come from
`.env.prod.example` — **never commit filled values.**

### Landing → `apps/landing-page` (85percent.pro)
```
NEXT_PUBLIC_SUPABASE_URL = https://fkyexcddvogkngbbrefz.supabase.co
SUPABASE_ANON_KEY        = <prod sb_publishable_… key>   # read server-side in the lead route
UPSTASH_REDIS_REST_URL   = <prod Upstash REST URL>       # dedicated prod DB, not dev's
UPSTASH_REDIS_REST_TOKEN = <prod Upstash REST token>
```

### Web app → `apps/web` (app.85percent.pro)
Vite **inlines** `VITE_` vars at build → everything here ships to the browser.
**Anon key only. Never a service-role key.**
```
VITE_SUPABASE_URL      = https://fkyexcddvogkngbbrefz.supabase.co
VITE_SUPABASE_ANON_KEY = <prod sb_publishable_… key>
```
(The API base is handled by the `vercel.json` rewrite in §1a, not an env var.)

### Admin → `apps/admin` (admin.85percent.pro)
All server-only — **none** carry `NEXT_PUBLIC_`, so none reach the browser.
```
SUPABASE_URL              = https://fkyexcddvogkngbbrefz.supabase.co
SUPABASE_SERVICE_ROLE_KEY = <prod sb_secret_… key>     # GOD MODE — server only, never NEXT_PUBLIC_
ADMIN_USERNAME            = <prod admin user>
ADMIN_PASSWORD            = <STRONG fresh prod password>      # openssl rand -base64 24
ADMIN_SESSION_SECRET      = <fresh 32-byte hex>               # openssl rand -hex 32
APP_URL                   = https://app.85percent.pro         # invite redirect → ${APP_URL}/set-password
```
`REPO_ROOT` and `NODE_ENV` are **not** set on Vercel (NODE_ENV is automatic;
REPO_ROOT only matters for the local subprocess jobs from §1b).

> The admin edge middleware (`apps/admin/middleware.ts`) **fails closed**: with
> `ADMIN_SESSION_SECRET` or `ADMIN_USERNAME` missing, every route redirects to
> `/login`. So if admin "redirects forever" in prod, a missing env var is why.

---

## 4. Namecheap DNS — `85percent.pro`

Namecheap → Domain List → **Manage** → **Advanced DNS**. First **delete** the
two default records Namecheap ships (the `CNAME www → parkingpage` and the
`URL Redirect @ → http://www…`) — they'll fight your records.

Add Vercel's published targets. Vercel shows the exact values under each
project's **Settings → Domains** after you add the domain there; the standard
values are:

| Type | Host | Value | For |
|---|---|---|---|
| **A** | `@` | `76.76.21.21` | apex `85percent.pro` → Landing |
| **CNAME** | `www` | `cname.vercel-dns.com.` | `www.85percent.pro` → Landing |
| **CNAME** | `app` | `cname.vercel-dns.com.` | `app.85percent.pro` → Web app |
| **CNAME** | `admin` | `cname.vercel-dns.com.` | `admin.85percent.pro` → Admin |
| **CNAME** | `api` | `<your-app>.up.railway.app.` | `api.85percent.pro` → Railway (Fastify) |

TTL = **Automatic** for all. Notes:
- Namecheap can't CNAME the apex, so the apex uses Vercel's **A record**
  `76.76.21.21`. (If Vercel shows a different apex IP in your dashboard, use that.)
- `api` → Railway: in the Railway service → Settings → Networking → add the
  custom domain `api.85percent.pro`; Railway shows the exact CNAME target
  (`<svc>.up.railway.app`) to paste here.
- Don't forget a trailing dot on CNAME values if Namecheap requires it.

**In each Vercel project → Settings → Domains, add:**
- Landing: `85percent.pro` **and** `www.85percent.pro` (set apex as primary,
  www → redirect to apex).
- Web: `app.85percent.pro`.
- Admin: `admin.85percent.pro`.

Vercel auto-provisions SSL once DNS resolves (a few minutes to ~1 h).

---

## 5. Go-live order (do it in this sequence)

1. **API first.** Deploy `apps/api` to **Railway** against the **prod** Supabase
   `DATABASE_URL`; add the custom domain `api.85percent.pro`; confirm a health
   route responds over HTTPS. Set its env from `.env.prod.example` (api section)
   incl. `FRONTEND_URL=https://app.85percent.pro` for CORS. Railway build:
   root = repo, install `pnpm install --frozen-lockfile`, build
   `pnpm turbo run build --filter=@85percent/api`, start `pnpm --filter @85percent/api start`.
2. **Clear §1 blockers.** Add `apps/web/vercel.json` (§1a). Migrate the admin
   jobs into the API as HTTP endpoints and repoint admin at them (§1b). Commit on
   `dev`, validate on the Preview deploys.
3. **Create the 3 Vercel projects** (§2) + env vars (§3) + domains (§4).
4. **DNS** in Namecheap (§4); wait for SSL.
5. **Prod Supabase Auth** (dashboard, prod project): add
   `https://app.85percent.pro/set-password` to allowed redirect URLs; set the
   invite email template; disable public signups.
6. **Promote:** merge `dev → main` → all three go Production. Smoke-test:
   landing lead submit (→ 429 after the rate limit), admin login + provision a
   lead, web login + one club-scoped read.

---

## 6. Quick reference — secrets that must be fresh for prod
Never reuse dev's: DB password, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and the
Upstash database. Service-role key is server-only — it must never appear in a
`VITE_` or `NEXT_PUBLIC_` variable on any project.
