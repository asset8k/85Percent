# 85Percent Vercel Deployment

85Percent uses three Vercel projects from one monorepo. Railway and the former
standalone Fastify service are retired.

## Projects

| App | Directory | Package | Domain | Responsibility |
|---|---|---|---|---|
| Landing | `apps/landing-page` | `@85percent/landing-page` | `85percent.pro` | Marketing and lead capture |
| Web | `apps/web` | `@85percent/web` | `app.85percent.pro` | Main product SPA |
| Admin/API | `apps/admin` | `@85percent/admin` | `admin.85percent.pro` | Admin UI and `/api/*` Route Handlers |

The main web app keeps browser requests same-origin at `/api`. Its Vercel
rewrite forwards those requests to the admin/API project:

```json
{
  "source": "/api/:path*",
  "destination": "https://admin.85percent.pro/api/:path*"
}
```

## Project Settings

For each Vercel project:

- Import the same GitHub repository.
- Set Root Directory to the app directory.
- Enable source files outside Root Directory so workspace packages are visible.
- Use Node.js 20 or newer.
- Keep the tracked app-specific `vercel.json` install/build commands.
- Production branch is `main`; use Preview values for non-production branches.

The admin catch-all API Route Handler exports Node runtime, dynamic execution,
and `maxDuration = 300`. Maintenance work scheduled with `waitUntil` shares
that function duration and is cancelled by Vercel if it exceeds the limit.

## Environment Variables

### Landing

```text
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_ANON_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

The landing project uses only the Supabase anonymous key and can insert lead
rows through RLS. Upstash enforces three submissions/hour/IP.

### Web

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Vite variables are bundled into the browser. Never put a service-role or other
server secret here.

### Admin And API

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
ADMIN_USERNAME=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
APP_URL=https://app.85percent.pro
INTERNAL_JOB_SECRET=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
FOOTBALL_DATA_API_KEY=
TRANSFERMARKT_API_URL=
TRANSFERMARKT_SYNC_DELAY_MS=3000
```

`DATABASE_URL` is needed only for Prisma CLI schema operations, not normal API
runtime calls. `API_BASE_URL` can be omitted on Vercel; the admin derives its own
deployment URL when triggering maintenance routes.

The same rotated Upstash database can back landing and API limits, but its
credentials must be configured independently in both Vercel projects.

Every Vercel build runs `scripts/validate-vercel-env.mjs` before compiling the
application. The build fails if a critical variable is missing, blank, still a
placeholder, or if a production deployment points at the development Supabase
project. Admin production builds also require the canonical web `APP_URL`.
Encrypted Vercel values cannot be read back through `vercel env pull`; verify
their presence with `vercel env ls` and rely on the build validator to inspect
the injected values without printing them.

`TRANSFERMARKT_API_URL=http://localhost:8000` works only on a developer machine.
Production template sync requires a reachable HTTPS endpoint and must finish
inside the configured function duration.

## DNS

Namecheap records:

| Type | Host | Target | Project |
|---|---|---|---|
| A | `@` | Value shown by Vercel | Landing |
| CNAME | `www` | Value shown by Vercel | Landing |
| CNAME | `app` | Value shown by Vercel | Web |
| CNAME | `admin` | Value shown by Vercel | Admin/API |

The old `api` Railway CNAME is no longer used and should be removed after the
admin-hosted API is verified in production. No new `api.85percent.pro` service
is required by the application.

## Deployment Order

1. Configure Preview and Production environment variables in all three Vercel
   projects. Rotate any credential previously pasted into chat or logs. A
   deployment must pass the environment validator before its application build.
2. Deploy admin/API first and verify `GET /api/health`.
3. Verify an unauthenticated `GET /api/me` returns 401 JSON, not an admin login
   redirect.
4. Deploy web and verify its `/api/health` rewrite reaches admin.
5. Deploy landing and submit a lead; verify the fourth request from one IP gets
   HTTP 429.
6. Verify login, roster, scenarios, SSR, invitations, notifications, AI stream,
   and both maintenance jobs against a non-production workspace.
7. Remove the old Railway service and obsolete `api` DNS only after the Vercel
   API passes those checks.

## Security Checks

- Admin page middleware deliberately excludes `/api`; each API endpoint applies
  Supabase bearer-token auth or the internal job secret itself.
- The service-role key is server-only and bypasses RLS. Tenant handlers must
  continue filtering every tenant-owned query by `club_id`.
- Upstash is mandatory in production. The API returns 503 rather than running
  without distributed rate limiting when its Upstash variables are absent.
- Real `.env` files are gitignored and must never be committed.
