# Headroom — Build Log & Implementation Reference

> This file is the single source of truth for what has been built, how it works, and what comes next.
> Update it every time a meaningful step is completed. It is written to survive context compaction.

---

## Project in One Paragraph

Headroom is a B2B SaaS financial compliance platform for professional football clubs. It allows Club CFOs and Sporting Directors to simulate whether a proposed player transfer will keep the club compliant with the EFL Championship's Squad Cost Ratio (SCR) rule — a new regulation starting 2026/27 that caps squad spending at 85% of football-related revenue. Getting it wrong means financial levies or points deductions. The product replaces Excel spreadsheets and consultants with instant, accurate simulation software.

---

## Session 1 — MVP 1.0 Full Implementation (2026-05-24)

### What was accomplished

Built the entire MVP 1.0 codebase from scratch in a single session:

1. **Monorepo bootstrap** — pnpm + Turborepo workspace
2. **Shared package** — all TypeScript types, Zod schemas, league configs, money utilities
3. **Calculation engine** — pure SCR engine with 39 unit tests (all passing)
4. **Database schema** — full Prisma schema for PostgreSQL/Supabase
5. **API backend** — Fastify REST API with auth, club routes, simulation routes
6. **Frontend** — complete React 18 app (login, club setup, simulator, history, calendar, PDF export)

### Final state

- All 4 packages typecheck clean (zero TypeScript errors)
- Engine: 39/39 unit tests passing
- App is fully wired end-to-end but requires Supabase credentials to run
- No deployment done yet (Step 6.x)

---

## File Map — Every File and What It Does

### Root Level

| File | Purpose |
|------|---------|
| `package.json` | Root workspace config — `pnpm dev` / `pnpm test` / `pnpm build` runs all packages via Turborepo |
| `pnpm-workspace.yaml` | Declares `apps/*` and `packages/*` as workspace members. Has `allowBuilds` entries for esbuild, prisma, core-js |
| `turbo.json` | Turborepo task pipeline — build depends on `^build` (dependencies first), dev is persistent |
| `tsconfig.base.json` | Shared TS config inherited by all packages — strict mode, `noUncheckedIndexedAccess`, `bundler` resolution |
| `.prettierrc` | Semi=false, single quotes, 100 char width |
| `.gitignore` | Ignores: `node_modules`, `.turbo`, `dist`, `.env*`, `coverage` |
| `PLAN.md` | Step-by-step implementation checklist — updated with [x] as steps complete |
| `BUILD_LOG.md` | THIS FILE — full documentation for context continuity |
| `README.md` | Developer setup guide (install, env vars, Supabase setup, run dev) |

---

### `packages/shared/`

The shared package is built by `pnpm --filter @headroom/shared build` (runs `tsc`). Output goes to `dist/`. Imported by both `apps/api` and `apps/web` as `@headroom/shared`.

**`src/types.ts`** — Core TypeScript interfaces:
- `LeagueConfig` — all regulatory parameters for a league (thresholds, allowances, point deduction rules)
- `ClubFinancials` — a club's current financial position for a season (revenue, squad costs, allowance)
- `TransferInput` — proposed transfer parameters (fee, contract, wage, agent fee, optional player sale)
- `SCRResult` — full output of the engine (current position, projected position, sanctions, amortisation schedule)
- `AmortisationEntry` — single row of the amortisation schedule
- `UserRole` — union type: `'cfo' | 'sporting_director' | 'finance_analyst' | 'admin'`
- `ComplianceStatus` — `'green' | 'amber' | 'red'`

**`src/schemas.ts`** — Zod schemas for runtime validation:
- `LeagueConfigSchema` — validates a league config object
- `ClubFinancialsSchema` — validates club financials (season format: `YYYY-YY`)
- `TransferInputSchema` — validates a transfer (all values in pence)
- `TransferFormSchema` — frontend form schema (accepts weekly wages, validates in pounds)
- `ClubFinancialsInputSchema` — frontend setup form schema (accepts pounds, converts to pence in API)

**`src/configs.ts`** — Pre-built league config objects:
- `EFL_CHAMPIONSHIP_CONFIG` — 85% green, 30% initial allowance, £33M/£15M owner equity top-up, no SSR
- `PREMIER_LEAGUE_CONFIG` — 85% green, 30% initial allowance, no owner equity, has SSR
- `LEAGUE_CONFIGS` — dict keyed by `leagueId` string for dynamic lookup

**`src/money.ts`** — Monetary utility functions:
- `poundsToPence(pounds)` → integer pence (× 100, rounded)
- `penceToPounds(pence)` → pounds (÷ 100)
- `formatPence(pence)` → `'£1,250,000'` (Intl.NumberFormat, GBP, no decimals by default)
- `formatRatio(ratio)` → `'85.4%'` (ratio × 100, toFixed(1))
- `weeklyWageToAnnualPence(weeklyWagePounds)` → annual wage in pence (× 52 × 100)

**Important:** All monetary values in the engine, API, and DB are in **pence** (integers). Never floats. Conversion to pounds happens only in display/formatting functions.

---

### `packages/engine/`

The calculation engine. **Pure functions only** — no imports from DB, Supabase, or any I/O. Everything takes explicit inputs and returns deterministic outputs.

Run tests: `pnpm --filter @headroom/engine test`

**`src/thresholds.ts`** — `calculateThresholds(financials: ClubFinancials): Thresholds`
- Green = `floor(revenue × greenThresholdRatio)` (e.g. 85%)
- Red = `floor(green × (1 + currentAllowanceRatio))` (e.g. green × 1.30)
- **Note:** Uses `Math.floor` — float precision means `1700000000 * 1.15` in JS = `1954999999` not `1955000000`. This is correct and intentional.

**`src/status.ts`** — `determineStatus(squadCosts, thresholds): ComplianceStatus`
- Green: costs ≤ greenThreshold
- Amber: costs ≤ redThreshold (but > green)
- Red: costs > redThreshold

**`src/levy.ts`** — `calculateLevy(squadCosts, greenThreshold, revenue, greenThresholdRatio)`
- Formula: `overspend × (scrRatio - greenThresholdRatio)`
- Returns 0 if not in overspend
- All values in pence

**`src/points.ts`** — `calculatePointsDeduction(squadCosts, redThreshold, perUnit, basePoints)`
- Formula: `basePoints + floor(spendAboveRed / perUnit)`
- Returns 0 if not above red threshold
- basePoints = 6, perUnit = £6.5M in pence

**`src/allowance.ts`** — `calculateAllowanceUpdate(current, scrRatio, greenRatio, increment, initial)`
- Negative feedback: if SCR > greenRatio → `current - (scrRatio - greenRatio)`, floor 0
- Positive feedback: if compliant → `min(initial, current + increment)`

**`src/amortisation.ts`** — `generateAmortisationSchedule(fee, years, startSeason)`
- Spreads transfer fee equally over contract years
- Returns array of `{ season, amortisationAmount, remainingBookValue }`
- Season format: `'2026-27'`, `'2027-28'`, etc.
- Handles partial-year contracts (e.g. 3.5 years → 3 full years + 1 partial row)
- Returns empty schedule (all zeros) for free transfers

**`src/calculate.ts`** — `calculateSCR(financials, transfer, currentSeason): SCRResult`
- The main engine function — calls all the above
- Computes: current position → transfer cost impact → projected position → sanctions
- Net player sale profit (proceeds − book value) is added to revenue for threshold recalculation
- **Agent fee is spread over contract length** (regulatory requirement)
- Annual wage is taken as-is (caller must convert weekly → annual before calling)

**`tests/engine.test.ts`** — 39 tests covering:
- calculateThresholds (4 tests)
- determineStatus (5 tests, including edge cases at exact thresholds)
- calculateLevy (3 tests)
- calculatePointsDeduction (4 tests)
- calculateAllowanceUpdate (4 tests)
- generateAmortisationSchedule (6 tests, including partial-year and free transfer)
- calculateSCR full integration (13 tests, including green/amber/red outcomes, player sales, determinism)

---

### `prisma/schema.prisma`

PostgreSQL schema via Prisma. Connected to Supabase. Run with:
```bash
pnpm --filter @headroom/api exec prisma migrate dev
```

**Tables:**
- `clubs` — one row per club (id, name, short_name, league_id)
- `users` — one per user (id = Supabase auth.users id, club_id FK, role)
- `club_financials` — one per club per season (unique: clubId + season). All monetary values as `BigInt` (pence)
- `players` — player roster
- `contracts` — one active contract per player, all monetary as BigInt
- `simulations` — every simulation saved permanently. `transferInput`, `clubFinancialsSnapshot`, `scrResult` stored as JSONB snapshots. Never deleted.
- `audit_logs` — append-only, every write operation logged (user, club, table, action, before/after values)

**Multi-tenancy:** Every data table has a `club_id` FK. Supabase Row Level Security (RLS) must be applied in the Supabase dashboard — policies are NOT yet written (Step 3.4, pending).

---

### `apps/api/`

Fastify 5 REST API. TypeScript, ESM. Runs on port 3001.

**Dev:** `pnpm --filter @headroom/api dev` (uses tsx watch)

**`src/server.ts`** — Main entrypoint:
- Registers: helmet (security headers), cors (allows FRONTEND_URL origin), rate-limit (100/min default, 30/min on POST /simulations)
- Routes: `/club`, `/club/financials`, `/club/league-config`, `/simulations`
- Health check: `GET /health`

**`src/lib/prisma.ts`** — Single Prisma client instance (warn+error logging in dev, error-only in prod)

**`src/lib/supabase.ts`** — Supabase service role client (bypasses RLS for server-side admin operations). Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env.

**`src/middleware/auth.ts`** — `authMiddleware` preHandler:
- Reads `Authorization: Bearer <token>` header
- Validates token with `supabase.auth.getUser(token)`
- Looks up user in `users` table → attaches `request.userId`, `request.clubId`, `request.userRole`
- Returns 401/403 on failure

**`src/routes/club.ts`** — Club routes (all require auth middleware):
- `GET /club` — returns club row for request.clubId
- `GET /club/financials?season=2026-27` — returns ClubFinancials row (converts BigInt to number)
- `PUT /club/financials` — upserts financials, writes audit log. Input in pounds, stored as pence × 100. Allowed roles: cfo, admin, finance_analyst
- `GET /club/league-config` — returns LeagueConfig for club's league

**`src/routes/simulations.ts`** — Simulation routes:
- `POST /simulations` — fetches club + financials, runs `calculateSCR` engine, saves full snapshot + result. Returns `{ id, scrResult }`. Input: all in pence.
- `GET /simulations?page=1&limit=20` — paginated list, joins user for name
- `GET /simulations/:id` — single simulation, joins user
- `PATCH /simulations/:id/label` — update label, verifies club ownership

**`src/services/ai/index.ts`** — Empty stub. Architecture placeholder for MVP 3.0 LLM integration. Comment explains: LLMs must call the engine as a tool, never do arithmetic themselves.

**Environment variables required:**
```
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
FRONTEND_URL=http://localhost:5173
PORT=3001
NODE_ENV=development
```

---

### `apps/web/`

React 18 + Vite + TypeScript frontend. Port 5173. Vite proxies `/api/*` → `http://localhost:3001`.

**Dev:** `pnpm --filter @headroom/web dev`

#### Styling

