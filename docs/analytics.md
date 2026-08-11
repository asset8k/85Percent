# PostHog Analytics

The landing page and authenticated product report to one PostHog project. The
admin application does not load PostHog.

## Vercel configuration

Configure these browser-safe variables in both the landing-page and web Vercel
projects. Values must explicitly label the environment that is reporting:

| Application | Required variables |
| --- | --- |
| `apps/landing-page` | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_POSTHOG_ENABLED=true`, `NEXT_PUBLIC_POSTHOG_ENVIRONMENT` |
| `apps/web` | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_POSTHOG_ENABLED=true`, `VITE_POSTHOG_ENVIRONMENT` |

Use the same PostHog project ingestion key and host in both applications for a
given environment. Do not place a PostHog personal API key or any other secret
in browser-prefixed variables.

- Vercel Production: set the environment variable to `production`. Capture is
  restricted to `https://85percent.pro` and `https://app.85percent.pro`.
- Local development: set it to `development` in each ignored `.env.local`.
  Capture is restricted to `localhost` and `127.0.0.1` and must be explicitly
  enabled.
- Vercel Preview: do not configure the PostHog variables. Analytics remains
  disabled if the variables are absent, incomplete, or use an unsupported
  environment label.

Every capture carries `deployment_environment` (`development` or `production`),
allowing the PostHog project to be filtered without mixing local validation
with live product analytics.

`https://us.i.posthog.com` is the default cloud host. Use the host for the
actual PostHog project if it is in another region.

## Privacy and behaviour

- Analytics are initialized once per frontend with explicit pageviews; the web
  SPA sends a pageview on each client-side navigation.
- Analytics requires an explicit enabled flag, a valid environment label, and
  a permitted hostname. Production is restricted to the exact HTTPS production
  hostnames; development is restricted to `localhost` and `127.0.0.1`.
- The two production subdomains use PostHog's normal cross-subdomain
  persistence so one visitor is not split into two projects.
- URLs have tokens, auth codes, email parameters, and fragments removed before
  capture. Automatic click capture is disabled; business events are explicit.
- All form inputs are masked. Authenticated page content uses `ph-sensitive`;
  the Analyst drawer/fullscreen uses `ph-no-capture`, so prompts, responses,
  RAG context, and financial analysis do not enter events or session replay.
- Product identity is the Supabase user UUID. The app sets non-financial user
  and workspace metadata only, and resets PostHog on logout.
