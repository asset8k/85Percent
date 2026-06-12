# 85Percent — Environments (dev vs prod)

The decision, once and for all: **develop against DEV data locally, and only ever
touch PROD data on the production domain.** There is no hosted "staging" in
between — local *is* the dev environment.

| | **Development** | **Production** |
|---|---|---|
| Where | your machine (`pnpm dev`) | `app.85percent.pro` / `admin.85percent.pro` / `85percent.pro` |
| Supabase | dev `deebcfzsgdwnmeoqphgm` (Frankfurt) | prod `fkyexcddvogkngbbrefz` (Frankfurt) |
| Web API calls | Vite proxy → local Fastify (`localhost:3001`) | `vercel.json` rewrite → Railway (`api.85percent.pro` / current Railway URL) |
| Config source | each app's local `.env` / `.env.local` (gitignored) | Vercel **Production** env + Railway service vars |
| Git branch | `dev` (work happens here) | `main` (auto-deploys) |

## Why local = dev automatically

- The local `.env` files (`apps/api/.env`, `apps/web/.env.local`, `apps/admin/.env`,
  `apps/landing-page/.env.local`) all point at the **dev** Supabase project. They
  are gitignored, so prod secrets never live on your machine.
- When you run `pnpm dev`, the web app (Vite, `:5173`) proxies `/api` to your
  **local** Fastify (`:3001`) — *not* to Railway. That local API reads the dev
  `DATABASE_URL`/Supabase keys. So the whole local stack is dev end to end.
- The `vercel.json` rewrite that points the web app at the Railway (prod) API
  only applies to **Vercel deployments**, never to local Vite dev.

> Auth consistency rule: a web build's `VITE_SUPABASE_*` keys and the API it
> talks to must be the **same** Supabase project — a JWT minted by one project
> won't validate against another. Local uses dev for both; prod uses prod for
> both. This is the main reason we don't run a half-hosted preview (see below).

## Why there is no hosted staging / preview

The web app's API URL is baked into `apps/web/vercel.json` (points at prod
Railway). A Vercel *preview* build would therefore mix dev auth with the prod
API — broken and confusing — and we have no separate dev API host. So:

- All three Vercel projects are set to **deploy the production branch only**
  (Ignored Build Step: build iff `VERCEL_ENV=production`). Pushing `dev` does
  **not** create a preview deployment.
- Railway deploys only the `main` branch.

If we ever want a real hosted staging environment, it needs its own API host +
dev-scoped env on all projects + a non-hardcoded API URL. Out of scope today.

## Day-to-day workflow

```
# develop + test locally against DEV data
git checkout dev
pnpm dev                      # web:5173, api:3001, admin:4000, landing:3100 → dev Supabase
# … commit on dev …

# ship to PRODUCTION (prod data, the live domains)
git checkout main && git merge --no-ff dev && git push origin main
#   → Vercel (3 apps) + Railway (API) auto-deploy to production
```

You never run prod data locally, and `dev`-branch work never reaches a live
URL until it's merged to `main`.

## Schema changes (the one manual step)

Supabase is **not** connected to GitHub on purpose — a code push must never
auto-alter the production database. Apply schema/RLS changes deliberately:
author on dev, then carry to prod via `supabase db push` (or the SQL editor).
See [DEPLOYMENT_SOP.md](DEPLOYMENT_SOP.md) §2.
