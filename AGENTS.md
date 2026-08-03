# 85Percent Project Context

Last reviewed: 2026-08-02

This file is durable repository context for Codex and other coding agents. Read it
before changing the project. Do not treat old plans as current implementation.

## Source Of Truth

Use this precedence when sources disagree:

1. Current code, database migrations, and deployment configuration.
2. Recent entries in `docs/BUILD_LOG.md`.
3. `README.md` and `docs/CONTEXT.md`.
4. Older deployment notes, plans, and landing-page specifications.

Several documents describe earlier Headroom-era architecture or already-completed
plans. Verify claims against source before implementing them.

## Product

85Percent is a B2B financial compliance platform for professional football clubs.
Its primary users are club finance teams evaluating Squad Cost Ratio (SCR),
roster contracts, transfer scenarios, Premier League Sustainability and Systemic
Resilience (SSR), and related audit evidence.

Core product areas:

- Dashboard with live SCR and regulatory risk.
- Player and manager roster, contracts, extensions, and amortisation.
- Scenario builder and comparison.
- Club financials and season selection.
- Premier League SSR assessments.
- Contract calendar, notifications, league table, and regulatory rules.
- Context-aware AI copilot grounded in club data and a small RAG knowledge base.
- Team invitations, granular permissions, TOTP, and audit history.
- Public marketing/demo-request site and a separate internal admin panel.

## Monorepo

This is a pnpm 11 + Turborepo monorepo requiring Node.js 20 or newer.

Deployable applications:

- `apps/web`: React 18, Vite, TypeScript SPA. Local port 5173.
- `apps/landing-page`: Next.js 14 App Router site. Local port 3100.
- `apps/admin`: Next.js 14 App Router internal panel and serverless API. Local
  port 4000.

Shared packages:

- `packages/engine`: pure SCR/amortisation/consequence calculations.
- `packages/shared`: shared types, Zod schemas, money helpers, and chat context.
- `packages/brand`: shared SVG marks and wordmark assets.

The repository has three deployable applications. The former Fastify
`apps/api` package and Railway service were removed on 2026-08-02; backend code,
tests, and Prisma migrations now live under `apps/admin`.

