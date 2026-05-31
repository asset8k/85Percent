# Template Sync via Docker — Runbook

How to refresh the **template roster library** (`template_clubs` / `template_roster_items`) by
running the `felipeall/transfermarkt-api` locally in Docker and pointing the background
sync worker at it.

> **Why local Docker?** The public demo (`https://transfermarkt-api.fly.dev`) sits behind
> Cloudflare and **rate-limits** a 44-club burst — you get intermittent `HTTP 405`s and most
> clubs fail. The image's own app-level limiter is **disabled by default**, so a locally-run
> instance has no throttling and the full 44-club sync completes cleanly in ~3 minutes.

The worker is **bio-only**: it ingests names, positions, nationalities, DOBs, contract dates,
shirt numbers, and the head coach. It ingests **no financials** — transfer fees and wages are
left null/0 for the CFO to enter. See [BUILD_LOG.md](BUILD_LOG.md) for the rationale.

---

## TL;DR (the four commands)

```bash
# 1. Start the Docker runtime (Colima) — only if not already running
colima start --cpu 2 --memory 4

# 2. Run the API (builds the image the first time — see below)
docker run -d -p 8000:8000 --name tmkt-api transfermarkt-api:local

# 3. Run the full 44-club sync against it
cd apps/api
TRANSFERMARKT_API_URL=http://localhost:8000 TRANSFERMARKT_SEASON_ID=2025 \
  node --import tsx --env-file=.env src/scripts/sync-templates.ts

# 4. Tear down when done
docker rm -f tmkt-api && colima stop
```

---

## One-time setup

### Prerequisites
- **Homebrew** (`/opt/homebrew/bin/brew`)
- This machine has **no Docker Desktop** and `sudo` is password-gated, so we use **Colima**
  (a CLI-only Docker runtime — no GUI, no admin rights, no license prompt).

### Install Colima + the Docker CLI
```bash
brew install colima docker
```
- `colima` — runs the Docker daemon inside a lightweight Linux VM.
- `docker` — the standard CLI; it talks to Colima's daemon automatically.

Verify:
```bash
colima version   # e.g. 0.10.1
docker --version # e.g. 29.x
```

### Build the API image (the published image does NOT exist)
`felipeall/transfermarkt-api` is **not** on Docker Hub — the project's `docker run` line
assumes you build it from source. Do this once:

```bash
# Start Colima first (the daemon must be up to build)
colima start --cpu 2 --memory 4

# Clone + build (tagged transfermarkt-api:local)
cd /tmp
git clone --depth 1 https://github.com/felipeall/transfermarkt-api.git
cd transfermarkt-api
docker build -t transfermarkt-api:local .
```

The image is ~262 MB (Python 3.9-slim + FastAPI deps). The build takes a few minutes
(mostly `pip install`). You only rebuild it if you want a newer upstream version.

---

## Running a sync (the repeatable part)

### 1. Bring the runtime up
```bash
colima start --cpu 2 --memory 4   # ~30s if the VM image is already downloaded
```
The **first ever** `colima start` downloads a Linux VM image (~500 MB) and takes several
minutes; subsequent starts are fast.

### 2. Start the API container
```bash
docker rm -f tmkt-api 2>/dev/null   # clear any stale container
docker run -d -p 8000:8000 --name tmkt-api transfermarkt-api:local
```

Wait for it to be ready, then smoke-test:
```bash
# root redirects to /docs (HTTP 307); a real endpoint returns JSON
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/
curl -s "http://localhost:8000/clubs/405/players?season_id=2025" | head -c 200
```
The second call should return Aston Villa's squad JSON (Emiliano Martínez, …).

### 3. Run the sync worker
```bash
cd apps/api
TRANSFERMARKT_API_URL=http://localhost:8000 TRANSFERMARKT_SEASON_ID=2025 \
  node --import tsx --env-file=.env src/scripts/sync-templates.ts
```
- `--env-file=.env` supplies `DATABASE_URL` + Supabase keys (the worker writes to the live
  `template_*` tables via the service-role client).
- Expect: `done — 44 clubs synced, 0 failed, ~1318 roster items cached.`
- Per club it makes: **1** API call (squad) + **1** API call (logo) + **1** HTML fetch
  (shirt numbers, kader page) + **1** HTML fetch (head coach, staff page).
