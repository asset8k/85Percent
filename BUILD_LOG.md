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
