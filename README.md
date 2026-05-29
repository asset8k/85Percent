# Headroom — Football Financial Compliance Platform

A B2B SaaS platform for professional football clubs to instantly simulate the financial and regulatory impact of player transfers before they happen.

---

## Project Status

**MVP 2.0** — Relational roster, multi-action scenarios, Premier League SSR module, RBAC + audit, PDF/Excel exports, and **template-driven onboarding** (pre-fill a club's 25-man squad from a cached roster library).

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

### Install

```bash
pnpm install
```

### Environment Setup

**API** — copy `apps/api/.env.example` to `apps/api/.env` and fill in:
- `DATABASE_URL` — your Supabase PostgreSQL connection string
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (from Supabase dashboard)

Optional (only used by the template sync worker — see [Roster Templates & Onboarding](#roster-templates--onboarding)):
- `TRANSFERMARKT_API_URL` — base URL of a [felipeall/transfermarkt-api](https://github.com/felipeall/transfermarkt-api) instance (default `http://localhost:8000`)
- `TRANSFERMARKT_SEASON_ID` — season start year, e.g. `2025` for 2025‑26 (default: derived from today)
- `TRANSFERMARKT_SYNC_DELAY_MS` — delay between club requests (default `3000`)
- `TRANSFERMARKT_TIMEOUT_MS` — per‑request timeout (default `20000`)
- `TRANSFERMARKT_PLAYER_DELAY_MS` — delay between the per‑player profile requests used to fetch shirt numbers (default `500`)
- `TRANSFERMARKT_FETCH_SHIRT_NUMBERS` — set to `0` to skip shirt‑number enrichment (much faster; numbers left null)

**Web** — copy `apps/web/.env.example` to `apps/web/.env.local` and fill in:
- `VITE_SUPABASE_URL` — your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — anon key (from Supabase dashboard)

### Supabase Setup

1. Create a Supabase project at supabase.com
2. Copy your project URL and keys into the env files above
3. Run Prisma migrations:
   ```bash
   pnpm --filter @headroom/api exec prisma migrate dev
   ```
4. Apply Row Level Security policies (see `prisma/rls.sql` — to be added)
5. Seed an initial club and admin user via Supabase dashboard → Authentication → Users

### Development

```bash
pnpm dev
```

This runs:
- **Frontend** at http://localhost:5173
- **API** at http://localhost:3001

### Tests

```bash
pnpm test
```

Engine unit tests: 110+ tests covering SCR, the 5-year amortisation cap, contract-ledger transitions, and manager SCR inclusion.

Other test suites:

```bash
# Pure Transfermarkt mapping helpers (node:test)
pnpm --filter @headroom/api test:scripts

# Onboarding hydration logic, exercised against the live DB-filled templates
pnpm --filter @headroom/api test:onboarding
```

### Build

```bash
pnpm build
```

---

## Architecture

```
Headroom/
├── apps/
│   ├── web/          # React 18 + Vite + TypeScript frontend
│   └── api/          # Fastify + Node.js backend
├── packages/
│   ├── shared/       # Shared types, Zod schemas, money utilities
│   ├── engine/       # Pure SCR calculation engine (no side effects)
│   └── ui/           # (reserved for shared UI components)
├── prisma/
│   └── schema.prisma # Database schema (PostgreSQL)
└── PLAN.md           # Implementation progress tracker
```

### Key Design Rules

1. **Engine is pure** — `/packages/engine` contains only pure functions. No database calls, no API calls, no side effects.
2. **Money is always integers** — all monetary values stored as pence (BigInt in DB, number in TS). Display conversion at the presentation layer only.
3. **Every simulation is saved** — full audit trail, never deleted.
4. **Legal disclaimer on every page** — "Headroom is a decision-support tool. It does not constitute legal or financial advice."
5. **League config is data-driven** — all thresholds live in `LeagueConfig` objects, not if-statements.

---

## Roster Templates & Onboarding

To make onboarding friction-free, a new club can **pre-fill its entire 25-man squad** from a cached roster library instead of typing every player in by hand. The library is built by a controlled background worker; user onboarding then reads only our local cache, so the product is insulated from the third-party scraper's downtime or Cloudflare rate-limiting.

### How it works

```
felipeall/transfermarkt-api          (unofficial scraper, self/externally hosted)
        │   monthly background sync (service role)
        ▼
template_clubs / template_roster_items   (local Postgres dictionary, RLS-locked)
        │   POST /api/onboarding/complete  (CFO, one-time, empty club only)
        ▼
players / contracts / managers / manager_contracts   (the tenant's live roster)
```

- **`template_clubs`** — one row per club (`name`, `league`, `logoUrl`).
- **`template_roster_items`** — one row per player/manager (`position`, `dateOfBirth`, `nationality`, `estimatedTransferFee`, `contractStart/End`, `isManager`).

Both tables are club-agnostic and read **only** by the API (service role). They have RLS enabled with no client policy, so no anon/user key can touch them.

### The background sync worker

`apps/api/src/scripts/sync-templates.ts` populates the dictionary:

1. Fetches the club list for the two English competitions — **GB1** (Premier League) and **GB2** (EFL Championship) — whose union is exactly the 44 clubs.
2. For each club, pulls its profile (crest + best-effort head coach) and squad, maps every row into our template shape (pure helpers in `transfermarkt-mappers.ts`), and replaces that club's cached rows.
3. The bulk squad endpoint omits shirt numbers, so for each player it makes one extra call to the player profile (`shirtNumber`) — paced by its own delay and individually error-bounded (a failed lookup just leaves the number null).

Safety nets, as required for an unofficial scraper:
- a generous, configurable delay between **every** request (anti-Cloudflare; default 3 s);
- a per-request timeout;
- a per-club `try/catch` error boundary — one broken selector or timeout logs a warning and the batch continues; it never crashes wholesale.

> **Note:** Transfermarkt does not reliably expose wages, so every hydrated contract is created with `annual_wage = 0`. The Roster page surfaces those zero-wage rows as validation errors (red cells + a banner) so the CFO is prompted to enter real payroll before relying on the Squad Cost Ratio. It also does not reliably expose head coaches, so manager rows are usually empty. Shirt numbers **are** scraped (from each player's profile) and carried through onboarding into `players.squad_number`.

### Running the sync

You need a reachable `transfermarkt-api` instance (run it locally via Docker, or point at a hosted one):

```bash
# Fill the template dictionary (monthly cadence recommended)
TRANSFERMARKT_API_URL=https://<your-transfermarkt-api-host> \
TRANSFERMARKT_SEASON_ID=2025 \
pnpm --filter @headroom/api sync:templates
```

A successful run logs each club and a final summary, e.g. `done — 44 clubs synced, 0 failed, 1218 roster items cached.`

### Onboarding endpoints

- `GET  /api/onboarding/clubs?league=premier-league|efl-championship` — searchable club list from the local cache.
- `POST /api/onboarding/complete` `{ templateClubId }` — **CFO-only**; clones the cached squad into the caller's live roster and adopts the club identity. Guarded to run only on an empty roster (409 otherwise).

The wizard lives at `/onboarding` in the web app (also reachable from the empty Roster state).

---

## Deployment

- **Frontend**: Vercel (connect GitHub repo → auto-deploy)
- **API**: Railway (connect GitHub repo → set env vars → deploy)
- **Database**: Supabase (managed PostgreSQL with RLS)