- A 3 s delay runs between clubs (anti-Cloudflare for the HTML fetches, which still hit
  `transfermarkt.com` directly — see env vars).

### 4. Tear down
```bash
docker rm -f tmkt-api   # stop + remove the container
colima stop             # shut down the VM (frees CPU/RAM); image is kept for next time
```

---

## Sync worker environment variables

All optional; sensible defaults in [apps/api/src/scripts/sync-templates.ts](apps/api/src/scripts/sync-templates.ts).

| Variable | Default | Purpose |
|---|---|---|
| `TRANSFERMARKT_API_URL` | `http://localhost:8000` | felipeall API base (the JSON squad/logo data) |
| `TRANSFERMARKT_SEASON_ID` | derived from today | Season start year, e.g. `2025` for 2025-26 |
| `TRANSFERMARKT_WEB_URL` | `https://www.transfermarkt.com` | Site base for the native HTML scrapes (coach + shirt numbers) |
| `TRANSFERMARKT_SYNC_DELAY_MS` | `3000` | Delay between clubs (anti-Cloudflare) |
| `TRANSFERMARKT_TIMEOUT_MS` | `20000` | Per-request timeout |
| `TRANSFERMARKT_MAX_RETRIES` | `3` | Retries on 405/408/425/429/5xx (exponential backoff) |
| `TRANSFERMARKT_RETRY_BASE_MS` | `1500` | First backoff (then 3 s, 6 s, …) |
| `TRANSFERMARKT_FETCH_MANAGER` | on | Set `0` to skip the head-coach scrape |
| `TRANSFERMARKT_FETCH_SQUAD_NUMBERS` | on | Set `0` to skip the kader shirt-number scrape |

> **Note:** the felipeall **API** runs locally (no rate limit), but the shirt-number and
> head-coach scrapes still hit **transfermarkt.com directly** over the public internet.
> The 3 s inter-club delay + retry/backoff keep those within tolerance. If you ever see
> `405`s in the log, they're from transfermarkt.com (HTML), not your local container.

---

## What lands in the database

- **Players** → `template_roster_items` (`is_manager = false`): name, position, nationality,
  DOB, contract start/end, **squad_number** (from the kader page), **financials null**.
- **Head coach** → one `template_roster_items` row (`is_manager = true`): name, nationality,
  appointed/contract dates, **financials null**. Skipped gracefully if the staff page can't be
  parsed (e.g. Liverpool / Watford have come back without one — this is expected and safe).
- **Club** → `template_clubs`: name, league, logo URL.

Onboarding (`POST /onboarding/complete`) clones these into a tenant's live `players` /
`contracts` / `managers` / `manager_contracts` with wages forced to 0.

### Quick verification query
```bash
cd apps/api
node --import tsx --env-file=.env -e '
import { supabase } from "./src/lib/supabase.js"
const c = (b) => b.then(r => r.count)
console.log("clubs   ", await c(supabase.from("template_clubs").select("id",{count:"exact",head:true})))
console.log("items   ", await c(supabase.from("template_roster_items").select("id",{count:"exact",head:true})))
console.log("managers", await c(supabase.from("template_roster_items").select("id",{count:"exact",head:true}).eq("is_manager",true)))
process.exit(0)
'
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `pull access denied for felipeall/transfermarkt-api` | The image isn't on Docker Hub. **Build from source** (see one-time setup). |
| `Cannot connect to the Docker daemon` | Colima isn't running → `colima start`. |
| Sync log shows repeated `HTTP 405` | You're pointed at the **public** API (`fly.dev`) or transfermarkt.com is throttling the HTML scrapes. Use the local container for the API; slow down with a higher `TRANSFERMARKT_SYNC_DELAY_MS` for the HTML side. |
| `colima start` hangs on "downloading disk image" | First-run VM image download (~500 MB). Wait it out; it's cached afterwards. |
| A club logs `no head coach parsed` | Expected for clubs whose staff page doesn't match the parser. The club still syncs; it just has no manager row. |
| Want a clean rebuild | `docker rm -f tmkt-api && docker rmi transfermarkt-api:local`, then rebuild. |

---

## Tests

The scrapers/mappers are pure and unit-tested (no network):
```bash
pnpm --filter @headroom/api test:scripts       # mappers + coach + squad-number parsers
pnpm --filter @headroom/api test:onboarding    # DB-backed hydration over the cached library
```
