# Manual Football Data Sync

## Purpose

The admin Data Sync area reconciles public football data into the onboarding
template library. It supports selected-club squad/head-coach imports and atomic
Premier League or Championship standings updates. Every run is started manually;
there are no cron, scheduled, or recurring imports.

This is a reconciliation system, not a roster replacement. Provider data is
normalised, validated, matched, staged, and diffed before safe changes are
applied.

## Execution Architecture

Production uses QStash because a 44-club refresh cannot safely fit into one
Vercel request. The admin API creates a `data_import_runs` row and one
`data_import_tasks` row per selected club or league, then publishes one signed
QStash message per task. QStash flow control limits global import concurrency to
two tasks by default. Closing the browser or restarting a Vercel instance does
not lose the durable database state or queued messages.

Each callback claims its task atomically, processes only that task, and updates
Supabase after every stage. Duplicate delivery is harmless because only a
`QUEUED` task can be claimed. A partial run retains successful tasks and can
retry failed tasks without rerunning them.

Alternatives considered:

- Vercel Workflows was not already part of this project and would add another
  platform-specific runtime.
- GitHub `workflow_dispatch` is less integrated with admin authentication,
  progress, cancellation, and review.
- `waitUntil`, an in-memory queue, browser sequencing, and one long request do
  not provide sufficient durability.

In development, omitting `QSTASH_TOKEN` executes tasks in the admin process. Use
one club and fixture providers for automated tests. Production fails closed if
QStash is not configured.

## Data Model

- `data_import_runs`: requestor, type, provider, configuration, aggregate
  progress, timestamps, cancellation, and terminal result.
- `data_import_tasks`: one durable unit of work with club/league identity,
  stage, attempts, counts, safe error, source snapshot, duration, and heartbeat.
- `data_import_changes`: staged ADD/UPDATE/MISSING/CONFLICT differences and their
  AUTO_APPLY/NEEDS_REVIEW/APPLIED/APPROVED/REJECTED decisions.
- `external_source_mappings`: stable provider IDs mapped to internal clubs,
  players, and coaches.
- `league_table_snapshots`: immutable standings snapshots with one atomically
  selected active snapshot per league.

The migration also installs service-role-only RPCs for task claiming, run
refresh, atomic safe roster application, and atomic standings publication. RLS
is enabled with no browser policies.

## Provider Boundaries

`SquadProvider` and `StandingsProvider` adapters return Zod-validated canonical
DTOs. Provider parsing is separate from matching, validation, persistence,
financial calculations, and UI code.

- Transfermarkt adapter: club discovery, players, squad numbers, coach, and
  public contract/profile fields.
- football-data.org adapter: complete PL and Championship standings.

Requests use a timeout, bounded exponential retries, `Retry-After`, explicit 429
handling, provider 4xx/5xx classification, and response validation. Ordinary
logs and errors do not contain credentials, authorization headers, raw HTML, or
private database records.

Transfermarkt access is unofficial and operationally fragile. Confirm the
configured adapter and any direct-page access comply with provider terms and
club policy before production use; this workflow does not bypass access controls.

## Field Ownership

Provider-owned public fields that may be applied when actually returned:

- Name
- Position
- Squad number
- Nationality
- Date of birth
- Joined date
- Public contract start/end
- Club logo

85Percent/manual financial and accounting fields are never overwritten:

- Weekly wage or manager compensation
- Transfer fee
- Current/carried book value
- Agent or negotiation fee
- Amortisation treatment
- Extension-signed date
- Contract and wage phases
- Accounting corrections

Missing provider values mean unknown, not zero. Provider payload keys such as a
zero wage or fee are stripped by the canonical DTO. New players are created
with public fields and `estimated_transfer_fee = NULL`, which marks the template
financial data as unconfigured under the current onboarding policy. The import
does not change a tenant's live roster or financial records.

## Matching And Review

Players are matched in this order:

1. Existing provider external-ID mapping.
2. Normalised exact full name plus exact date of birth.
3. Normalised exact full name plus at least two strong attributes: position,
   squad number, or nationality.
4. Review when the identity is ambiguous or conflicts.

Accent, punctuation, and spacing normalisation support exact identity matching;
there is no fuzzy-name automatic merge. Returned public-field changes are
patched without replacing non-returned values.

A provider player ID already mapped to another stored club is treated as a
transfer conflict, not an automatic addition. Both stored club records remain
unchanged until review.

An internally stored player missing from one response is a `MISSING` review
item. They are never archived or deleted automatically. A different head coach
is a `CONFLICT` review item; the current coach remains until an administrator
approves replacement. Safe additions and unambiguous public-field updates apply
automatically.

## Standings Safety

Premier League responses must contain exactly 20 clubs and Championship
responses exactly 24. Validation requires unique source IDs and positions, a
complete position sequence, valid match/goal totals, the requested competition,
and one internal mapping per source club. Publication happens in one Postgres
function. Any validation or write failure preserves the previous active table.

## Admin Workflow

Use **Admin → Data Sync**:

- **Squads & Coaches** groups the 44 clubs by league, supports search/filter,
  bounded multi-select, last success/result, warnings, and result links.
- **League Tables** shows current snapshot metadata, last run result, the
  imported table, and one manual update button per league.
