# Headroom — Football Financial Compliance Platform

A B2B SaaS platform for professional football clubs to instantly simulate the financial and regulatory impact of player transfers before they happen.

---

## Project Status

**MVP 1.0** — Single Transfer Stress Tester (EFL Championship)

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

Engine unit tests: 39 tests covering all SCR calculation edge cases.

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

## Deployment

- **Frontend**: Vercel (connect GitHub repo → auto-deploy)
- **API**: Railway (connect GitHub repo → set env vars → deploy)
- **Database**: Supabase (managed PostgreSQL with RLS)
