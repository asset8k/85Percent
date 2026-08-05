# Transfermarkt Adapter via Docker

This runbook starts the unofficial `felipeall/transfermarkt-api` adapter used by
the manual **Data Sync > Squads & Coaches** workflow.

The old bulk template-sync script has been removed. Do not invoke a local script
to update all 44 clubs. An administrator starts imports in the admin UI; QStash
delivers one durable task per club and Supabase stores progress and review data.

See [data-import-sync.md](data-import-sync.md) for the import architecture,
field-ownership rules, deployment variables, and recovery procedures.

## Important Production Constraint

`TRANSFERMARKT_API_URL` must be a stable HTTPS endpoint reachable from Vercel and
QStash. A container running on a developer laptop is suitable only for local
development. Production imports must not depend on that laptop remaining online.

Transfermarkt access is unofficial and operationally fragile. Confirm provider
terms before production use and keep import concurrency low.

## Local Setup

The upstream image is not published on Docker Hub, so build it from source:

```bash
colima start --cpu 2 --memory 4

cd /tmp
git clone --depth 1 https://github.com/felipeall/transfermarkt-api.git
cd transfermarkt-api
docker build -t transfermarkt-api:local .
```

Start and verify the adapter:

```bash
docker rm -f tmkt-api 2>/dev/null || true
docker run -d -p 8000:8000 --name tmkt-api transfermarkt-api:local

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/
curl -s "http://localhost:8000/clubs/405/players?season_id=2026" | head -c 200
```

Configure `apps/admin/.env.local`:

```dotenv
TRANSFERMARKT_API_URL=http://localhost:8000
TRANSFERMARKT_SEASON_ID=2026
```

Run the admin application and start a small import from **Data Sync > Squads &
Coaches**. When QStash is not configured outside production, the local dispatcher
executes the selected task through the same worker service without requiring a
real provider call in automated tests.

## Supported Adapter Settings

| Variable | Default | Purpose |
|---|---:|---|
| `TRANSFERMARKT_API_URL` | `http://localhost:8000` | JSON squad-provider base URL |
| `TRANSFERMARKT_SEASON_ID` | current season | Season start year, for example `2026` |
| `TRANSFERMARKT_WEB_URL` | `https://www.transfermarkt.com` | HTML source for squad numbers and coach data |
| `TRANSFERMARKT_TIMEOUT_MS` | `20000` | Per-request timeout |
| `TRANSFERMARKT_MAX_RETRIES` | `3` | Bounded retries for rate limits and transient failures |
| `TRANSFERMARKT_RETRY_BASE_MS` | `1500` | Initial exponential-backoff delay |

The provider may return public roster and contract facts. It does not own wages,
fees, book values, amortisation treatments, internal contract phases, or other
manual accounting data. Missing provider values remain unknown and never become
numeric zero.

## Shut Down

```bash
docker rm -f tmkt-api
colima stop
```

## Troubleshooting

| Symptom | Cause / action |
|---|---|
| `pull access denied` | Build `transfermarkt-api:local` from source. |
| Docker daemon unavailable | Start Colima. |
| Provider returns `405` or `429` | Reduce concurrency, wait for the retry window, and retry only failed clubs. |
| Club mapping missing | Add or correct its provider mapping in Supabase before retrying. |
| Partial squad response | The task fails validation; the current template roster remains unchanged. |

Automated provider tests use fixtures and do not scrape the live service:

```bash
pnpm --filter @85percent/admin test
```