Common commands:

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @85percent/admin test:onboarding
```

`pnpm test` runs both engine tests and the migrated backend/serverless tests.

Run `build`, `typecheck`, and `test` as separate Turbo invocations. A combined
forced invocation can race Next.js generation of `.next/types` against the admin
typechecker and produce transient missing-file errors.

## Domain Invariants

- Monetary database values are integer pence, generally represented as `bigint`.
- SCR is squad costs divided by football-related revenue.
- The green threshold is 85%.
- The red threshold is additive: `85% + allowance percentage points`. With the
  default 30-point allowance, red begins at 115%. Do not use `85% * 1.30`.
- Amber results incur a levy.
- Red consequences begin at six points plus one point for each complete
  GBP 6.5m of spend above the red threshold.
- Player amortisation is capped at five years for SCR purposes.
- Manager/head-coach costs are included in squad costs.
- Championship clubs support an owner-equity top-up.
- Premier League SSR covers Working Capital, Liquidity, and Positive Equity.
- Club base currency is display-oriented GBP/EUR/USD; the system does not
  perform exchange-rate conversion.

Keep arithmetic in `packages/engine` or existing server calculation helpers.
The AI model must explain calculated results, not invent or recompute them.

## Web Architecture

- Routing is defined in the React SPA and includes login/reset flows plus
  dashboard, roster, onboarding, scenarios, SSR, calendar, rules, league table,
  financials, and settings.
- Supabase provides the browser session. `ProtectedRoute` bootstraps the API
  user/workspace and current-season financial data.
- TanStack Query owns server cache. Zustand owns auth, selected season, club
  state, notifications, and copilot UI state.
- The API base is always `/api`; Vite proxies locally and Vercel rewrites in
  production.
- English, Spanish, French, and Italian translations exist.
- The active SCR baseline flattens included saved scenarios into the pure engine.
- Large maintenance hotspots include `RosterPage.tsx`, `ClubSetupPage.tsx`,
  `ScenariosPage.tsx`, and the API roster route.

Legacy local-storage keys still use the former Headroom name. Preserve them
unless a migration is intentionally implemented.

## API Architecture

- `apps/admin/app/api/[...path]/route.ts` is the single Next.js Route Handler
  entry point. A small dispatcher under `apps/admin/backend/serverless`
  preserves all 72 previous endpoint method/path contracts without Fastify.
- The API authenticates Supabase JWTs, then loads the application user from
  `public.users`. Admin middleware excludes `/api`; API routes enforce their own
  bearer-token, public-route, or internal-secret rules.
- New authenticated users either consume a pending invite or receive an isolated
  starter workspace.
- The API uses the Supabase service-role key. It bypasses RLS, so every
  tenant-owned query must explicitly constrain `club_id` and, where applicable,
  `user_id`. UI permission checks are not a security boundary.
- Major route groups cover auth, clubs/financials, roster, onboarding, scenarios,
  SSR, notifications, league data, team/invites, audit, AI chat, and internal
  jobs.
- Upstash applies distributed API request limits in production. Local API rate
  limiting is skipped if its Upstash variables are absent; production fails
  closed. Scenario POST requests have an additional 30-per-minute limit.
- Scenario and roster multi-step mutations use compensating rollbacks rather
  than real database transactions. Preserve rollback behavior and prefer a
  database transaction/RPC for new cross-table critical mutations.
- AI uses Anthropic through the AI SDK, local MiniLM embeddings, pgvector RAG,
  per-user chat history, and a workspace-shared owner balance.
- AI chat streams a Web `Response` directly from the Next.js Route Handler.
- League data falls back from football-data.org to cached snapshots and then to
  bundled illustrative standings.
- Template roster sync depends on an unofficial Transfermarkt integration and
  HTML scraping. Treat it as an operationally fragile external dependency.

## Data Model

The Prisma schema is under `apps/admin/prisma/schema.prisma`. Main modeled tables:

- clubs, users, club financials
- players, contracts, managers, manager contracts
- scenarios and scenario actions
- three SSR assessment types
- invites, currencies, notifications
- template clubs and roster items
- audit log and demo requests

Operational tables/functions also exist outside the Prisma model:

- `chat_sessions`, `chat_messages`, `documents`
- `admin_jobs`, `league_table_snapshots`
- `match_documents`, `admin_topup_balance`, `deduct_ai_balance`

Schema workflows:

- `apps/admin/prisma/migrations` is the normal development migration history.
- `supabase/migrations` contains an aggregate baseline and security lockdown for
  Supabase/prod setup.
- Do not blindly run both migration histories against the same database.
- RLS is defense in depth because the API service role bypasses it.

## External Services And Deployment

- Supabase: Postgres, Auth, RLS, pgvector, and admin/auth APIs.
- Upstash Redis: landing-page demo-request and serverless API rate limiting. The
  service is Upstash, not "Unstash."
- Anthropic: AI copilot.
- football-data.org: league table updates.
- GitHub: source repository.
- Vercel: web, landing, and admin/API.

The web Vercel project rewrites `/api/*` to
`https://admin.85percent.pro/api/*`. Vite proxies `/api` to port 4000 locally.
Preview web deployments therefore currently target the production admin domain
unless the rewrite strategy is changed.

Environment files are local and gitignored. Never print, copy into docs, or
commit their values. Use the tracked example files to understand required
variables. Admin/API values belong in `apps/admin/.env.local`; landing values
belong in `apps/landing-page/.env.local`.

Branch intent:

- Work on `dev`.
- Promote tested content to `main` for production.
- At the review date, `dev` and `main` had identical file content despite
  deployment-only commits on `main`.

## Admin And Landing

The admin panel uses a separate single-operator credential and HMAC-signed
httpOnly session cookie. It accesses Supabase with the service role and can
manage leads, provision users, modify AI balances, inspect users, and trigger
API jobs. Job endpoints use `INTERNAL_JOB_SECRET`, return immediately, and use
Vercel `waitUntil` for background work. Route duration is configured to 300
seconds.

The landing page stores demo requests through a tightly scoped anonymous
Supabase insert and rate-limits requests with Upstash. It contains legal pages
written for the current pre-incorporation state.

## Known Gaps And Risks

Confirm these before touching adjacent code:

- Password-reset email delivery is not implemented; the API currently logs the
  reset URL instead of sending mail.
- Audit history is described as append-only/tamper-evident, but service-role
  code and current policies can delete audit rows, including workspace deletion.
- Roster, onboarding, and workspace deletion are multi-table operations without
  database transactions.
- Admin authentication has one shared operator credential, no login rate limit,
  and no explicit CSRF token beyond Server Actions/cookie protections.
- TOTP secrets are stored in the application user table without field-level
  encryption.
- AI compaction calls and failed post-stream balance deductions can create
  unbilled provider usage; concurrent requests may overspend a balance.
- Local MiniLM model loading and the associated cold start/function bundle need
  production Vercel verification even though the production build passes.
- Full template synchronization usually fits the 300-second function duration,
  but Transfermarkt extension mode is expected to exceed it. Run that mode
  locally or split it into smaller invocations before enabling it on Vercel.
- The web Vercel rewrite hard-codes the production admin host, so preview web
  deployments can mix preview frontend code with the production API.
- The landing metadata/site URL uses `85percent.com`, while deployment docs and
  contact addresses use `85percent.pro`.
- Landing copy mentions sharing a scenario, but no scenario-sharing product
  workflow currently exists.
- The bundled league fallback is illustrative and can become stale.
- The web production bundle is large: about 2.67 MB minified / 792 KB gzip at
  the review date. Route-level code splitting is absent.
- `SCRResultPanel` and `AmortisationTable` appear to be unreferenced legacy
  simulator components.
- Engine and migrated API unit/contract tests run from `pnpm test`. There are no
  application-level browser suites for web, admin, or landing.
- There is no repository CI workflow or enforced lint setup visible in source.
- Regulatory text and RAG content must be legally/currently validated before
  being presented as authoritative. Some source copy references a November 2025
  explainer and may not reflect later published rules.

## Verification Snapshot

On 2026-08-02:

- The Fastify/Railway API was migrated locally into the admin Next.js project.
  No commit or push was made.
- `pnpm typecheck` and `pnpm build` passed across all six workspace packages.
- Engine tests: 119 passed.
- Admin/backend tests: 64 passed, including all 61 migrated script/unit tests
  and three serverless registry tests.
- The registry test verifies 72 unique endpoint method/path contracts. Direct
  local smoke checks returned 200 for `/api/health` and the expected 401 for an
  unauthenticated `/api/me` request.
- The web bundle remained about 2.67 MB minified / 792 KB gzip and still emitted
  Vite's large-chunk warning.

Previous successful live-data snapshot:

On 2026-06-15:

- `pnpm typecheck`: passed across all packages.
- `pnpm build`: passed across all packages.
- Engine tests: 119 passed.
- API script tests: 61 passed.
- Onboarding tests: 19 passed, including read-only validation of 44 cached clubs
  and 1,274 hydrated players in the configured development Supabase project.
- The build emitted a large-chunk warning for the web SPA.

Re-run relevant checks after changes; this snapshot is not a substitute for
current verification.
