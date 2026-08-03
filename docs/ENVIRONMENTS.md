# 85Percent Environments

Local development uses development data. Production domains use production
data. There is no separate long-running API host.

| | Development | Production |
|---|---|---|
| Git branch | `dev` | `main` |
| Main web | `localhost:5173` | `app.85percent.pro` |
| Admin + API | `localhost:4000` | `admin.85percent.pro` |
| Landing | `localhost:3100` | `85percent.pro` |
| Web API path | Vite proxy to `:4000/api/*` | Vercel rewrite to admin `/api/*` |
| Database | development Supabase | production Supabase |
| Rate limits | development Upstash | production Upstash |

## Local Configuration

The local files are gitignored:

- `apps/web/.env.local`
- `apps/admin/.env.local`
- `apps/landing-page/.env.local`

The admin file owns all backend credentials because the API Route Handlers run
inside that Next.js project.

`pnpm dev` starts three applications. Main-app requests remain same-origin at
`/api`; Vite proxies them to `http://localhost:4000` without removing the
`/api` prefix.

The web browser Supabase variables and the admin API Supabase variables must
always point to the same project. A JWT minted by one Supabase project cannot be
validated by another.

## Vercel Configuration

There are three Vercel projects: landing, web, and admin. The admin project owns
both its private control-panel pages and the platform API Route Handlers.

Use separate Preview and Production environment values:

- Preview/development values target development Supabase and Upstash.
- Production values target production Supabase and a production Upstash DB.
- Never expose service-role, Anthropic, admin-session, or Upstash tokens through
  `VITE_` or `NEXT_PUBLIC_` names.

The web Vercel rewrite sends `/api/:path*` to
`https://admin.85percent.pro/api/:path*`. Preview deployments need an equivalent
preview-aware destination before they can be considered isolated staging.

## Branch Workflow

```bash
git checkout dev
pnpm dev
pnpm typecheck
pnpm test
pnpm build

# after local verification and review, promote dev to main manually
```

This repository does not automatically alter Supabase when code deploys. Apply
schema and RLS migrations deliberately as described in `DEPLOYMENT_SOP.md`.