Tailwind CSS with custom CSS variables (`src/index.css`):
- Background: `slate-950` (#0b0e17)
- Cards/surfaces: `slate-900`
- Borders: `slate-800`
- Text primary: `slate-100`, secondary: `slate-400`, muted: `slate-600`
- Accent (interactive, primary buttons): `green-500`
- Status green: `green-500`, amber: `amber-500`, red: `red-500`
- All numbers use `font-mono` (JetBrains Mono) via `.tabular-nums` class

#### File Structure

**`src/lib/supabase.ts`** — Supabase anon client (reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)

**`src/lib/api.ts`** — Typed API client:
- Reads session token from Supabase auth, attaches as Bearer header
- `api.club.get()` / `api.club.getFinancials()` / `api.club.updateFinancials()`
- `api.simulations.create()` / `.list()` / `.get()` / `.updateLabel()`
- Throws Error on non-OK responses

**`src/lib/pdf.ts`** — PDF export with jsPDF + jspdf-autotable:
- `exportSimulationPDF(sim, result)` — generates and saves PDF
- Includes: transfer inputs table, SCR position before/after, sanctions, amortisation schedule
- Legal disclaimer footer on every page
- Dark header (slate-950), professional layout

**`src/lib/utils.ts`** — `cn(...classes)` — clsx + tailwind-merge

**`src/stores/auth.ts`** — Zustand auth store (persisted to localStorage):
- `session`, `user`, `loading`
- `setSession(session)` — called on auth state change
- `signOut()` — calls supabase.auth.signOut(), clears state

**`src/stores/club.ts`** — Zustand club store (in-memory only):
- `clubId`, `clubName`, `leagueId`, `financials`, `currentSCRRatio`
- `setClub()`, `setFinancials()`, `setCurrentSCRRatio()`

**`src/App.tsx`** — Router setup:
- `/login` → LoginPage (public)
- Everything else wrapped in ProtectedRoute → AppLayout (Outlet)
- Routes: `/simulator`, `/history`, `/history/:id`, `/calendar`, `/setup`
- Default redirect: `/` → `/simulator`

**`src/components/auth/ProtectedRoute.tsx`**:
- On mount: calls `supabase.auth.getSession()`, subscribes to auth state changes
- If no session → redirect to `/login`
- On first load with session: fetches club data + financials, populates stores

**`src/components/layout/AppLayout.tsx`**:
- Fixed left sidebar (240px), main content area (ml-60), footer
- Footer always shows legal disclaimer text

**`src/components/layout/Sidebar.tsx`**:
- Headroom logo + wordmark
- Club name + current SCR status badge (live from store)
- Nav links: Transfer Simulator, Simulation History, Compliance Calendar, Club Setup
- Sign out button

#### UI Components (`src/components/ui/`)

- **`badge.tsx`** — `StatusBadge({ status })` — pill badge for green/amber/red with dot indicator
- **`button.tsx`** — variants: default (green-600), secondary (slate-700 border), ghost, destructive, link
- **`card.tsx`** — `Card`, `CardHeader`, `CardTitle`, `CardContent` — rounded-xl, border-slate-800, bg-slate-900
- **`input.tsx`** — supports `prefix` (e.g. `'£'`) and `suffix` (e.g. `'/wk'`) props, monospace numbers
- **`label.tsx`** — uppercase, letter-spaced, 12px, slate-400
- **`separator.tsx`** — 1px slate-800 horizontal line

#### Simulator Components (`src/components/simulator/`)

**`ComplianceGauge.tsx`** — Recharts horizontal bar chart:
- Two bars: "Current" and "Projected" SCR ratios
- Reference lines (dashed) at Green Threshold % and Red Threshold %
- Bar colour: green if ≤ green, amber if ≤ red, red if > red
- X-axis: 0% to max(120%, projected + 10%)
- Legend below chart

**`AmortisationTable.tsx`** — Year-by-year amortisation schedule table:
- Columns: Season, Annual Amortisation, Remaining Book Value
- Total row at bottom
- Shows "No amortisation" message for free transfers

**`SCRResultPanel.tsx`** — Full results display (reused on simulator page and history detail):
- ComplianceGauge at top
- Two side-by-side cards: Current Position / Projected Position
- Cost Breakdown card (amortisation + agent fee + wage + player sale)
- Sanctions card (levy alert or points deduction alert, conditionally rendered)
- AmortisationTable at bottom

#### Pages

**`src/pages/LoginPage.tsx`**:
- Two tabs: Password / Magic Link
- Password form: email + password → `supabase.auth.signInWithPassword()`
- Magic link form: email → `supabase.auth.signInWithOtp()` → shows "Check your email" confirmation
- Server error display
- Info note: "Access is by invitation only"

**`src/pages/ClubSetupPage.tsx`**:
- Form with: football-related revenue (£), current squad costs (£), current allowance ratio, owner equity (current season + 3-year)
- Live preview: as user types revenue + allowance, Green Threshold and Red Threshold update in real time
- Submits to `api.club.updateFinancials()` → stores updated financials in club store
- Shows success/error state

**`src/pages/SimulatorPage.tsx`**:
- Guard: redirects to `/setup` if no financials loaded
- Input form: label, transfer fee, contract length, weekly wage, agent fee
- Player sale toggle — reveals sale proceeds + book value fields
- On submit: converts weekly wage → annual pence via `weeklyWageToAnnualPence()`, posts to `api.simulations.create()`
- Result: renders `SCRResultPanel` on the right column
- Shows link to saved simulation in history

**`src/pages/HistoryPage.tsx`**:
- List view (no `:id` param): table of all simulations (date, label, fee, projected SCR, status, user)
- Detail view (with `:id` param): full `SCRResultPanel` + label edit input + PDF export button

**`src/pages/CalendarPage.tsx`**:
- Static list of 10 EFL Championship compliance events for 2026/27
- Events typed as: checkpoint, test, window, deadline (colour-coded)
- Disclaimer that dates should be confirmed against official EFL Handbook when published
- Events:
  1. Summer Transfer Window Opens (14 Jun 2026)
  2. Pre-Season Revenue Estimation (Jul/Aug 2026)
  3. Summer Transfer Window Closes (1 Sep 2026)
  4. First SCR Monitoring Checkpoint (1 Oct 2026)
  5. Winter Transfer Window Opens (1 Jan 2027)
  6. Winter Transfer Window Closes (31 Jan 2027)
  7. **Main SCR Compliance Test (1 Mar 2027)** ← most important
  8. Season End (May 2027)
  9. **Accounts Confirmation Test (Jun 2027)** ← sets next season's allowance
  10. Follow-Up Check (Oct 2027)

---

## Architecture Decisions & Rationale

| Decision | Why |
|----------|-----|
| All money in pence (integers) | Float precision errors in financial calculations are unacceptable. `1700000000 * 1.15 = 1954999999` in JS float — correct to use `Math.floor` |
| Engine is pure functions only | Deterministic, unit-testable, auditable. LLMs can call it as a tool in MVP 3.0. Never call DB or API from engine. |
| `LeagueConfig` object, not hard-coded rules | Adding Premier League, La Liga, etc. = new config object, zero engine changes |
| Agent fee spread over contract years | This is the EFL regulatory requirement — not just a design choice |
| Net player sale profit added to **revenue** | That's how the EFL SCR works — sale profit counts as football-related revenue, expanding the Green Threshold |
| BigInt in Prisma schema | PostgreSQL `bigint` maps to JS `BigInt`. Must convert to `Number` before returning from API (Prisma returns BigInt, JSON.stringify throws on BigInt). Done in route handlers. |
| Simulations stored as JSONB snapshots | Captures the exact state at time of simulation. Even if club financials change later, the historical simulation remains accurate. |
| Audit log append-only | Legal protection. A tamper-evident record of all writes. |
| `import.meta.env` for Vite env vars | Vite uses `VITE_` prefixed env vars, exposed via `import.meta.env`. Declared in `src/vite-env.d.ts`. |

---

## Known Issues / Pending Items

| Item | Status | Details |
|------|--------|---------|
| Supabase RLS policies | Pending | Must be applied in Supabase dashboard after DB migration. Club A must not see Club B's data. Every table needs `club_id = auth.uid()` type policies. |
| Initial club + user seeding | Pending | No self-signup. Admin must create club row, then create user in Supabase Auth, then create user row linking to club. No admin UI yet. |
| Prisma migration | Pending | `pnpm --filter @headroom/api exec prisma migrate dev` — needs live DB URL |
| `jspdf-autotable` types | Minor | The `lastAutoTable` property access in `pdf.ts` uses `as unknown as` cast. Fine for MVP. |
| Allowance ratio input UX | Minor | Setup form uses 0–1 float (e.g. 0.3 for 30%). The label `%×100` is not ideal. Could be improved to accept 30 and divide by 100. |

---

## Environment Setup (Quick Reference)

### Supabase Project Setup
1. Go to supabase.com → New project
2. Go to Settings → Database → Connection string (copy `DATABASE_URL`)
3. Go to Settings → API → copy `Project URL` and `anon key` and `service_role key`

### `.env` files to create

`apps/api/.env`:
```
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
SUPABASE_URL=https://[REF].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
FRONTEND_URL=http://localhost:5173
PORT=3001
NODE_ENV=development
```

`apps/web/.env.local`:
```
VITE_SUPABASE_URL=https://[REF].supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### First Run Commands
```bash
pnpm install
pnpm --filter @headroom/api exec prisma migrate dev --name init
pnpm dev
```

### First Club Setup (manual, in Supabase dashboard)
1. Authentication → Users → Invite user (enter CFO email)
2. Table Editor → clubs → Insert: `{ name: 'Sheffield Wednesday FC', short_name: 'SWFC', league_id: 'efl-championship' }`
3. Table Editor → users → Insert: `{ id: <supabase auth user id>, club_id: <club uuid>, role: 'cfo', full_name: 'Name', email: 'email' }`

---

## How to Continue Development

### Finding your place
1. Read `PLAN.md` — check which steps are `[x]` (done) vs `[ ]` (pending)
2. Read the "Next step" line at the bottom of `PLAN.md`
3. Run `pnpm --filter @headroom/engine test` to confirm engine still passes
4. Run `pnpm --filter @headroom/web typecheck` and `pnpm --filter @headroom/api typecheck` to confirm no regressions

### Running the app
```bash
pnpm dev
# Frontend: http://localhost:5173
# API: http://localhost:3001
# Health check: curl http://localhost:3001/health
```

### Adding a new feature
1. If it touches financial calculations → add to `packages/engine/src/`, write tests first
2. If it's a new API route → add to `apps/api/src/routes/`
3. If it's a new page → add to `apps/web/src/pages/`, add route to `App.tsx`, add nav link to `Sidebar.tsx`
4. After every session, update `PLAN.md` and `BUILD_LOG.md`

---

## What MVP 2.0 Will Add (Do Not Build Yet)

- Squad roster management (CSV upload + manual edit)
- Squad-level compliance dashboard (every player's cost impact)
- Scenario builder (drag-and-drop multi-player simulation)
- Multi-user access and roles
- Premier League SCR module + SSR tests
- Interactive compliance calendar with email alerts
- Anonymised benchmarking (once 10+ clubs)
- PDF and Excel export for full squad

## What MVP 3.0 Will Add (Do Not Build Yet)

- AI contract parser (Claude API, `claude-sonnet-4-6`)
- Accounting software integrations (Xero, Sage)
- La Liga LCPD module
- UEFA FSR layer (70% SCR for European clubs)
- Full audit trail export for regulatory submission
- Automated breach alerts (real-time monitoring)
- White-label option for law firms

---

## Regulatory Rules Encoded (Reference)

### SCR Formula
```
SCR Ratio = Total Squad Costs ÷ Football-Related Revenue
Green Threshold = Revenue × 85%
Red Threshold = Green Threshold × (1 + Allowance%)
Initial Allowance = 30% → Red = 85% × 1.30 = 110.5% of revenue
```

### Feedback Loop
- Club SCR > 85% at end-of-season ACT → allowance -= (SCR% - 85%)
- Club SCR ≤ 85% at end-of-season ACT → allowance += 10% (cap: 30%)
- Allowance floor: 0%

### Levy Formula (Amber)
```
Levy = overspend × (SCR% - 85%)
e.g. £250k overspend at 89% → £250k × 0.04 = £10,000
```

### Points Deduction (Red)
```
Points = 6 + floor(spend_above_red / £6,500,000)
Minimum: 6 points
+1 point per £6.5M above Red Threshold
```

### Championship-Specific
- Owner equity top-up: max £15M/season, £33M rolling 3-year. Counts as revenue.
- No SSR tests (those are Premier League only)

### Agent Fee Treatment
- Agent fees are spread over contract years for SCR purposes (not expensed in year 1)
- A £600k agent fee on a 3-year contract = £200k/year in squad costs

---

## Session 5 — Visual Redesign (2026-05-25)

### What was accomplished

Complete visual redesign of `apps/web/src/` to match the new design system in `design/` folder. Dark slate/green theme replaced with light white/violet theme.

### Design system change summary

| Element | Before | After |
|---------|--------|-------|
| Background | `slate-950` | `white` / `slate-50` (login) |
| Card surface | `bg-slate-900 border-slate-800` | `bg-white border-slate-200 shadow-sm` |
| Primary accent | `green-500 / green-600` | `violet-600` |
| Number font class | `.tabular-nums` | `.num` (JetBrains Mono) |
| Label style | inline `text-xs uppercase text-slate-400` | `.meta-label` CSS class |
| Status badge | dark tinted borders | `bg-green-100 text-green-700` light pills |
| Sidebar | fixed, dark, green icon | sticky, white, custom H SVG wordmark |
| ComplianceGauge | Recharts horizontal bar chart | Pure CSS `gauge-track + .zone` with SVG triangle arrows |
| Page headers | serif font, slate | bold Inter, violet left-bar accent |
| Toggle | HTML checkbox | Custom CSS `.toggle` with `data-on` attribute |

### Files changed

**CSS / Config:**
- `apps/web/src/index.css` — complete rewrite: light CSS vars, `.num`, `.meta-label`, `.gauge-track`, `.zone`, `.toggle`, `.spin` classes
- `apps/web/tailwind.config.ts` — removed dark mode class, removed unused CSS vars
- `apps/web/index.html` — added font weight 700 to Google Fonts URL

**UI Primitives:**
- `components/ui/card.tsx` — white bg, slate-200 border, shadow-sm
- `components/ui/button.tsx` — violet-600 primary, violet outline, ghost variants
- `components/ui/badge.tsx` — light bg-*-100 text-*-700, accepts children
- `components/ui/input.tsx` — white bg, slate-200 border, violet focus ring
- `components/ui/label.tsx` — uses `.meta-label` CSS class
- `components/ui/separator.tsx` — slate-100 (was slate-800)

**Layout:**
- `components/layout/Sidebar.tsx` — sticky white sidebar, custom H SVG wordmark, violet active state, workspace block at bottom, logout link
- `components/layout/AppLayout.tsx` — TopBar added (breadcrumb + SCR pill + user avatar), white background, redesigned footer

**Simulator:**
- `components/simulator/ComplianceGauge.tsx` — fully replaced Recharts with pure CSS gauge. Props changed from `{currentRatio, projectedRatio, ...}` (ratios) to `{currentPct, projectedPct, greenPct, redPct}` (percentages)
- `components/simulator/AmortisationTable.tsx` — light theme, current season highlighted `bg-violet-50/60`
- `components/simulator/SCRResultPanel.tsx` — full redesign: StatusBanner with border-l-4, ComparisonCards grid-cols-2, CostBreakdown 3-col stat blocks, SanctionsPanel with colored left borders, EmptyResults with dashed border. Now exports `EmptyResults` too. Helper `fmtGBP()` added for compact/signed formatting.

**Pages:**
- `pages/LoginPage.tsx` — slate-50 bg, white card, underline tab indicator, clean inputs
- `pages/SimulatorPage.tsx` — violet page header, 480px|1fr grid, toggle button (not checkbox), `FieldWrapper` local helper, `inputCls()` helper
- `pages/HistoryPage.tsx` — light table, violet hover, initials avatar, click-to-edit label, PDF export button
- `pages/CalendarPage.tsx` — vertical timeline with connecting line, kind badges, violet KEY DATE chips
- `pages/ClubSetupPage.tsx` — settings layout with live threshold preview sidebar panel, violet top accent bar

### TypeScript result
`pnpm --filter @headroom/web typecheck` → 0 errors

### Important notes for future sessions
- `SCRResult` type has no `currentSquadCosts` or `footballRelatedRevenue` fields. Revenue is derived as `currentGreenThreshold / 0.85` and currentSquadCosts as `currentSCRRatio * revenue`. These are accurate since `currentGreenThreshold = revenue * 0.85` exactly.
- `ComplianceGauge` no longer uses Recharts — if Recharts dependency is unused elsewhere, it can be removed from `package.json`
- The design's `.num` class replaces the old `.tabular-nums` class everywhere
- Toggle button works via `form.setValue('isSelling', !isSelling)` — no hidden checkbox needed

---

## Session 6 — Database Connectivity, Auth Self-Heal, Numeric Input Formatting (2026-05-26)

### What was accomplished

Fixed three categories of runtime bugs that blocked all API calls after the Prisma → Supabase JS client migration. Also added thousands-comma formatting to all numeric inputs and 2-decimal-place enforcement on fractional fields.

---

### Critical Fix 1 — API server wasn't loading `.env` at all

**Symptom:** Every API call returned 500. The server crashed immediately on startup.

**Root cause:** The dev script was `tsx watch src/server.ts`. The `tsx` runner does **not** automatically load `.env` files. Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, `src/lib/supabase.ts` throws on module load before the server even registers a single route. Vite's `/api` proxy then has no upstream to reach and returns 500 for every request.

**Fix:** Updated `apps/api/package.json` scripts to use Node's built-in `--env-file` flag:
```json
"dev": "tsx watch --env-file=.env src/server.ts",
"start": "node --env-file=.env dist/server.js"
```

**Rule to remember:** `tsx` / `ts-node` / `node` do NOT load `.env` automatically. Always pass `--env-file=.env` explicitly, or add `dotenv/config` as the first import in the entrypoint. Never assume environment variables are available just because a `.env` file exists.

---

### Critical Fix 2 — Prisma `@default(uuid())` does NOT create a DB-level default

**Symptom:** `PUT /club/financials` and `POST /simulations` returned 500 with:
```
null value in column "id" of relation "audit_logs" violates not-null constraint
```

**Root cause:** Prisma's `@default(uuid())` annotation is **application-layer only**. Prisma generates the UUID in JavaScript before sending the INSERT. When you bypass Prisma and use the Supabase REST client directly, the DB has no `DEFAULT gen_random_uuid()` on those columns — the `id` column exists with `NOT NULL` but no default. Inserting a row without supplying `id` therefore fails with a NOT NULL violation.

Affected tables: `club_financials`, `simulations`, `audit_logs` (all had `@id @default(uuid())` in Prisma schema).

**Fix:** Explicitly generate UUIDs in every INSERT:
```typescript
import { randomUUID } from 'crypto'

// In every insert that touches these tables:
await supabase.from('audit_logs').insert({ id: randomUUID(), ... })
await supabase.from('simulations').insert({ id: randomUUID(), ... })
// club_financials was already fixed to SELECT+UPDATE/INSERT with randomUUID()
```

**Rule to remember:** After migrating away from Prisma to any raw SQL or REST client, audit every table that had `@default(uuid())` or `@updatedAt`. These are **Prisma-managed** — the DB schema has no equivalent default. You must either:
- Add `DEFAULT gen_random_uuid()` directly in Supabase SQL editor for each `id` column, OR
- Always pass `id: randomUUID()` from application code.

The safest long-term fix is to run this SQL in Supabase for each affected table:
```sql
ALTER TABLE club_financials ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE simulations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE audit_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE players ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE contracts ALTER COLUMN id SET DEFAULT gen_random_uuid();
```
This makes the DB self-sufficient regardless of which ORM or client is used.

**Also:** `audit_logs` insert errors are now non-fatal — a failed audit log write logs a warning but does not fail the user's request. Audit log failures should never block the primary operation.

---

### Critical Fix 3 — Supabase auth ID mismatch: "User not found in system" (403)

**Symptom:** All authenticated API calls returned 403 `User not found in system`, even though the user's email existed in `public.users` and their Supabase Auth login succeeded.

**Root cause:** The `public.users` table stores the Supabase Auth user ID as its primary key. When a user was deleted from Supabase Auth and re-created (or the project was reset), a new auth UUID was issued. The old `public.users` row had the stale UUID. The auth middleware looked up `WHERE id = <new_auth_id>` — found nothing — and returned 403.

**Concrete example:**
- `auth.users`: `569c9e2c-...` → `asset8k@gmail.com` (new account)
- `public.users`: `4539135f-...` → `asset8k@gmail.com` (old stale seed record)
- Middleware: `SELECT WHERE id = '569c9e2c-...'` → 0 rows → 403

**Fix:** Updated `apps/api/src/middleware/auth.ts` with two self-healing layers:

1. **Re-link by email:** If the ID lookup returns nothing, look up by email. If a row exists with a matching email but different ID, update the row's ID to match the current auth user. This handles the "deleted and recreated" case automatically.

2. **Auto-provision:** If no row exists by ID or email, create one attached to the first available club as CFO. MVP convenience — should be replaced with an invite flow for multi-tenant production.

```typescript
// Simplified logic:
let user = await supabase.from('users').select(...).eq('id', authUser.id).maybeSingle()

// Self-heal: stale ID with matching email
if (!user && authUser.email) {
  const byEmail = await supabase.from('users').select(...).eq('email', authUser.email).maybeSingle()
  if (byEmail) {
    await supabase.from('users').update({ id: authUser.id }).eq('id', byEmail.id)
    user = { ...byEmail, id: authUser.id }
  }
}

// Auto-provision: brand-new user, no record at all
if (!user) {
  const club = await supabase.from('clubs').select('id').limit(1).maybeSingle()
  user = await supabase.from('users').insert({ id: authUser.id, club_id: club.id, role: 'cfo', ... }).select(...)
}
```

**Rule to remember:** Never use Supabase Auth user IDs as application PKs without a plan for ID rotation. If a user is deleted and recreated (even with the same email), their auth ID changes. The safest approach is to treat the `public.users` email as the stable identity, with the auth ID as a foreign key that can be updated.

---

### Numeric Input Formatting

Added thousands-comma formatting to all money input fields and 2-decimal enforcement on fractional fields.

**New component:** `apps/web/src/components/ui/numeric-input.tsx`
- `NumericInput` — a `forwardRef` wrapper around `<input type="text" inputMode="numeric">`
- Displays values with `toLocaleString('en-GB')` (comma thousands separator)
- Strips non-digit characters on change; calls `onChange(NaN)` when empty
- Syncs display to form value when field is not focused (handles external resets)
- Compatible with React Hook Form via `Controller`

**Pattern for money fields with React Hook Form:**
```tsx
<Controller
  control={form.control}
  name="transferFeePounds"
  render={({ field }) => (
    <NumericInput
      value={field.value ?? NaN}
      onChange={field.onChange}
      onBlur={field.onBlur}
      ref={field.ref}
      className={inputCls(!!errs.transferFeePounds, 'pl-7')}
    />
  )}
/>
```

For optional fields (where empty should map to `undefined`, not `NaN`):
```tsx
onChange={(n) => field.onChange(isNaN(n) ? undefined : n)}
```

**2-decimal enforcement for fractional fields** (`currentAllowanceRatio`, `contractLengthYears`): handled via `onBlur` rounding inside a `Controller` render, calling `form.setValue(..., parseFloat(v.toFixed(2)), { shouldValidate: true })`.

**Files changed:**
- `apps/web/src/components/ui/numeric-input.tsx` — new component
- `apps/web/src/pages/ClubSetupPage.tsx` — 4 money fields + allowance ratio
- `apps/web/src/pages/SimulatorPage.tsx` — 5 money fields + contract length

---

## Session 7 — Bug Fixes, Owner Equity Engine Fix, TopBar Toggle, 4 Transaction Types (2026-05-26)

### What was accomplished

1. **Fixed DELETE 400**: `apiFetch` was always sending `Content-Type: application/json`, causing Fastify 5 to reject bodyless DELETE requests. Fixed by checking `init?.body != null` before setting the header.

2. **Auto-label simulations**: API now auto-assigns `Transfer 1`, `Transfer 2`, etc. when no label is provided. Counts existing simulations before insert.

3. **Owner equity engine bug (critical)**: `calculateThresholds()` was ignoring `ownerEquityUsedCurrentSeason` entirely — the Green Threshold was computed from raw revenue only. Fixed to use `adjustedRevenue = footballRelatedRevenue + (ownerEquityUsedCurrentSeason ?? 0)` in `thresholds.ts`. TopBar SCR was also wrong (4 places in UI); all updated to use equity-adjusted revenue as denominator.

4. **Double-equity bug in projected thresholds**: `calculate.ts` was passing `adjustedRevenue` (already equity-adjusted) to `calculateThresholds()`, which then added equity again. Fixed by passing raw `footballRelatedRevenue + rawRevenueDelta` to `calculateThresholds()` and letting it apply equity internally.

5. **ClubSetupPage**: Removed 3-year owner equity field (simplified to one field), updated live preview to use equity-adjusted revenue. Removed from API schema too.

6. **Centralized SCR state in AppLayout**: `setCurrentSCRRatio` was called from 5 different places. Replaced with a single `useEffect` in `AppLayout.tsx` that fires whenever `scrInfluence`, `financials`, or `totalStackedCostImpact` changes. No component sets SCR directly anymore.

7. **Apply History toggle moved to TopBar**: Toggle persists across all tabs. When `simulationCount === 0`, the toggle is hidden. SCR pill label changes to "Stacked SCR" when toggle is ON.

8. **Stacked baseline for simulations**: When toggle ON and `simulationCount > 0`, the simulator passes `baselineSquadCostsPence = financials.currentSquadCosts + totalStackedCostImpact` to override the DB `currentSquadCosts` in the engine. The API's Zod schema accepts and applies this override. HistoryPage calls `setStackedHistory(count, total)` to keep the store in sync; the total is `Σ(sim.scrResult.totalAnnualCostImpact)` across all simulations.

9. **4 transaction types**: Replaced the "simultaneously selling a player" toggle with a 4-type selector: Buy, Sell, Loan In, Loan Out. Each has its own form fields and engine logic.

### Transaction type details

| Type | Form fields | SCR impact |
|------|-------------|------------|
| Buy | Transfer fee, contract years, weekly wage, agent fee | +amortisation +wage +agentFee/yr |
| Sell | Sale proceeds, book value, weekly wage released, annual amort relief | −(wageRelief+amortRelief); sale profit → revenue |
| Loan In | Loan fee, loan duration, wage contribution | +loanFee/yr +wage |
| Loan Out | Loan fee received, loan years, wage covered | −wageCovered; feeIncome/yr → revenue |

### Files changed

- `packages/shared/src/types.ts` — Added `TransactionType` union, updated `TransferInput` with all new fields, kept legacy fields for backward compat
- `packages/engine/src/thresholds.ts` — Added equity to adjusted revenue before threshold calc
- `packages/engine/src/calculate.ts` — Full rewrite: branches by `transactionType`, `rawRevenueDelta` concept, `hasLegacySale` for backward compat
- `packages/engine/tests/engine.test.ts` — Added 9 tests (sell×3, loan_in×3, loan_out×3); 48/48 passing
- `apps/api/src/routes/simulations.ts` — Updated Zod schema for all 4 types, added auto-label logic, `baselineSquadCostsPence` override
- `apps/web/src/lib/api.ts` — Updated `CreateSimulationPayload` with all new fields
- `apps/web/src/stores/club.ts` — Added `scrInfluence`, `simulationCount`, `totalStackedCostImpact`, `setScrInfluence`, `setStackedHistory`
- `apps/web/src/components/layout/AppLayout.tsx` — Centralized SCR recompute, TopBar toggle, fetch simulations on mount
- `apps/web/src/pages/SimulatorPage.tsx` — Complete rewrite: 4-type selector, conditional form sections, `buildPayload` helper, stacked baseline badge
- `apps/web/src/pages/HistoryPage.tsx` — Removed toggle (moved to TopBar), uses `setStackedHistory`
- `apps/web/src/pages/ClubSetupPage.tsx` — Removed 3-year equity field, equity-adjusted live preview
- `apps/web/src/components/simulator/SCRResultPanel.tsx` — Added `transactionType` prop, type-specific `CostBreakdown` (4 variants), `ImpactFooter` shared sub-component, conditional schedule card with "Loan Fee Schedule" title for loan_in

### Engine test count
48/48 passing (was 39 in Session 1)

### TypeScript
All packages typecheck clean (zero errors)

---

## Session 8 — UX Polish: Type Labels, Spinners, Logo, History Improvements (2026-05-26)

### What was accomplished

1. **Type column in history table** — Added "Type" column (`Buy` / `Sell` / `Loan In` / `Loan Out` badges) to simulation list and detail header. `TX_TYPE_LABEL` map with `?? 'buy'` fallback handles legacy simulations.

2. **Type-aware status banner text** — "This transfer…" → "This sale…" / "This loan…" etc. in `SCRResultPanel`. `TX_NOUN` map (`buy: 'transfer'`, `sell: 'sale'`, `loan_in: 'loan'`, `loan_out: 'loan out'`) drives all 3 status strings.

3. **History UX improvements**:
   - Edit pencil icon is always visible (`text-slate-400`), not hover-only
   - Delete is instant (no confirmation prompt on both list and detail views)
   - Save button added to inline edit (was enter-only before), with spinner while saving
   - Delete button shows spinner while deleting

4. **ComplianceGauge label overlap fix** — When current and projected percentages are close (`|currentX - projectedX| < 10%` width), the projected label moves below the bar to prevent overlap. Current label+arrow stays above bar flush to bottom; projected arrow always rendered; projected label conditionally shown below bar with `mt-1.5`.

5. **GitHub private repo** — Initialized git, committed 77 files, pushed to `https://github.com/asset8k/headroom` (private).

6. **Football pitch H logo** — Redesigned sidebar H SVG as a top-down football pitch: two sidelines (posts), halfway line (crossbar), goals at top+bottom (opacity 0.65), center circle (opacity 0.6). Viewbox `0 0 18 22` — the extra 2px provides natural letter-spacing sidebearing so the "eadroom" wordmark sits at the right visual gap without any explicit `marginRight`.

7. **Favicon** — Created `apps/web/public/favicon.svg`: 32×32 rounded square with football pitch H scaled to 19×26px (preserving 16:22 aspect ratio), centered at (6.5, 3). Replaces the previous empty favicon.

8. **Club name update** — "Headroom Demo FC" → "Headroom FC" via Supabase SQL (`UPDATE clubs SET name = 'Headroom FC'`).

9. **Purple spinners across all API calls** — Created shared `Spinner` + `PageLoader` components in `apps/web/src/components/ui/spinner.tsx`. Applied:
   - `ProtectedRoute` — full-screen spinner during auth init (was invisible/null before)
   - `HistoryPage` list + detail — `PageLoader` on data load
   - `HistoryPage` save/delete — `Spinner` inside buttons
   - `LoginPage` — `Spinner` in Sign In, Create Account, Send Magic Link buttons
   - `ClubSetupPage` — `Spinner` in Save Settings button
   - `SimulatorPage` — already had inline spin SVG, no change needed
   - All spinners use `#6d28d9` (violet-700) and the `.spin` CSS animation from `index.css`

### Files changed

- `apps/web/src/components/ui/spinner.tsx` — new file: `Spinner` + `PageLoader`
- `apps/web/src/components/auth/ProtectedRoute.tsx` — full-screen spinner instead of null
- `apps/web/src/pages/HistoryPage.tsx` — type column/badge, type-aware detail, always-visible edit icon, instant delete, Save button with spinner, PageLoader
- `apps/web/src/pages/LoginPage.tsx` — Spinner in all 3 submit buttons
- `apps/web/src/pages/ClubSetupPage.tsx` — Spinner in Save Settings button
- `apps/web/src/components/simulator/SCRResultPanel.tsx` — TX_NOUN map, type-aware status banner
- `apps/web/src/components/simulator/ComplianceGauge.tsx` — stagger logic for overlapping labels
- `apps/web/src/components/layout/Sidebar.tsx` — football pitch H SVG (viewBox 0 0 18 22)
- `apps/web/public/favicon.svg` — new file: football pitch H favicon

### TypeScript
All packages typecheck clean (zero errors)

---

## Session 9 — MVP 1.0 Finalization: OTP Auth, Multi-Tenancy Fixes, UI Polish (2026-05-27)

### What was accomplished

**MVP 1.0 is now complete.** This session fixed critical security/auth bugs, polished UX, completed integration steps 6.1–6.4, and finalized documentation.

---

### Auth Rewrite — OTP Signup, No Magic Links

**`apps/web/src/pages/LoginPage.tsx`** — major rewrite:
- Removed: magic link tab, `MagicLinkForm`, `MagicLinkSchema`, `magicSent` state, tab bar
- Added: 8-digit OTP verification screen (shown after `signUp()` if no session returned)
- OTP UI: 8 individual digit `<input>` boxes, auto-advance on digit entry, paste support (pastes across all boxes), 60s resend cooldown with countdown timer
- Password complexity validation (Zod): must contain uppercase, lowercase, number, and special character
- Mode toggle via bottom links only (Stripe/Vercel pattern). No tabs. No card heading.
- `OTP_LENGTH = 8` (Supabase project configured for 8 digits)
- Flow: `signUp()` → if `session === null` → OTP screen → `verifyOtp({ type: 'signup' })` → navigate to /simulator

---

### Critical Multi-Tenancy Bug Fixes

All three bugs were in `apps/api/src/middleware/auth.ts`. New accounts were getting the same club data as existing accounts.

**Bug A — Wrong club assigned to new users:**
- Cause: `clubs.select('id').limit(1)` grabbed the first club in the DB for every new user
- Fix: Removed entirely — every new user always gets a freshly created club

**Bug B — Same email inherits old workspace:**
- Cause: Self-heal block found old `users` row by email and re-linked the new auth ID to the old club_id
- Fix: Removed self-heal block entirely — deleted accounts do not survive re-registration

**Bug C — UNIQUE constraint on `users.email`:**
- Cause: FK constraints from `simulations.created_by` and `audit_logs.user_id` caused the old users row DELETE to fail silently, leaving a stale row that blocked the INSERT
- Fix: Cascade cleanup in FK order before insert: `simulations` → `audit_logs` → `users`

**Bug D — NOT NULL constraint on `clubs.updated_at`:**
- Cause: Prisma's `@updatedAt` is application-layer only; Supabase REST client doesn't apply it
- Fix: Added explicit `created_at: now, updated_at: now` to every club INSERT

Final auto-provision block creates: fresh UUID club → user row linked to new club. Every account is fully isolated.

---

### UI Polish

- **Logo spacing**: H SVG wrapper `marginRight: -1` in both LoginPage and Sidebar (1px closer to "eadroom")
- **Login card**: Removed h2 headings entirely; form + bottom links only (no titles, no tabs)
- **Simulator helper text**: Removed all `helper="..."` props from every `FieldWrapper` (removed: "0 for free transfer", "Years (0.5 steps)", "Annual equivalent shown in results", "Spread across contract years")
- **Scenario label**: Removed "(optional)" from label text; shortened placeholder to "Striker option A"

---

### History "Amount" Column

`apps/web/src/pages/HistoryPage.tsx` — "Transfer Fee" column renamed to "Amount":
- Buy → shows `transferFee`
- Sell → shows `saleProceeds`
- Loan Out → shows `loanFeeReceived`
- Loan In → shows `loanFeePaid` (= `transferFee` field)

---

### Active State Visual Fix (SCRResultPanel)

`apps/web/src/components/simulator/SCRResultPanel.tsx`:
- Removed `bg-violet-50/30` background tint from active cards (caused purple-over-amber conflict)
- When `afterActive === true`, always applies `border-violet-200` regardless of compliance status (violet ring completely overrides amber/red border color)

---

### Steps 6.1–6.4 (Integration)

- **6.1** — E2E flow audit: auth → onboarding → simulate (4 types) → history → Active Baseline toggle → PDF export
- **6.2** — RLS SQL written in `apps/api/prisma/rls.sql`: `current_club_id()` SECURITY DEFINER function + FOR ALL policies on all 7 tables. Idempotent (DROP IF EXISTS before CREATE).
- **6.3** — Dev seed script `apps/api/prisma/seed.ts`: creates auth user `dev@headroom.test` / `Dev@headroom1!`, club "Headroom Dev FC", club_financials £95M revenue / £80M costs / 30% allowance for 2026-27
- **6.4** — Prisma migration DDL in `apps/api/prisma/migrations/20260101000000_init/migration.sql` (generated via `migrate diff --from-empty --to-schema-datamodel`)

### Prisma schema update

`apps/api/prisma/schema.prisma` — Simulation model:
- Removed: `clubFinancialsSnapshot Json`, `scrResult Json`
- Added: `isIncluded Boolean @default(false) @map("is_included")`

(Matches actual DB schema — snapshots were never used in practice; delta architecture stores only input + included flag)

### Documentation finalized

- `context.md` — Added MVP 1.0 COMPLETE banner; updated Section 5.4 Auth to OTP; updated DB schema simulations table; updated MVP 1.0 feature list to reflect 4 transaction types + Active Baseline delta architecture
- `PLAN.md` — Marked Steps 3.4, 6.1–6.4 as [x]; 6.5 as [~] (skipped); Current Status updated to "MVP 1.0 COMPLETE"
- `BUILD_LOG.md` — Session 9 appended (this entry)

### Engine / TypeScript
- Engine: 39 unit tests passing (engine unchanged this session)
- All packages typecheck clean (zero errors)

---

# MVP 2.0 — Roster, Multi-Action Scenarios, PL Module

## Session 10 — Phase 1: Relational DB Schema, RLS, Supavisor V2 Migration (2026-05-27)

### What was accomplished

Executed Phase 1 of [mvp_2.0_plan.md](mvp_2.0_plan.md): destructive database refactor to replace the manual `current_squad_costs` aggregate with a relational players + contracts source of truth, plus replacing the flat `simulations` table with named multi-action `scenarios`.

**Commits:** `57ee101` (schema + RLS files), `bb39066` (applied to Supabase + fixes)

---

### Prisma schema changes

[apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma):

- **ClubFinancials**: dropped `currentSquadCosts`, added `seasonStartDate` + `seasonEndDate`
- **Player**: added `isActive`, `archivedAt`, `updatedAt`, composite index `(club_id, is_active)`
- **Contract**: renamed `contractStart`/`contractEnd` → `startDate`/`endDate`, added `updatedAt`, two composite indexes
- **Simulation model REMOVED** → replaced with two new models:
  - `Scenario` — named plan (id, club_id, created_by, season, name, is_included)
  - `ScenarioAction` — ordered children with `onDelete: Cascade`, optional `player_id` FK

### Migration applied

[apps/api/prisma/migrations/20260527000001_mvp2_relational_roster/migration.sql](apps/api/prisma/migrations/20260527000001_mvp2_relational_roster/migration.sql):
- Idempotent (`IF EXISTS` on every ALTER/DROP)
- Safe `RENAME COLUMN` via `DO $$ … END $$` blocks to handle already-renamed columns
- `DROP TABLE simulations CASCADE` — MVP 1.0 history did not migrate forward (destructive by design, accepted by user)

### RLS

[apps/api/prisma/rls.sql](apps/api/prisma/rls.sql) updated:
- `current_club_id()` now returns **TEXT** (was UUID — latent MVP 1.0 bug: Prisma uses TEXT primary keys, not native UUID, so the previous `uuid` return signature would have type-mismatched against `club_id = current_club_id()` if anyone had ever queried under RLS)
- Added scenarios policy + scenario_actions policy (the latter uses `EXISTS` subquery through scenarios, since scenario_actions has no direct `club_id`)
- Removed simulations policy
- Cleaned up 6 legacy snake_case policies (`clubs_own`, `players_own_club`, etc.) that overlapped the canonical set — only the rls.sql-defined policies remain

### Seed update

[apps/api/prisma/seed.ts](apps/api/prisma/seed.ts):
- Removed `current_squad_costs` from financials insert
- Added `season_start_date` + `season_end_date`
- Added 5-player Championship squad with realistic pence values (Marcus Ward GK, Alex Deane DEF, Oliver Marsh DEF, Jordan Hayes MID, Carlos Ramos FWD)
- Fixed clubs select-then-insert (no unique constraint on `clubs.name`, so the old `upsert(onConflict: 'name')` failed)

---

### Critical Fix — Supavisor V2 hostname migration

**Symptom:** `prisma db execute` and `npx supabase db push` both rejected the tenant with `(ENOTFOUND) tenant/user postgres.xwvtwczdwdqaxdblyxtr not found` from every AWS region. The Supabase REST API worked fine with the new `sb_secret_…` service role key, so the project was alive — just the pooler couldn't find it.

**Root cause:** Supabase migrated Supavisor from V1 to V2 sometime after MVP 1.0 was deployed. The hostname pattern changed from `aws-0-{region}.pooler.supabase.com` to `aws-1-{region}.pooler.supabase.com`. The `DATABASE_URL` in `.env` was stale.

**Discovery method:** Wrote a probe script that tested every AWS region on both V1 and V2 hostname patterns. Only `aws-1-ap-southeast-1.pooler.supabase.com:5432` accepted the tenant.

**Fix:** Updated `apps/api/.env` `DATABASE_URL` to use `aws-1-…`.

**Also confirmed via research:** The new `sb_secret_` API key format (replaced JWTs in late 2025) is for PostgREST/Auth/Storage only — the pooler still uses the database password from the dashboard. Management API (`POST /v1/projects/{ref}/database/query`) requires a Personal Access Token (`sbp_…`), not a `sb_secret_` key.

**Rule to remember:** When migrating to a Supabase project with a new API key format (`sb_secret_…`), assume the pooler hostname has also been updated. Check `aws-1-{region}` before `aws-0-{region}`.

---

### Verification (RLS smoke test)

Verified isolation via anon key:
```
clubs                 ✓ blocked (0 rows)
users                 ✓ blocked (0 rows)
club_financials       ✓ blocked (0 rows)
players               ✓ blocked (0 rows)
contracts             ✓ blocked (0 rows)
scenarios             ✓ blocked (0 rows)
scenario_actions      ✓ blocked (0 rows)
audit_logs            ✓ blocked (0 rows)
```

All 8 tables enforce club isolation, no errors.

---

## Session 11 — Phase 2: Roster Management + Smart CSV Mapper (2026-05-27)

### What was accomplished

Phase 2 of [mvp_2.0_plan.md](mvp_2.0_plan.md): built the squad roster system. Players + contracts are now the single source of truth for squad costs; manual aggregate is gone.

**Commit:** `65d075c` (14 files, +2150/-4 lines)

---

### Engine — `currentBookValuePence` + 10 leap-year tests

[packages/engine/src/amortisation.ts](packages/engine/src/amortisation.ts) added:

```typescript
export function currentBookValuePence(
  transferFeePence: bigint | number,
  startDate: Date,
  endDate: Date,
  asOf: Date = new Date()
): number
```

- Whole-month straight-line amortisation
- Clamps `asOf` to `[startDate, endDate]` — before start → full fee, at/after end → 0
- Accepts `bigint` (Prisma BigInt) OR `number`
- Internal `monthsBetween()` uses `getUTCFullYear` + `getUTCMonth` only — day-of-month is ignored. This is **the** behaviour SCR regulations want; a transfer on Feb 29 (leap year) and one on Feb 28 (non-leap) produce identical amortisation schedules.

**Tests added** (mandated by Phase 2.5 of the plan):
- `2024-02-29 → 2028-02-28`: exactly 48 months
- `2025-02-28 → 2028-02-28`: exactly 36 months
- Equal-length leap and non-leap signings produce identical month counts
- Mid-month transfer (`2026-03-15 → 2028-03-15`): whole-month rounding ignores day-of-month
- `asOf == end` → 0
- `asOf < start` → full fee
- `bigint` input → matches `number` input
- Zero-length contract → 0 (defensive)
- Free transfer (fee = 0) → 0
- Midpoint of 4-year contract → half fee

**Engine test count:** 59/59 passing (was 39 at MVP 1.0 close + 10 new = 49; plus 10 from Session 7 transaction types).

---

### Shared schemas

[packages/shared/src/schemas.ts](packages/shared/src/schemas.ts) added:

- `RosterRowSchema` — CSV row validation:
  - `name` (1–80 chars), `position` (enum, case-insensitive on input), optional `nationality`
  - `transfer_fee_pounds` ≥ 0, `weekly_wage_pounds` > 0, `agent_fee_pounds` ≥ 0
  - `contract_start` / `contract_end`: ISO `YYYY-MM-DD`, end > start, end ≤ start + 7 years
- `ManualPlayerSchema` — single-player form, fields in pence (no CSV underscores)
- `ContractPatchSchema` — partial update, at-least-one-field constraint

[packages/shared/src/types.ts](packages/shared/src/types.ts) added:
- `PlayerPosition` union
- `PlayerWithContract` wire-format type
- `RosterStagingRow` for CSV staging (rowIndex, ok, issues[], parsed?)

---

### API — `apps/api/src/routes/roster.ts` (new, 8 endpoints)

| Endpoint | Behaviour |
|---|---|
| `GET /roster` | active players + joined active contract, `monthsToExpiry` computed |
| `GET /roster/archived` | soft-deleted players with their most-recent contract |
| `POST /roster/parse` | parses CSV via `papaparse`, validates each row, returns staging rows. **NO DB writes.** Body: `{ csvText: string }` (JSON, not multipart — deliberate deviation from plan, simpler for tiny payloads) |
| `POST /roster/commit` | re-validates the staging rows against `RosterRowSchema`, inserts players + contracts. On contract insert failure, rolls back the just-inserted players to avoid orphans |
| `POST /roster/player` | single manual create (player + active contract) |
| `PATCH /roster/player/:id` | name/position/nationality updates |
| `PATCH /roster/contract/:id` | fields + recomputed `bookValue` via engine |
| `POST /roster/player/:id/archive` | soft-delete: flips `is_active` to false, sets `archived_at`, deactivates all the player's active contracts. **Never hard-deletes** — audit trail requirement |

**Defence-in-depth applied at every endpoint:**
- `authMiddleware` preHandler → `request.clubId` from validated JWT
- Role guard (`canMutateRoster`): CFO + Admin + Finance Analyst on every mutation (Sporting Director excluded per Phase 5 role matrix)
- `.eq('club_id', request.clubId)` on every Supabase query
- Audit log row written on every successful mutation (non-fatal on failure)

**Book value strategy:** recomputed via `currentBookValuePence` on every write AND every read. The stored snapshot is just a historical baseline — `GET /roster` ignores it and recomputes against the current date.

**Deps added:** `@fastify/multipart`, `papaparse`, `@types/papaparse`.

### API — club.ts compatibility shim

[apps/api/src/routes/club.ts](apps/api/src/routes/club.ts) — fixed two references to the dropped `current_squad_costs` column:
- `GET /club/financials` now returns `currentSquadCosts: 0` (placeholder; Phase 3 Dashboard will derive from contracts)
- `PUT /club/financials` accepts `currentSquadCostsPounds` in the body but does NOT write it

This keeps the MVP 1.0 ClubSetupPage form working through the transition. Phase 3 will rip out the squad-costs input when it brings in the Dashboard.

---

### Web — `apps/web/src/pages/RosterPage.tsx` (new, ~700 LOC)

Strictly follows the [design/UI Kit.html](design/UI%20Kit.html) system: violet accents, `.num` + `.meta-label` classes, JetBrains Mono for money, light cards with `slate-200` borders. **No new UI primitives invented** — reuses `Card`, `Button`, `NumericInput`, `Spinner`, `cn`.

**Structure:**
- Page header with violet vertical accent bar (same pattern as History/Simulator)
- Two tabs: **Squad** (active players) | **Archived** (read-only history)
- Squad tab features:
  - Filter chips: All / Expiring ≤ 6 mo / GK / DEF / MID / FWD
  - Player table: Name, Position pill, Annual Wage (mono), Book Value (mono), Contract End, To Expiry
  - Per-row chips: amber `N mo` for ≤6 months, red `expired` past end date, red `EXPIRED` banner next to player name
  - Row click → `PlayerEditDrawer` with player + contract patch + archive confirm
  - "Add Player" button → `ManualPlayerModal`
  - "Upload CSV" button → `CSVUploadModal` (staging area)

**CSV staging UX** (the "Smart Mapper"):
1. User clicks "Choose CSV file" → file picker
2. File read as text in browser via `FileReader` → POST `/roster/parse` with `{ csvText }`
3. Modal renders staging table: valid rows shown normally, invalid rows highlighted red with their `issues[]` listed below
4. Invalid rows have a "Fix" button → opens inline `StagingRowEditor` with all 7 fields editable (text input, select, NumericInput, date pickers)
5. Editor "Save" re-POSTs a single-row synthesised CSV to `/roster/parse` for server-side re-validation — guarantees the canonical schema is the source of truth
6. Commit button enables only when every row is valid → POST `/roster/commit` with the parsed payload

**Manual player modal + Edit drawer** share patterns: `ModalShell` wrapper, `Field` label helper, `PoundInput` (wraps NumericInput with `£` prefix), violet/light styling throughout.

### Wiring

- [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) — added `api.roster.*` methods, fully typed via `@headroom/shared`
- [apps/web/src/App.tsx](apps/web/src/App.tsx) — `/roster` route
- [apps/web/src/components/layout/Sidebar.tsx](apps/web/src/components/layout/Sidebar.tsx) — "Roster" nav link with people SVG (positioned between Simulator and History)

---

### E2E smoke test (11/11 passing, against live DB)

| # | Test | Result |
|---|---|---|
| 1 | `GET /roster` returns seeded 5-player squad | ✓ |
| 2 | `POST /roster/parse` correctly identifies 1 valid + 3 invalid rows (bad wage, inverted dates, bad position) | ✓ |
| 3 | `POST /roster/commit` inserts the valid row | ✓ |
| 4 | `GET /roster` now shows new player with computed `bookValue` + `monthsToExpiry` | ✓ |
| 5 | `POST /roster/player` creates a manual player | ✓ |
| 6 | `PATCH /roster/player/:id` renames a player | ✓ |
| 7 | `POST /roster/player/:id/archive` soft-deletes | ✓ |
| 8 | Archived player excluded from `GET /roster` | ✓ |
| 9 | Archived player included in `GET /roster/archived` | ✓ |
| 10 | `POST /roster/parse` rejects header-only CSV | ✓ |
| 11 | `POST /roster/parse` rejects CSV with missing columns | ✓ |

---

### Documented deviations from plan

| Plan said | Implemented | Reason |
|---|---|---|
| `/roster/parse` accepts `multipart/form-data` | `/roster/parse` accepts JSON `{ csvText: string }` | 25-row CSVs are a few KB; multipart adds dependency + complexity for no functional gain. File still gets read in the browser via `FileReader` first. |

---

### What's still broken (intentional, deferred to Phase 3)

- **SimulatorPage** still references `financials.currentSquadCosts` which now always returns 0 — projected SCR will be wrong. Phase 3 replaces this page with the Dashboard which derives squad costs from contracts via `calculateSquadCosts`.
- **HistoryPage** queries the dropped `simulations` table → 500. Phase 3 replaces with `scenarios.ts` routes + a new ScenariosPage.
- **ClubSetupPage** form still has a manual squad costs input that gets silently dropped on submit. Phase 3 will remove the field with the Dashboard refactor.

---

### Engine / TypeScript

- Engine: 59/59 tests passing (39 base + 10 transaction types + 10 leap-year/book-value)
- API typecheck: 0 errors
- Web typecheck: 0 errors

---

## Session 12 — Phase 3: Dashboard + Multi-Action Scenario Builder (2026-05-27)

### What was accomplished

Phase 3 of [mvp_2.0_plan.md](mvp_2.0_plan.md): full replacement of the MVP 1.0 single-transfer Simulator + History flow with a derived-from-contracts Dashboard + a drag-and-drop multi-action Scenario Builder.

This phase is large in scope — engine, API, and frontend all changed substantially. 11/11 E2E smoke tests pass against the live DB.

---

### Engine (@headroom/engine)

New module: [packages/engine/src/squadCosts.ts](packages/engine/src/squadCosts.ts).

```typescript
calculateSquadCosts(contracts) → { totalSquadCostsPence, breakdown }
applyScenarioActions(baseline, actions[]) → { projectedSquadCostsPence, projectedRevenuePence, costDeltaPence, revenueDeltaPence }
```

- `calculateSquadCosts` sums wage + amortisation (transferFee/years) + annualisedAgentFee (agentFee/years). The breakdown row exposes `annualisedAgentFeePence` explicitly — the UI MUST label this as "Annualised Agent Fee" with a tooltip explaining that SCR amortises agent fees even when the user's own books expense them upfront.
- `applyScenarioActions` is the multi-action projection — branches by `actionType` (buy / sell / loan_in / loan_out / release) and returns deltas plus the projected baseline. Order-independent (commutative). Skips actions where `isIncluded === false`.
- 17 new tests added: 7 for calculateSquadCosts (including fractional years, defensive zero-length, ordering), 10 for applyScenarioActions (one per action type, multi-action combinations, isIncluded skip, commutativity).
- **Engine test count: 76/76 passing** (was 59 at end of Phase 2).

---

### API (apps/api)

**[apps/api/src/routes/scenarios.ts](apps/api/src/routes/scenarios.ts)** — new (replaces routes/simulations.ts entirely):

| Endpoint | Behaviour |
|---|---|
| `POST /scenarios` | Validates player FKs belong to this club (defence in depth — early 400 beats opaque FK error). Creates scenario + ordered actions in best-effort transaction (rollback parent on actions insert failure). |
| `GET /scenarios` | Paginated list with `actionCount` joined per scenario via a single batch query (no N+1). |
| `GET /scenarios/:id` | Full scenario with actions ordered by `order_index`. |
| `PATCH /scenarios/:id` | Rename or toggle `is_included`. Audit-logged. |
| `DELETE /scenarios/:id` | Hard delete — FK `ON DELETE CASCADE` removes actions. Audit-logged. |

Rate limit override moved from `POST /simulations` to `POST /scenarios` (30/min).

**[apps/api/src/routes/club.ts](apps/api/src/routes/club.ts)** — `GET /club/financials` now computes `currentSquadCosts` live by:
1. Loading active contracts for the club
2. Feeding them to `calculateSquadCosts` from the engine
3. Returning `currentSquadCosts` + `contractCount` in the response

`PUT /club/financials` no longer accepts `currentSquadCostsPounds` in the body — squad costs are roster-derived, not user-input.

**[apps/api/src/routes/simulations.ts](apps/api/src/routes/simulations.ts)** — **DELETED**. `POST /simulations` now returns 404 (verified in smoke test).

---

### Frontend (apps/web)

**Routing overhaul** ([apps/web/src/App.tsx](apps/web/src/App.tsx)):
- `/` → redirects to `/dashboard` (was `/simulator`)
- `/dashboard` → NEW DashboardPage
- `/scenarios` → NEW ScenariosPage
- `/roster` (Phase 2)
- `/calendar`, `/setup`, `/login` unchanged
- Legacy `/simulator`, `/history`, `/history/:id` all redirect to `/scenarios` (so old bookmarks don't 404)

**[apps/web/src/pages/DashboardPage.tsx](apps/web/src/pages/DashboardPage.tsx)** — new home view:
- Hero card: live SCR % (large, status-coloured), revenue / headroom block, "with N included scenarios" pill when Active Baseline differs from roster-only baseline
- Reuses existing `ComplianceGauge` component (takes 4 percentages, fully reusable)
- Per-player breakdown table with sortable columns: Name, Position, Wage, Amortisation, **Annualised Agent Fee**, Total/yr, To Expiry
- Filter chips: All / Expiring ≤ 6 mo / GK / DEF / MID / FWD
- Empty states for: no club setup, no roster, no players match filter

**[apps/web/src/pages/ScenariosPage.tsx](apps/web/src/pages/ScenariosPage.tsx)** — new Scenario Builder (~970 LOC):
- Two-column layout: 320px left rail (saved scenarios + Active Baseline summary card) + right pane (builder)
- Saved scenario row: checkbox to toggle `isIncluded`, click name to load into builder, trash to delete
- **Builder workspace**:
  - Name input + Save button (when editing, Save delete+recreate via API)
  - **Live projection card**: before/after SCR with status badge + ComplianceGauge
  - **Drag-and-drop action list** via `@dnd-kit/sortable` + `@dnd-kit/core` (new deps). Drag handle on each row, reordering recomputes the projection instantly.
  - "Add action" dropdown: Buy / Sell / Loan In / Loan Out / Release
  - Per-type forms with sensible auto-fill: selecting an existing player on sell/release/loan_out auto-populates wage relief + book value + amortisation relief from their contract
- **Compare A vs B modal**: two scenario dropdowns + projected SCR per scenario + ΔSCR, ΔCosts, ΔRevenue delta card

All math is **client-side** via `@headroom/engine` (`applyScenarioActions`). The API is just storage + audit.

**Store + client overhaul**:
- [apps/web/src/stores/club.ts](apps/web/src/stores/club.ts) — removed `simulations` state, added `scenarios: ScenarioDetail[]` with upsert/remove/setInclusion/setName actions
- [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) — removed `api.simulations.*`, added `api.scenarios.*` (create/list/get/update/delete). New types: `ScenarioSummary`, `ScenarioDetail`, `ScenarioAction`, `ScenarioActionPayload`
- [apps/web/src/lib/scr.ts](apps/web/src/lib/scr.ts) — rewritten on top of `applyScenarioActions`. New exports: `actionToEngineInput`, `statusFromRatio`, `computeActiveBaseline`, `computeScenarioImpact`, `computeDryRun`, `computeThresholds`
- [apps/web/src/components/layout/AppLayout.tsx](apps/web/src/components/layout/AppLayout.tsx) — TopBar pill now shows "Projected SCR" when any scenarios are included (vs "Current SCR" when only roster baseline)
- [apps/web/src/pages/ClubSetupPage.tsx](apps/web/src/pages/ClubSetupPage.tsx) — manual "Current Squad Costs" input replaced with a read-only derived value with the hint "Computed live from your active roster — manage players in the Roster tab"
- [apps/web/src/components/layout/Sidebar.tsx](apps/web/src/components/layout/Sidebar.tsx) — "Simulator" → "Dashboard", "History" → "Scenarios" (with new arrows-up-down icon for scenarios)

**Files deleted:**
- `apps/web/src/pages/SimulatorPage.tsx`
- `apps/web/src/pages/HistoryPage.tsx`
- `apps/web/src/lib/pdf.ts` (referenced legacy SimulationResponse; will be rebuilt in Phase 6)

**Auth store cleanup:**
- `apps/web/src/stores/auth.ts` and `apps/web/src/components/auth/ProtectedRoute.tsx` now reset `scenarios` instead of `simulations` on sign-out

---

### Shared (@headroom/shared)

[packages/shared/src/types.ts](packages/shared/src/types.ts) — exported `ScenarioActionType` alongside the existing `TransactionType` (so the web's api client can reference it without depending on the engine).

---

### New dependency

- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — for the Scenario Builder drag-to-reorder

---

### E2E verification (11/11 passing, live DB)

| # | Test | Result |
|---|---|---|
| 1 | `GET /club/financials` derives squadCosts from contracts | ✓ £45M from 6 contracts |
| 2 | `POST /scenarios` creates with ordered actions (buy + sell) | ✓ |
| 3 | `GET /scenarios` lists with actionCount joined | ✓ |
| 4 | `GET /scenarios/:id` returns actions in order_index order | ✓ buy@0, sell@1 |
| 5 | `PATCH /scenarios/:id` toggles isIncluded | ✓ |
| 6 | `PATCH /scenarios/:id` renames | ✓ |
| 7 | `POST /scenarios` rejects unknown playerId (FK defence) | ✓ 400 |
| 8 | `POST /scenarios` rejects empty name | ✓ 400 |
| 9 | `DELETE /scenarios/:id` cascades to actions | ✓ post-delete GET → 404 |
| 10 | `GET /scenarios/:id` of unknown id → 404 | ✓ |
| 11 | `POST /simulations` is gone (route removed) | ✓ 404 |

---

### Documented deviations from plan

| Plan said | Implemented | Reason |
|---|---|---|
| In-place edit via PATCH actions list | Editing an existing scenario does delete + recreate via DELETE + POST | Simpler API surface; FK CASCADE handles cleanup. Phase 4+ can add a PATCH action list endpoint if needed. |

---

### What's now correct vs Phase 2

- **Dashboard**: shows the live SCR derived from real contracts — no more `currentSquadCosts: 0` placeholder
- **TopBar SCR pill**: live; switches label to "Projected SCR" when scenarios are included
- **ClubSetupPage**: read-only squad costs field, no longer accepts manual input
- **No orphan routes**: legacy `/simulator`, `/history` redirect cleanly
- **No dead code**: SimulatorPage, HistoryPage, pdf.ts (legacy) all removed

### Engine / TypeScript

- Engine: 76/76 tests passing (59 + 7 squadCosts + 10 applyScenarioActions)
- API typecheck: 0 errors
- Web typecheck: 0 errors

---

## Session 13 — Phase 4: Premier League Module + SSR Tests (2026-05-27)

### What was accomplished

Phase 4 of [mvp_2.0_plan.md](mvp_2.0_plan.md): full PL solvency-test suite (Working Capital / Liquidity / Positive Equity) + league switch + promoted-club revenue uplift estimator. 13/13 E2E smoke tests pass.

---

### Engine — [packages/engine/src/ssr.ts](packages/engine/src/ssr.ts) (new module)

Three pure evaluator functions, plus the promoted-club uplift helper:

| Function | Returns |
|---|---|
| `evaluateWorkingCapitalMonth(input)` | per-month headroom + pass/fail against the £12.5M floor |
| `evaluateWorkingCapital(months[])` | season aggregate: months[], failingMonthCount, passing, worstHeadroomPence |
| `evaluateLiquidity(input)` | liquid assets + **40% × squad market value** − liabilities − £85M stress test |
| `evaluateEquity(input)` | liabilities / adjusted assets vs `seasonEquityThreshold(season)` (90% for 2026-27 → 85% for 2027-28 → 80% from 2028-29) |
| `seasonEquityThreshold(season)` | the tiered cap |
| `calculatePromotedClubRevenueUplift(championshipRevenuePence, factor?)` | Championship revenue × default 4.5× (overridable) |

Constants exported: `WORKING_CAPITAL_MINIMUM_PENCE = £12.5M`, `LIQUIDITY_STRESS_TEST_PENCE = £85M`, `LIQUID_ASSET_SQUAD_FRACTION = 0.40`, `PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR = 4.5`.

**19 new tests added** to `engine.test.ts` covering: monthly + aggregate working capital (including the empty-submission edge case where `passing=true` + `worstHeadroomPence=0`), liquidity with/without squad uplift, equity at exact threshold + tightening across seasons, defensive zero/negative assets (returns Infinity ratio), uplift with custom factor + non-positive inputs.

**Engine test count: 95/95 passing** (was 76 at end of Phase 3).

---

### Database — three new tables

[apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma):

```prisma
model SsrWorkingCapital { id, clubId, season, yearMonth, adjustedCashflow, qualifyingFunds, ... @@unique([clubId, season, yearMonth]) }
model SsrLiquidity       { id, clubId, season, liquidAssets, liquidLiabilities, squadMarketValue, ... @@unique([clubId, season]) }
model SsrEquity          { id, clubId, season, totalLiabilities, adjustedAssets, ... @@unique([clubId, season]) }
```

Migration: [apps/api/prisma/migrations/20260527000002_mvp2_ssr_tables/migration.sql](apps/api/prisma/migrations/20260527000002_mvp2_ssr_tables/migration.sql). Idempotent — wraps FK constraint adds in `DO $$ IF NOT EXISTS … $$` blocks because we ran the migration twice during development (first run failed mid-way and left tables present but constraints missing).

**RLS**: extended [apps/api/prisma/rls.sql](apps/api/prisma/rls.sql) with three new `FOR ALL` policies (one per table, all using `current_club_id()`). Also dropped the redundant `DROP FUNCTION IF EXISTS public.current_club_id()` line from the top of rls.sql — `CREATE OR REPLACE` handles updates cleanly and the DROP failed in PG because dependent policies exist.

Applied to Supabase via the same `aws-1-ap-southeast-1.pooler.supabase.com` host from Phase 1. Verified all 3 tables exist and all 3 canonical policies are in pg_policies.

---

### API — [apps/api/src/routes/ssr.ts](apps/api/src/routes/ssr.ts) (new)

6 endpoints. Every one runs the engine after the DB read so callers get the live pass/fail result inline with the stored inputs.

| Endpoint | Behaviour |
|---|---|
| `GET /ssr/working-capital?season=…` | All months for season + `evaluateWorkingCapital(months)` aggregate |
| `PUT /ssr/working-capital` | Upsert one month (select-then-update-or-insert) |
| `GET /ssr/liquidity?season=…` | Single row + `evaluateLiquidity(input)` result |
| `PUT /ssr/liquidity` | Upsert single row |
| `GET /ssr/equity?season=…` | Single row + `evaluateEquity(input)` result |
| `PUT /ssr/equity` | Upsert single row |

**PL-only guard**: every endpoint runs `ensurePremierLeague(request, reply)` first, which looks up `clubs.league_id`. Championship clubs get a flat **404 Not Found** — no information leak about the existence of SSR routes. Defence-in-depth on top of RLS.

**Role guard**: CFO + Admin + Finance Analyst can mutate; all roles can read. Audit log row written on every mutation (non-fatal).

[apps/api/src/routes/club.ts](apps/api/src/routes/club.ts) — also added `PATCH /club/league` (CFO + Admin only) so the UI can flip between Championship and PL. Records before/after in audit_logs.

---

### Web — [apps/web/src/pages/SSRPage.tsx](apps/web/src/pages/SSRPage.tsx) (new)

Three tabs (Working Capital / Liquidity / Positive Equity) following the [design/src/uikit.jsx](design/src/uikit.jsx) tab pattern (border-bottom underline indicator, violet-700 active text).

- **Working Capital tab**: 12-row table (Jul 2026 → Jun 2027). Per-row `PoundCell` inputs for adjusted cashflow + qualifying funds. Dirty-tracking — Save button per row appears only when the row has unsaved changes. Headline card with green/red left border showing `worstHeadroomPence` + failing-month count.
- **Liquidity tab**: 3 input fields + live preview computation matching the engine (assets + 40%×squad market value − liabilities − £85M). 3-column stat block grid showing effective liquid assets, stress threshold, and resulting headroom.
- **Equity tab**: 2 input fields + threshold-tier readout. Shows ratio + margin in percentage points + the season's tier (90% for 2026-27, 85% for 2027-28, 80% onwards).

**Visibility gating**: client-side guard in `SSRPage` ("Premier League only" empty state with a link to Settings) PLUS sidebar filtering. SSR nav item carries `plOnly: true`; the Sidebar's filter only renders nav items where `plOnly` is unset or matches `leagueId === 'premier-league'`. Workspace block subtitle now reads "Premier League" or "EFL Championship" instead of always being Championship.

---

### Web — [apps/web/src/pages/ClubSetupPage.tsx](apps/web/src/pages/ClubSetupPage.tsx) (extended)

New top card: **League selector** with segmented "EFL Championship / Premier League" toggle. Hits `PATCH /club/league` and updates the local store on success so the SSR sidebar link appears immediately. The owner-equity input is now conditionally hidden when on PL (since PL clubs have no owner-equity allowance).

**Promoted-club uplift estimator** (PL only): collapsible panel under the League card with 3 inputs (last Championship revenue, uplift factor, default 4.5×) and an "Apply to revenue field →" action that writes the estimate into the form's `footballRelatedRevenuePounds`. Uses `calculatePromotedClubRevenueUplift` from the engine.

---

### Web — [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) — new `api.ssr.*` + `api.club.setLeague`

New typed methods:
- `api.ssr.getWorkingCapital(season)` / `putWorkingCapital(input)`
- `api.ssr.getLiquidity(season)` / `putLiquidity(input)`
- `api.ssr.getEquity(season)` / `putEquity(input)`
- `api.club.setLeague(leagueId)`

New response types: `WorkingCapitalResponse`, `LiquidityResponse`, `EquityResponse` (each containing the stored row(s) + the server-evaluated result).

---

### E2E verification (13/13 passing, live DB)

| # | Test | Result |
|---|---|---|
| 1 | Initial club is on Championship | ✓ |
| 2 | SSR routes return 404 for Championship clubs | ✓ |
| 3 | `PATCH /club/league` switches to PL | ✓ |
| 4 | SSR routes now accessible after switch | ✓ |
| 5 | `PUT /ssr/working-capital` writes a month | ✓ |
| 6 | `GET /ssr/working-capital` returns correct +£2.5M headroom for the seeded month | ✓ |
| 7 | `PUT /ssr/working-capital` is idempotent (same row id reused) | ✓ |
| 8 | Liquidity round-trip: 50M + 40M − 0 − 85M = +£5M | ✓ |
| 9 | Equity round-trip: 0.5 ratio, 0.90 cap, pass | ✓ |
| 10 | Equity correctly fails at 0.95 (> 0.90 cap) | ✓ |
| 11 | Invalid season format → 400 | ✓ |
| 12 | Switch back to Championship → SSR 404 again | ✓ |
| 13 | Initial league restored at end (clean dev env) | ✓ |

### Engine / TypeScript

- Engine: 95/95 tests passing (76 + 19 SSR)
- API typecheck: 0 errors
- Web typecheck: 0 errors

---

## Session 14 — Phase 5: Auth Invites + RBAC + Tamper-Evident Audit (2026-05-27)

### What was accomplished

Phase 5 of [mvp_2.0_plan.md](mvp_2.0_plan.md): full invite flow + role-based access control across both API and UI + Activity Log viewer. 15/15 E2E smoke tests pass.

---

### Database

[apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) — new `Invite` model:

```prisma
model Invite {
  id, clubId, email, role, invitedBy, token (unique),
  expiresAt, acceptedAt, createdAt
  @@index([email, acceptedAt])
}
```

Migration [apps/api/prisma/migrations/20260527000003_mvp2_invites/migration.sql](apps/api/prisma/migrations/20260527000003_mvp2_invites/migration.sql) — idempotent (FK add guarded by `DO $$ IF NOT EXISTS $$`). Applied to Supabase, RLS extended with one new policy (`invites: own club only`).

---

### API — three new files + RBAC refactor

**[apps/api/src/lib/audit.ts](apps/api/src/lib/audit.ts)** — single `writeAuditLog(request, table, recordId, action, newValue?, previousValue?)` helper used by every mutating route. Failure is non-fatal (warn log). The duplicate copies that were in roster/scenarios/ssr have been removed.

**[apps/api/src/middleware/roles.ts](apps/api/src/middleware/roles.ts)** — two exports:
- `requireRole(...allowed)` — Fastify preHandler hook (admin implicit in every check)
- `hasRole(role, ...allowed)` — inline predicate for mid-handler branches (e.g. PATCH /scenarios where rename is universal but isIncluded toggle is restricted)

Returns 403 on mismatch — **not 404** (404 is reserved for "resource doesn't exist for this club" like SSR on Championship).

**[apps/api/src/routes/invites.ts](apps/api/src/routes/invites.ts)** — 5 endpoints:

| Endpoint | Auth | Role | Behaviour |
|---|---|---|---|
| `GET /invites/lookup?token=…` | **public** | n/a | returns email + role + clubName; 404 unknown/expired/accepted |
| `POST /invites` | required | CFO | creates row with 32-byte URL-safe token + 7-day expiry. Rejects duplicate emails (409). Returns the token (CFO copies into invite link). |
| `GET /invites` | required | CFO | lists with computed `status: 'pending' \| 'accepted' \| 'expired'`. Includes the token for pending invites so CFO can copy the link again. |
| `DELETE /invites/:id` | required | CFO | revokes pending invite. 409 on accepted invites (immutable history). |
| `GET /team` | required | CFO | lists current club members for the Settings → Team UI. |

Token: `randomBytes(32).toString('base64url')` — 43-char URL-safe string, infeasible to brute-force in the 7-day window.

**[apps/api/src/routes/audit.ts](apps/api/src/routes/audit.ts)** — read-only Activity Log:
- `GET /audit?from=YYYY-MM-DD&to=YYYY-MM-DD&user=<id>&table=<name>&page=1&limit=50` (CFO only)
- Joined `users` for the actor name; pagination + total count; max limit 200
- Malformed date strings are silently ignored rather than 400ing (safe parse)

**[apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)** — invite-aware auto-provisioning:
- When a brand-new auth user signs in (no `public.users` row), look up `invites` by email
- If a non-expired, not-yet-accepted invite exists → attach the new user to that invite's `club_id` with the invite's `role`
- Otherwise fall back to the existing "fresh isolated workspace as CFO" path (founder)
- On success, mark `invites.accepted_at = now()` (non-fatal)

**[apps/api/src/routes/club.ts](apps/api/src/routes/club.ts)** — additions + tightening:
- New `GET /me` returns `{ id, role, fullName, email }` — used by the frontend `useRole()` hook to gate UI affordances
- `PUT /club/financials` tightened from `cfo + admin + finance_analyst` → **CFO + Admin only** (per role matrix — Finance Analyst handles roster/SSR data entry, not season-level financial config)
- `PATCH /club/league` now uses `requireRole('cfo')`
- All audit writes routed through `writeAuditLog`

**[apps/api/src/routes/scenarios.ts](apps/api/src/routes/scenarios.ts)** — `PATCH /scenarios/:id` now branches:
- Rename (just `name` in body): allowed for all authenticated users
- Toggle `isIncluded`: restricted to **CFO + Sporting Director** (per role matrix)

[apps/api/src/routes/roster.ts](apps/api/src/routes/roster.ts) and [apps/api/src/routes/ssr.ts](apps/api/src/routes/ssr.ts) — refactored to import `hasRole` + `writeAuditLog` from the new central modules. No behavioural changes.

---

### Web — RBAC hook + Settings tabs

**[apps/web/src/lib/role.ts](apps/web/src/lib/role.ts)** — new module:
- `useRole()` calls `/me` once per session, caches in localStorage to prevent flicker on refresh
- `useCan()` exposes predicates aligned with the API matrix: `editClubFinancials`, `switchLeague`, `mutateRoster`, `toggleActiveBaseline`, `mutateSsr`, `inviteMembers`, `viewAuditLog`, etc.

**[apps/web/src/pages/ClubSetupPage.tsx](apps/web/src/pages/ClubSetupPage.tsx)** — restructured into tabs:
- Renamed shell to "Settings" with tab nav: Financials / Team / Activity Log (last two CFO-only)
- Tabs are URL-hash-routed (`#team`, `#activity`) for bookmarkable deep links
- **TeamTab**: invite form (email + role dropdown), `justCreated` link card with copy-to-clipboard, members table, pending invites table with copy-link + revoke
- **ActivityTab**: paginated audit log table (50 per page), action badge (`create`/`update`/`delete` with semantic colours), resource label map (`ssr_working_capital → "Working Capital"`)

**[apps/web/src/pages/LoginPage.tsx](apps/web/src/pages/LoginPage.tsx)** — invite-aware:
- Reads `?invite=<token>` from URL on mount
- Calls public `GET /invites/lookup` to fetch email + club + role
- Shows an invitation banner: "Invitation to {Club Name} — You've been invited to join as {Role}"
- Default mode becomes signup; email field pre-filled and read-only (bound to the token)
- All post-login redirects updated `/simulator` → `/dashboard` (MVP 2.0 home)

**Frontend RBAC gating** (UI hides what the API would reject):
- [apps/web/src/pages/RosterPage.tsx](apps/web/src/pages/RosterPage.tsx) — Upload CSV / Add Player buttons hidden for Sporting Director. Player edit drawer hides Save changes + Archive player buttons for read-only roles.
- [apps/web/src/pages/ScenariosPage.tsx](apps/web/src/pages/ScenariosPage.tsx) — Active Baseline checkbox replaced with a read-only swatch for Finance Analyst (preserves the visual indicator without exposing the input).
- ClubSetupPage tabs already gated by `can.inviteMembers` / `can.viewAuditLog`.

**[apps/web/src/lib/api.ts](apps/web/src/lib/api.ts)** — new namespaces: `api.me.get`, `api.invites.{list, create, revoke, lookup}`, `api.team.list`, `api.audit.list`. All typed via new interfaces (`InviteRow`, `TeamMember`, `AuditEntry`).

---

### Role matrix (enforced both server + UI)

| Capability | CFO | Sporting Director | Finance Analyst |
|---|:-:|:-:|:-:|
| View dashboard / scenarios / calendar / SSR (PL) | ✓ | ✓ | ✓ |
| Edit club financial settings | ✓ | – | – |
| Switch league (Championship / PL) | ✓ | – | – |
| Manage roster (CSV / add / edit / archive) | ✓ | – | ✓ |
| Create / save / delete scenarios | ✓ | ✓ | ✓ |
| Toggle scenario `is_included` (Active Baseline) | ✓ | ✓ | – |
| Invite + remove team members | ✓ | – | – |
| View Activity Log | ✓ | – | – |
| SSR data entry (PL only) | ✓ | – | ✓ |

Admin role bypasses every restriction (reserved for internal Headroom staff).

---

### Invite flow (end-to-end)

1. CFO opens Settings → Team, enters email + role → POST /invites
2. Server stores row with 32-byte token + 7-day expiry, returns token
3. UI displays `${origin}/login?invite=<token>` with copy-to-clipboard
4. CFO sends link manually (MVP 2.0; SMTP/Resend wiring deferred to a later milestone — design supports either)
5. Invitee opens link → LoginPage reads token, calls public `/invites/lookup`, shows "Invitation to {club}" banner
6. Invitee enters password → standard 8-digit OTP signup → first authenticated request hits `authMiddleware`
7. Middleware sees no `public.users` row + finds matching invite → creates user with invite's club_id + role, marks invite accepted
8. Audit log captures the invite creation, accept, and any subsequent revoke

---

### E2E verification (15/15 passing, live DB)

| # | Test | Result |
|---|---|---|
| 1  | `GET /me` returns role + name | ✓ cfo |
| 2  | `POST /invites` creates pending invite | ✓ |
| 3  | Public `GET /invites/lookup` works without auth | ✓ |
| 4  | Lookup of unknown token → 404 | ✓ |
| 5  | Duplicate invite for same email → 409 | ✓ |
| 6  | `GET /invites` lists with copy-token | ✓ |
| 7  | `GET /team` returns members | ✓ |
| 8  | `DELETE /invites/:id` revokes + invalidates lookup | ✓ |
| 9  | `PUT /club/financials` works for CFO | ✓ |
| 10 | `GET /audit` returns entries | ✓ |
| 11 | `GET /audit?table=invites` filters correctly | ✓ |
| 12 | `GET /audit?from=&to=` date filter works | ✓ |
| 13 | Audit safely ignores invalid date strings | ✓ |
| 14 | `PATCH /scenarios/:id` rename allowed for all auth users | ✓ |
| 15 | Cleanup `DELETE /scenarios/:id` | ✓ |

### Engine / TypeScript

- Engine: 95/95 tests passing (unchanged from Phase 4)
- API typecheck: 0 errors
- Web typecheck: 0 errors
