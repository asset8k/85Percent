# 85Percent - Football Financial Compliance Platform

85Percent is a B2B SaaS platform for professional football clubs to model Squad
Cost Ratio (SCR), roster contracts, transfer scenarios, Premier League SSR, and
the regulatory impact of football decisions before they happen.

## Current Architecture

The repository is a pnpm 11 + Turborepo monorepo with three Vercel applications:

- `apps/web`: React 18 + Vite main product, local port 5173.
- `apps/admin`: Next.js 14 admin panel and all serverless API Route Handlers,
  local port 4000.
- `apps/landing-page`: Next.js 14 public site, local port 3100.

Shared packages:

- `packages/engine`: pure SCR, amortisation, levy, points, and SSR calculations.
- `packages/shared`: types, Zod schemas, money helpers, and chat context.
- `packages/brand`: shared brand assets.

The former Railway/Fastify `apps/api` package is retired. The exact API contract
is now served from `apps/admin/app/api/[...path]/route.ts`; backend handlers live
under `apps/admin/backend` and the Prisma history lives under
`apps/admin/prisma`.

## Prerequisites

- Node.js 20 or newer
- pnpm 9 or newer; the repository pins pnpm 11.2.2
- A Supabase project
- An Upstash Redis database for distributed rate limiting

## Install

```bash
pnpm install
```

## Environment Setup

Real environment files are gitignored. Never commit their values.

### Main web app

Copy `apps/web/.env.example` to `apps/web/.env.local`:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

### Admin and serverless API

Copy `apps/admin/.env.example` to `apps/admin/.env.local`. The important groups are:

- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`, and optional Prisma CLI `DATABASE_URL`.
- Admin login: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`.
- API rate limiting: `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`.
- AI: `ANTHROPIC_API_KEY` and optional `ANTHROPIC_MODEL`.
- Jobs/integrations: `INTERNAL_JOB_SECRET`, optional
  `FOOTBALL_DATA_API_KEY`, and optional Transfermarkt settings.
- Invite redirect: `APP_URL`, normally `http://localhost:5173` locally.

### Landing page

Copy `apps/landing-page/.env.example` to
`apps/landing-page/.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_ANON_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

The lead form uses an Upstash sliding window of three submissions per hour per
IP. The serverless product API also uses Upstash for distributed global and
endpoint-specific limits.

## Local Development

Start the complete stack:

```bash
pnpm dev
```

Local URLs:

- Main app: `http://localhost:5173`
- Admin and API: `http://localhost:4000`
- API health: `http://localhost:4000/api/health`
- Landing: `http://localhost:3100`

Vite proxies `/api/*` to port 4000 without stripping `/api`. In production,
`apps/web/vercel.json` rewrites `/api/*` to the admin Vercel project, preserving
same-origin browser requests.

Run individual applications when needed:

```bash
pnpm --filter @85percent/admin dev
pnpm --filter @85percent/web dev
pnpm --filter @85percent/landing-page dev
```

## Tests And Builds

```bash
pnpm typecheck
pnpm test
pnpm build
```

Additional database-backed onboarding verification:

```bash
pnpm --filter @85percent/admin test:onboarding
```

The root `pnpm test` now runs both the pure calculation engine tests and the
migrated API script/unit tests owned by `apps/admin`.

## Database And Schema

- Normal Prisma history: `apps/admin/prisma/migrations`.
- Prisma schema: `apps/admin/prisma/schema.prisma`.
- Supabase bootstrap/security migrations: `supabase/migrations`.
- Runtime database access uses server-only Supabase clients.
- The service-role client bypasses RLS, so every tenant query must explicitly
  constrain `club_id` and, where appropriate, `user_id`.

Do not run the Prisma history and the aggregate Supabase baseline against the
same already-provisioned database. See `docs/DEPLOYMENT_SOP.md`.

## Roster Templates And Maintenance Jobs

Template onboarding reads `template_clubs` and `template_roster_items`, then
hydrates a tenant's players, contracts, manager, and manager contracts.

Local template refresh with a Transfermarkt API running on port 8000:

```bash
pnpm --filter @85percent/admin sync:templates
```

League snapshot refresh:

```bash
pnpm --filter @85percent/admin update:league
```

The admin UI triggers the same jobs through
`POST /api/internal/jobs/:type`. On Vercel, work is scheduled with
`@vercel/functions` `waitUntil` and the API Route Handler has a 300-second
maximum duration. The full Transfermarkt sync must use a production-reachable
HTTPS `TRANSFERMARKT_API_URL`; `localhost:8000` is local-only.

## Deployment

All application compute is hosted by Vercel:

- `85percent.pro`: landing Vercel project.
- `app.85percent.pro`: Vite web Vercel project.
- `admin.85percent.pro`: admin plus serverless API Vercel project.
- Supabase: managed database, Auth, RLS, pgvector, and RPCs.
- Upstash: distributed rate limiting.

Railway, the old API Dockerfile, and the separate `api.85percent.pro` service are
no longer part of the architecture.
