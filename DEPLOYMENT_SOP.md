# 85Percent — Deployment Standard Operating Procedure

A concise runbook for the Dev → Prod workflow: Git branches, the two Supabase
projects, database migrations, and Vercel. Read the **Schema source of truth**
section first — it prevents the most expensive mistake.

---

## 0. Environments at a glance

| | **Dev / Staging** | **Production** |
|---|---|---|
| Git branch | `dev` | `main` (locked) |
| Supabase project ref | `deebcfzsgdwnmeoqphgm` | `fkyexcddvogkngbbrefz` |
| Supabase URL | `deebcfzsgdwnmeoqphgm.supabase.co` | `fkyexcddvogkngbbrefz.supabase.co` |
| Env template | `.env.dev.example` | `.env.prod.example` |
| Vercel target | Preview (branch `dev`) | Production (branch `main`) |

Apps: `apps/web` (Vite SPA), `apps/admin` + `apps/landing-page` (Next.js),
`apps/api` (Fastify). Each reads its **own** env file — see the templates.

---

## 1. Git branching

- `main` = production. Protected; never commit directly. Production deploys are
  cut from here.
- `dev` = staging. All work lands here first (feature branches → `dev`).
- Promote to prod by merging `dev → main` via a reviewed PR:

```bash
git checkout dev          # do work here
# … commits …
git push origin dev       # → Vercel Preview deploy

# when validated, promote:
git checkout main
git merge --no-ff dev
git push origin main      # → Vercel Production deploy
```

---

## 2. Schema source of truth (READ THIS)

The relational schema is owned by **Prisma** (`apps/api/prisma/migrations`,
tracked in the `_prisma_migrations` table). The `supabase/migrations` folder
holds the **same schema as a CLI baseline** plus the **RLS/policy layer** that
Prisma does not model (`current_club_id()`, row-level policies, grants).

Pick **one** schema mechanism per database and stick to it:

- **Dev** was built by Prisma. Keep evolving it with Prisma
  (`prisma migrate dev`). Do **not** `supabase db push` to dev — it would try to
  re-create tables that already exist.