- A run page polls Supabase-backed APIs every 2.5 seconds and shows durable
  stage, progress, active tasks, elapsed time, estimated remaining time after at
  least two durations, review items, cancellation, and retry controls.

Cancellation marks queued tasks cancelled and lets a request already in flight
finish before it observes cancellation. Retry resets failed tasks only. The
partial unique database index prevents simultaneous active imports for one club.

Defaults, all environment-overridable:

```text
DATA_IMPORT_MAX_CLUBS_PER_RUN=10
DATA_IMPORT_MAX_CONCURRENT_TASKS=2
DATA_IMPORT_MAX_TASK_ATTEMPTS=3
DATA_IMPORT_REQUEST_TIMEOUT_MS=20000
DATA_IMPORT_RETRY_BASE_MS=1500
```

## Environment And Deployment

Production admin/API variables:

```text
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
DATA_IMPORT_CALLBACK_URL=https://admin.85percent.pro/api/data-imports/task
FOOTBALL_DATA_API_KEY=
TRANSFERMARKT_API_URL=https://<reachable-adapter>
TRANSFERMARKT_WEB_URL=https://www.transfermarkt.com
```

Apply `apps/admin/prisma/migrations/20260805000003_manual_data_imports` once to
each target database through the normal Prisma migration history. Do not also
apply the aggregate Supabase baseline to an already migrated database.

After deployment:

1. Confirm the QStash callback URL is the admin production domain.
2. Start one non-production club import and refresh/leave/reopen the run page.
3. Confirm public fields change while financial fields remain untouched.
4. Exercise cancellation, a simulated retryable provider error, and review.
5. Update one league and inspect the imported table.
6. Submit an invalid fixture and confirm the previous active snapshot remains.

## Verification

Provider tests use local fetch fixtures and include success, rate limiting, and
normalisation. Matching and import-contract tests cover financial stripping,
unknown versus explicit zero, minimum squad validation, missing-player review,
coach conflict review, and database-function write boundaries. Standings tests
cover both league sizes, duplicate/missing positions, invalid totals, mappings,
and atomic-publication SQL. UI-model tests cover selection limits and ETA.

Database-backed staging/RPC integration and live-provider smoke tests require a
configured non-production Supabase project and must be run before production
use; automated tests must not scrape live providers by default.
# Local Admin Data Sync

Data Sync can run entirely from a local admin process. It does not require a public Transfermarkt adapter.

## Local workflow

1. Configure `apps/admin/.env.local` with the target databases. Do not put these values in client-side variables:

```sh
DATA_IMPORT_DISPATCH_MODE=local
DATA_IMPORT_TARGETS=dev,prod
DATA_IMPORT_DEFAULT_TARGET=dev
DATA_IMPORT_TARGET_DEV_LABEL=Development
# Existing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are used for Development.
DATA_IMPORT_TARGET_PROD_LABEL=Production
DATA_IMPORT_TARGET_PROD_IS_PRODUCTION=true
DATA_IMPORT_TARGET_PROD_SUPABASE_URL=...
DATA_IMPORT_TARGET_PROD_SUPABASE_SERVICE_ROLE_KEY=...
TRANSFERMARKT_API_URL=http://localhost:8000
```

2. Choose the target before the admin starts:

```sh
pnpm data-sync:local       # prompts for Development or Production
pnpm data-sync:local:dev   # starts against Development
pnpm data-sync:local:prod  # starts against Production
```

3. Open `http://localhost:4000/data-sync/squads`, select clubs, and start the run.

The startup target is server-side only: browser code receives a target ID and display label, never Supabase credentials. The selected target is stored in the import run configuration and is used again by polling, retry, cancellation, and review actions. Each local admin process is limited to its chosen target, so a Development session cannot accidentally switch to Production mid-run.

In local mode, the admin server starts the durable task worker in-process. The browser only initiates and observes a run; closing the browser does not stop it. Keep the laptop, admin server, and adapter running until work completes. If the local process is interrupted, a stale running task is marked as an interrupted, retryable failure before the next run starts; successful tasks are preserved and only failed tasks are retried.

Production selection is deliberately marked in amber and requires confirmation before an import is started. It writes approved template data to the selected production database. No live import is initiated by setup or verification commands.

## Adapter controls

The adapter is cached outside the repository at `~/Library/Caches/85percent/transfermarkt-api` (or `$XDG_CACHE_HOME`).

```sh
pnpm data-sync:adapter:setup
pnpm data-sync:adapter:start
pnpm data-sync:adapter:status
pnpm data-sync:adapter:stop
```

`setup` checks Docker/Colima, clones or fast-forwards the adapter cache, and builds `transfermarkt-api:local`. `start` only removes/replaces the `tmkt-api` container, never unrelated containers. It refuses to take over port 8000. `status` checks Docker, Colima, image/container state, port 8000, and an actual club-discovery endpoint. `stop` only stops/removes `tmkt-api`.

The admin performs the same provider discovery check before creating a squad run. An unavailable adapter returns HTTP 503; invalid provider data returns 422; a 409 is reserved for a real import-state conflict.

## QStash mode

Set `DATA_IMPORT_DISPATCH_MODE=qstash` only for a deployed worker with `QSTASH_TOKEN` and signing keys. QStash sends a task ID to the HTTPS admin worker; it must never target `localhost`. A production deployment configured for local dispatch fails closed.