- **Prod** (`fkyexcddvogkngbbrefz`) is **empty**. You may provision it **either**
  way — but only one:
  - **Path A — Supabase CLI (matches this SOP's commands):** `supabase db push`
    applies `supabase/migrations/*` in order: `…_baseline_schema.sql` (extensions
    + all tables), then `…_security_lockdown.sql` (RLS + policies).
  - **Path B — Prisma:** `prisma migrate deploy` against the prod `DATABASE_URL`
    (schema), then apply the RLS once via the SQL editor
    (`supabase/security` SQL / the `…_security_lockdown.sql` body).

> ⚠️ Never run both A and B against the same database — you'll get
> "relation already exists" / duplicate-object errors. This repo's CLI commands
> below assume **Path A** for the new prod project.

Going forward, every schema change must be reflected in **both** Prisma (so dev
stays the source of truth) **and** a new `supabase/migrations/<ts>_*.sql` (so the
CLI can carry it to prod). The simplest way to keep them in sync is to generate
the Supabase migration from Prisma:

```bash
# from apps/api — emit the delta for a new Supabase migration
pnpm exec prisma migrate diff \
  --from-url "$DEV_DATABASE_URL_BEFORE" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > ../../supabase/migrations/$(date -u +%Y%m%d%H%M%S)_<change>.sql
```

---

## 3. Supabase CLI — link the two projects

Install once (already available via `npx`): `npx supabase --version`.

Log in (opens a browser for an access token):

```bash
npx supabase login
```

The CLI links to **one** project at a time via `supabase link`. Switch between
dev and prod by re-linking. You'll be asked for that project's **database
password** (the one you set in the Supabase dashboard, also in each project's
`DATABASE_URL`).

```bash
# link to DEV
npx supabase link --project-ref deebcfzsgdwnmeoqphgm

# …or link to PROD
npx supabase link --project-ref fkyexcddvogkngbbrefz
```

`supabase link` writes the active ref to `supabase/.temp` (gitignored). Always
confirm which project you're pointed at before a push:

```bash
npx supabase projects list      # the linked one is marked ●
```

---

## 4. Push the schema Dev → Prod

The intended flow: migrations are authored/validated against **dev**, then
pushed to **prod**. With the baseline already in `supabase/migrations`:

```bash
# 1) make sure you are linked to PROD (the empty project)
npx supabase link --project-ref fkyexcddvogkngbbrefz

# 2) preview what will run, then apply
npx supabase db push --dry-run     # lists pending migrations, runs nothing
npx supabase db push               # applies baseline_schema then security_lockdown
```

`supabase db push` connects directly to the remote and records applied files in
`supabase_migrations.schema_migrations`, so re-runs are no-ops. (Only
`supabase db dump` / `db diff` / local `supabase start` need Docker — `db push`
does not.)

**Verify the lockdown after the first prod push** (Supabase → SQL Editor). Both
queries must return **zero rows**:

```sql
-- (1) any tenant table anon can SELECT with RLS off
SELECT t.relname FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relkind='r' AND t.relname<>'demo_requests'
  AND has_table_privilege('anon', t.oid, 'SELECT') AND t.relrowsecurity=false;

-- (2) any public table with RLS still disabled
SELECT t.relname FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relkind='r' AND t.relrowsecurity=false;
```

### Routine change after the baseline
1. Author the change with Prisma on dev (`prisma migrate dev`).
2. Generate the matching `supabase/migrations/<ts>_*.sql` (see §2 snippet).
3. Commit on `dev`, push, validate on the Preview deploy.
4. Merge `dev → main`.
5. `supabase link --project-ref fkyexcddvogkngbbrefz && supabase db push`.

---

## 5. Vercel — branch deployments

Two Vercel projects (one per Next.js app: `apps/admin`, `apps/landing-page`),
each with the monorepo root and the app's directory set as the Root Directory.
`apps/web` (Vite) deploys as a static build; `apps/api` (Fastify) is **not** a
Vercel app — host it on a long-running Node platform (Railway/Fly/Render).

**Git integration (per Vercel project):**
- Production Branch = `main`. A push to `main` → **Production** deploy.
- Any other branch (e.g. `dev`) → **Preview** deploy with its own URL.

**Environment variables (per Vercel project → Settings → Environment Variables):**
- Add each app's keys (from the templates) and scope them:
  - **Production** → the `fkyexcddvogkngbbrefz` (prod) values.
  - **Preview** (and Development) → the `deebcfzsgdwnmeoqphgm` (dev) values.
- This is how the same code talks to the prod DB on `main` and the dev DB on
  `dev` with zero code changes. `VITE_`/`NEXT_PUBLIC_` vars are inlined at build,
  so a Preview build automatically points at dev.

**Cutover checklist for the first prod release:**
1. Prod Supabase provisioned (`supabase db push`) and lockdown verified (§4).
2. Prod env vars set in each Vercel project (Production scope) and the api host —
   including a fresh `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` (the admin edge
   middleware fails closed without the secret + `ADMIN_USERNAME`).
3. Supabase Auth (prod project): add the prod `${APP_URL}/set-password` to the
   allowed redirect URLs; set the invite email template; disable public signups.
4. Merge `dev → main` → Production deploy. Smoke-test login, a lead submit, and
   one club-scoped read.

---

## 6. Secrets hygiene

- Only `*.example` env files are committed. Real `.env` / `.env.local` are
  gitignored — never commit a filled-in copy.
- Prod gets **fresh** secrets (DB password, admin password/secret, a dedicated
  Upstash database) — never the dev values.
- The service-role key is server-only; it must never appear in a `VITE_` or
  `NEXT_PUBLIC_` variable.
