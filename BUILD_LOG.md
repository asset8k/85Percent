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

---

## Session 15 — Phase 6: PDF + Excel Exports + MVP 2.0 Audit (2026-05-28)

### What was accomplished

Phase 6 of [mvp_2.0_plan.md](mvp_2.0_plan.md) — three client-side board-ready export flows. Then a holistic MVP 2.0 bug sweep that caught two real issues. **MVP 2.0 is now feature-complete.**

---

### New module: [apps/web/src/lib/exports/](apps/web/src/lib/exports)

**Shared primitives** ([pdfBase.ts](apps/web/src/lib/exports/pdfBase.ts), [excelBase.ts](apps/web/src/lib/exports/excelBase.ts)):
- `addHeader`, `addFooter`, `addSectionHeader`, `addStatusPill`, `addComplianceGauge`, `finalizeFooters` — match design-system tokens (violet-700 accents, slate body, status colours) so every PDF reads as the same product
- `pdfMoney`, `pdfPct` — display formatters using the same `formatPence` the UI uses (negatives render with U+2212 so jspdf doesn't reflow)
- `GBP_FORMAT`, `applyNumberFormatToColumn`, `freezeHeaderRow`, `downloadBlob` — XLSX helpers, all on the Community SheetJS build (no styling licence required)
- `__setDownloadBlobForTesting` — swap hook on `downloadBlob` so Node-based smoke tests can capture the buffer without trying to mutate ESM module bindings

**Compliance gauge drawn natively in jsPDF** — no `html2canvas` dependency. Three coloured zones + dashed threshold markers + position arrows for current + projected SCR. Print-friendly and reproducible.

**Three exports** ([squadPdf.ts](apps/web/src/lib/exports/squadPdf.ts), [amortisationXlsx.ts](apps/web/src/lib/exports/amortisationXlsx.ts), [comparisonPdf.ts](apps/web/src/lib/exports/comparisonPdf.ts)):

| Export | Trigger | Output |
|---|---|---|
| Squad financial report | Dashboard → "Export PDF" | A4 PDF: executive summary stat row, compliance gauge, per-player SCR table sorted by total cost desc, expiring-contracts callout (≤ 6 mo), disclaimer footer on every page |
| Amortisation schedules | Roster → "Export Excel" | XLSX with Index + per-player + Summary sheets. £ format (`£#,##0;[Red]−£#,##0`) registered in styles.xml so cells render correctly in Excel/Numbers. Frozen header rows. Numeric cells (not strings) so SUM/SORT work natively. |
| Scenario comparison | Scenarios → Compare modal → "Export comparison PDF" | A4 PDF, 3 pages: per-scenario (A) summary + actions, per-scenario (B), delta page with ΔSCR / ΔCosts / ΔRevenue + side-by-side metric table |

**Deps added:** `xlsx@0.18.5` (SheetJS Community). `jspdf` + `jspdf-autotable` were already present from MVP 1.0.

**Page wiring:**
- [DashboardPage](apps/web/src/pages/DashboardPage.tsx) — "Export PDF" button (header right, disabled when roster is empty)
- [RosterPage](apps/web/src/pages/RosterPage.tsx) — "Export Excel" button (header right, available to all roles since it's read-only)
- [ScenariosPage](apps/web/src/pages/ScenariosPage.tsx) — "Export comparison PDF" link in the Compare modal's delta card

---

### E2E verification — Playwright + Chromium headless

Drove the running dev app through all three flows with a real browser. **3/3 exports downloaded as valid files.**

| File | Size | Validation |
|---|---|---|
| `headroom-squad-2026-27.pdf` | 25 KB, 1 page | `%PDF` magic ✓ · disclaimer string present ✓ |
| `headroom-amortisation-Headroom-Dev-FC-…xlsx` | 18 KB | ZIP magic ✓ · 8 sheets (Index + 6 per-player + Summary) · £ format registered in `xl/styles.xml` (numFmtId 60, `£#,##0;[Red]−£#,##0`) and referenced by money cells via `s="1"` |
| `headroom-compare-…vs-….pdf` | 30 KB, 3 pages | `%PDF` magic ✓ · disclaimer string present ✓ |

Summary sheet round-trip: 2026-27 row totals £45,035,404.75 — matches the live Dashboard derived squad costs exactly. No drift across engine → API → DB → re-read.

---

### MVP 2.0 holistic bug sweep — two fixes

After Phase 6, ran a `grep`-driven cross-phase review covering: lingering refs to dropped tables/columns, missing role guards, missing audit calls, BigInt→Number coverage, engine purity, money math sanity, `.single()` vs `.maybeSingle()`, console leaks, swallowed promise rejections. Two real bugs surfaced:

**Bug A — [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts) orphan cleanup deleted from dropped `simulations` table.**
- Phase 1 dropped `simulations`, but the auth middleware's orphan-cleanup path (triggered when an email re-registers after deletion from `auth.users`) still ran `from('simulations').delete()` first. Any matching cleanup would have 503'd because the table no longer exists.
- Fix: replaced with `from('scenarios').delete()` (FK to `scenario_actions` cascades automatically). Audit-log cleanup unchanged.

**Bug B — [packages/shared/src/schemas.ts](packages/shared/src/schemas.ts) carried four dead MVP 1.0 schemas with stale `currentSquadCosts*` fields.**
- `ClubFinancialsSchema`, `TransferInputSchema`, `TransferFormSchema`, `ClubFinancialsInputSchema` + their `z.infer` type aliases — none of these were imported anywhere in MVP 2.0 (grep-verified). They referenced the dropped `currentSquadCosts` column.
- Fix: removed all four + their type aliases. Routes define their own Zod bodies inline; engine consumes typed interfaces from `types.ts` directly. No runtime impact (dead code), but eliminates a footgun.

Both fixes are in this commit. 95/95 engine tests still pass; all 4 packages typecheck clean.

---

### MVP 2.0 final state

| Metric | Value |
|---|---|
| Engine tests | 95 / 95 passing |
| TypeScript errors | 0 across engine, shared, api, web |
| Web production build | 1.4 MB main bundle (gzip 427 KB); 0 errors |
| API routes | 31 endpoints across 6 route files |
| New DB tables (MVP 2.0) | players, contracts, scenarios, scenario_actions, ssr_working_capital, ssr_liquidity, ssr_equity, invites |
| Dropped tables | simulations |
| Dropped columns | club_financials.current_squad_costs (now derived from contracts) |
| RLS policies | 12 (all `FOR ALL`, isolated via `current_club_id()`) |
| Audit log coverage | every mutating route writes one row via `writeAuditLog` (non-fatal on failure) |
| Role matrix enforced | API via `requireRole` / `hasRole`; UI via `useCan()` |
| Engine purity | preserved — only `new Date()` defaults in `asOf` parameters; deterministic when called with explicit dates |

### Cumulative E2E coverage (live DB, across sessions)

- Phase 1: RLS smoke — 8/8 tables block anon
- Phase 2: 11/11 roster + CSV staging
- Phase 3: 11/11 scenarios + derived squad costs
- Phase 4: 13/13 SSR + league switch + 404 isolation
- Phase 5: 15/15 invites + RBAC + audit log + filters
- Phase 6: 3/3 export downloads via headless Chromium

**Total: 61 E2E smoke checks passing.**

### Engine / TypeScript

- Engine: 95/95 tests passing
- API typecheck: 0 errors
- Web typecheck: 0 errors
- Web production build: 0 errors

---

## Session 16 — Post-MVP 2.0 polish: squad-costs mode, archive actions, scenarios redesign, animation pass (2026-05-29)

A long polish session driven by user-reported UX bugs and feature requests on top of shipped MVP 2.0.

### Squad-costs source toggle (derived vs manual)

**Why:** Some users want to model arbitrary squad-cost scenarios without rebuilding the roster — e.g. "what if our wage bill was £80M?"

- New columns on `club_financials`: `squad_costs_mode TEXT NOT NULL DEFAULT 'derived'` (CHECK in `'derived' | 'manual'`) + `manual_squad_costs BIGINT NULL` ([apps/api/prisma/migrations/20260528000001_squad_costs_mode/migration.sql](apps/api/prisma/migrations/20260528000001_squad_costs_mode/migration.sql))
- `GET /club/financials` returns `squadCostsMode`, `derivedSquadCosts`, `manualSquadCosts`. The effective `currentSquadCosts` is auto-resolved server-side, so every downstream surface (top-bar SCR pill, Dashboard, Scenarios, SSR) picks up the override with **zero call-site changes** ([apps/api/src/routes/club.ts](apps/api/src/routes/club.ts))
- `PUT /club/financials` validates `manualSquadCostsPounds` is required when mode=manual; preserves the manual value when toggling back to derived (non-destructive toggle)
- Settings UI: replaced the disabled "Squad Costs (derived)" tile with a segmented `SquadCostsModeToggle` + conditional `£` input ([apps/web/src/pages/ClubSetupPage.tsx](apps/web/src/pages/ClubSetupPage.tsx))

### Roster polish: archive delete / restore + icon-button row actions

- New endpoints: `POST /roster/player/:id/restore` (un-archives + reactivates most recent contract by `created_at DESC`) and `DELETE /roster/player/:id` (archived-only, FK cleanup order: `scenario_actions → contracts → players`, audit log written **before** final delete so trail survives) ([apps/api/src/routes/roster.ts](apps/api/src/routes/roster.ts))
- Archived roster rows get icon-button actions (restore = rotate-ccw glyph, delete = trash) with inline two-step confirm ("Delete {name}?" → check/cancel icons). Pending state swaps glyph for Spinner so the row never goes dead
- Top-bar SCR stale-after-mutation bug fixed: `RosterPage.refresh()` now re-fetches `/club/financials` in parallel so `useClubStore.financials.currentSquadCosts` updates after add/edit/archive/restore/delete
- Contract length cap raised 7y → 10y to accommodate Chelsea-style ultra-long deals ([packages/shared/src/schemas.ts](packages/shared/src/schemas.ts) + API contract PATCH)

### Settings + Team: icon actions, layout fixes, OTP fixes

- Team pending-invite rows: replaced text "Copy link"/"Revoke" buttons with icon buttons (CopyIcon → CheckIcon for 2s on success, TrashIcon with two-step confirm). Per-row `copiedInviteId` state ([apps/web/src/pages/ClubSetupPage.tsx](apps/web/src/pages/ClubSetupPage.tsx))
- Manual squad-costs `£` glyph centering bug fixed (hint `<p>` was inside `relative` wrapper, inflating bounding box for `top-1/2` calc)
- "Roster sum (ignored)" hint removed from manual mode per user feedback (too much text)
- `sticky top-20` removed from Calculated Thresholds card — was breaking alignment with Season Financials in PL mode (Promoted-club uplift block adds height, sticky activated and shifted right card down). Now both cards use `self-start` only and align naturally in both leagues
- **Invite signup bug fixed**: `prefillEmail` arrives async from `api.invites.lookup`, but RHF's `defaultValues` only run on mount → email field stayed empty *and* became read-only once `emailLocked` flipped. Added `useEffect` calling `form.setValue('email', prefillEmail, { shouldValidate: true })` ([apps/web/src/pages/LoginPage.tsx](apps/web/src/pages/LoginPage.tsx))
- **OTP screen** width bug: `OTP_LENGTH = 8` but cells sized for 6, also text said "6-digit code". Switched to `OTP_LENGTH` interpolation in label, sized cells `w-10 h-12 gap-1` with `ml-3` on cell 5 for 4+4 visual grouping (356px total, fits 364px inner width)

### Scenarios redesign (user-driven)

Original layout had a redundant "Active Baseline" card on the left rail duplicating top-bar SCR + projection panel. The include-in-plan tick was confusing.

- New `<Switch>` UI primitive — proper sliding toggle with size variants + portal-based tooltip that escapes ancestor `overflow:hidden` ([apps/web/src/components/ui/switch.tsx](apps/web/src/components/ui/switch.tsx))
- Saved-scenario rows: tick → Switch, bold violet left-edge accent + soft violet tint when in-plan, `"X of Y in plan · 73.2% SCR"` compact footer replaces removed Active Baseline card
- Live Projection gets a header status chip (3 states: `In active plan` / `Not in plan` / `Draft — save to include`) with inline Switch so user can toggle without scrolling. "With this plan" tile gets a violet ring + "✓ Currently driving SCR" caption when included ([apps/web/src/pages/ScenariosPage.tsx](apps/web/src/pages/ScenariosPage.tsx))

### Animation pass (new)

Installed `framer-motion` (~50KB gzip). Built a complete animation system:

**Primitives** ([apps/web/src/components/ui/](apps/web/src/components/ui/)):
- `progress-bar.tsx` — reference-counted top sweep + `useProgress` zustand store, every `apiFetch` calls start/done in try/finally so it tracks real outstanding network
- `skeleton.tsx` + `page-skeletons.tsx` — shimmer block + page-shaped skeletons (Dashboard, Roster, Scenarios, FormPage for SSR/Settings) replacing the full-screen `PageLoader` everywhere
- `animated-number.tsx` — count-up with `useInView` so off-screen value changes don't fake-animate
- `toast.tsx` — imperative `toast.success/error/info` + spring-eased `ToastHost`. Replaces inline "Settings saved" text
- `spinner.tsx` — new `PageLoader` using the Headroom mark with breathing-pulse bars

**CSS** ([apps/web/src/index.css](apps/web/src/index.css)):
- `shimmer`, `hr-mark-bar`, `hr-mark-pulse`, `hr-progress-indeterminate` keyframes
- `.card-lift` utility for subtle hover lift
- `prefers-reduced-motion` guard silences all motion-related animation

**Wiring**:
- `AppLayout`: mounts `<ProgressBar />` + `<ToastHost />`, wraps `<Outlet />` in `<AnimatePresence mode="wait">` keyed on first path segment for route fade+lift transitions, animates the top-bar SCR pill number + status dot color crossfade
- `ComplianceGauge`: zone widths + marker positions become `motion.div`s with spring sweep when scenarios toggle; projected color crossfades on green↔amber↔red transitions
- `StatusBadge`: `motion.span` crossfades bg + fg colors on status change
- All Roster modals (CSV / Add player / Edit player — they share `ModalShell`) + Scenarios `CompareModal`: pure-fade entrance (no `y`, no `scale` — user reported 8px slide read as a layout shift). 160ms ease-out

### Files touched / added

- 19 modified files (~1500 insertions, ~300 deletions)
- 1 new migration directory: `20260528000001_squad_costs_mode/`
- 6 new UI primitives: `animated-number.tsx`, `page-skeletons.tsx`, `progress-bar.tsx`, `skeleton.tsx`, `switch.tsx`, `toast.tsx`

### Verification

- Web typecheck: 0 errors
- API typecheck: 0 errors
- Web production build: 1.81 MB / 539 KB gzipped (+49 KB for framer-motion, as estimated)
- Manual checks: route transitions, modal fades, gauge sweep on scenario toggle, count-up on Dashboard / Scenarios / Settings, archive restore + delete flow, manual squad-costs mode end-to-end, invite signup flow with prefilled email, 8-digit OTP layout
- DB migration **not yet applied** to live Supabase — user to run `pnpm --filter @headroom/api exec prisma migrate deploy` when ready

---

## Session 17 — Settings polish, SCR breakdown popover, and Red Threshold math fix (2026-05-29)

Continuation of post-MVP 2.0 polish. Three focused asks plus a regulatory-math bug surfaced by the user.

### Settings: League switch + promoted-club section

- **League switch is now a magic-ink toggle.** Replaced the two-button colour swap with a `LeagueSwitch` component in [apps/web/src/pages/ClubSetupPage.tsx](apps/web/src/pages/ClubSetupPage.tsx#L1227-L1309). A single `motion.span` with `layoutId="league-pill"` slides between tabs via Framer FLIP (`spring stiffness 480, damping 38`) instead of cutting. No more snap; the pill feels physically continuous between EFL and PL.
- **Loader actually works in both directions now.** Old code only showed the spinner when switching *to* PL (`leagueId !== 'premier-league'` happened to bias one way). New `pendingLeague` state drives an optimistic pill slide on click — the pill animates to the target *immediately*, and a width-animated spinner fades in inside the target tab. A thin violet underline grows left→right beneath the pending tab while the API call resolves. On failure, `pendingLeague` is cleared and the pill snaps back.
- **Promoted-from-Championship redesign.** Old card was a flat `border-violet-100 bg-violet-50/40` 3-column grid that the user called "ugly and simple". Replaced with: violet-chip header with an uplift arrow icon, an `AnimatePresence` height+opacity collapse, a gradient card body (`from-violet-50/60 via-white to-violet-50/30`), and a 5-column visual equation (`revenue × factor → result`) where the `×` and `→` glyphs sit in their own dedicated columns. The result is a raised white tile with `AnimatedNumber` counting up the £. Footer row shows a pill-shaped "2.5× revenue jump" badge alongside a proper `Button` instead of an inline link.

### DB migration applied

- Production hit `500 Failed to save financials` on PUT `/club/financials` because the `squad_costs_mode` / `manual_squad_costs` columns added in Session 16 weren't actually deployed.
- Prisma's history was out of sync (`P3005` from `migrate deploy` — pre-MVP-2.0 migrations had been applied via `db push` but not recorded). Resolved 3 prior migrations as `applied` to backfill the `_prisma_migrations` table, then `prisma migrate deploy` ran the one truly-pending migration and added both columns + the CHECK constraint to live Supabase. Migration status now: "Database schema is up to date."

### SCR breakdown popover (top-bar pill)

- The top-bar Projected/Current SCR pill is now clickable. Click opens a portal-rendered popover anchored to the pill's bottom-right ([apps/web/src/components/layout/AppLayout.tsx:131-373](apps/web/src/components/layout/AppLayout.tsx#L131-L373)) that explains how the number was assembled.
- Sections:
  1. **Header** — title (`Current SCR` if no scenarios stacked, `Projected SCR` otherwise), big SCR % with status chip; when stacked, an extra sub-line "Settings only: X% ↑ Y pp" makes the scenario delta obvious.
  2. **From Settings** — football-related revenue, owner-equity top-up (1yr) if any, squad costs with a source hint ("Derived from active roster" / "Manual override"), current allowance.
  3. **Scenarios stacked** — `N of M` counter and a violet-tinted list of each included scenario's **name** + action count. Empty state: dashed-border card explaining "SCR is calculated from Settings + your active roster."
  4. **Footer** — adjusted-revenue line + "Manage scenarios →" link.
- Dismiss on Esc, outside click, close ×, or footer link (auto-closes). Chevron on the pill rotates 180° via Framer when open. Position re-measures on `resize` and `scroll` so the popover stays glued to the pill in a sticky header.
- Pulled `computeActiveBaseline(financials, [])` once at render to derive the "Settings-only" SCR for the delta line — settings-only is the same as current-baseline with `included.length === 0`.

### Bug fix: Red Threshold math (regulatory-additive, not multiplicative)

User flagged: UI showed "RED THRESHOLD (115%) £55,250,000" for revenue £50M / 30% allowance, but `0.85 × £50M = £42.5M` and `1.15 × £50M = £57.5M` — the £55.25M was `green × (1 + allowance) = £42.5M × 1.30 = £55.25M`, i.e. 110.5% of revenue, not 115%. **Label and value disagreed.**

Root cause: three sites coded the threshold multiplicatively (`red = green × (1 + allowance)`) but the label was computed additively (`green% + allowance%`). The multiplicative formula was even commented as deliberate in [apps/web/src/lib/scr.ts](apps/web/src/lib/scr.ts#L46-L49).

Per the regulatory framework (EFL/PL SCR rule), the allowance is **additive on top of the baseline cap**:

```
Red Threshold = Revenue × (greenRatio + allowanceRatio)
              = Revenue × (0.85 + 0.30) = Revenue × 1.15
```

Fixed in three sources of truth:

- [packages/engine/src/thresholds.ts:19](packages/engine/src/thresholds.ts#L19) — canonical engine: `red = floor(adjustedRevenue × (greenRatio + allowance))`. JSDoc rewritten to spell out the formula and give the £50M / 30% example as a counter-example to the old bug.
- [apps/web/src/lib/scr.ts:53](apps/web/src/lib/scr.ts#L53) — `statusFromRatio`: `redRatio = greenRatio + allowance` (was `× (1 + allowance)`).
- [apps/web/src/lib/scr.ts:198-199](apps/web/src/lib/scr.ts#L198-L199) — `computeThresholds`: red is computed direct from revenue, not from green.
- [apps/web/src/pages/ClubSetupPage.tsx:121-126](apps/web/src/pages/ClubSetupPage.tsx#L121-L126) — Settings right-rail computation + amber/red zone classifier both switched to additive.

Engine tests (95 total) updated for the new BASE_FINANCIALS fixture math:

- BASE: revenue £20M, 30% allowance → red was £22.1M, **now £23M** (1.15 × £20M).
- Reduced-allowance test (15%): red was `floor(£17M × 1.15) = £19,549,999`, **now £20M** (1.00 × £20M).
- Zero-allowance test: red === green still holds under additive ✓.
- `determineStatus` thresholds object + 4 `calculatePointsDeduction` tests + 1 `calculateSCR` comment all updated to the new red value.

Verification: engine tests 95/95 passing, web typecheck 0 errors. The amber zone is now slightly wider under any positive allowance — a previously-red squad-cost figure may now classify as amber, which is the intended regulatory meaning. The Dashboard gauge, Scenarios projection, SSR projections, PDF exports, comparison PDF, and the new SCR breakdown popover all consume the fixed helpers, so they inherit the correction with no further changes.

### Files changed

- `apps/web/src/components/layout/AppLayout.tsx`
- `apps/web/src/lib/scr.ts`
- `apps/web/src/pages/ClubSetupPage.tsx`
- `packages/engine/src/thresholds.ts`
- `packages/engine/tests/engine.test.ts`
- `BUILD_LOG.md`

### Verification

- Engine tests: 95/95 passing
- Web typecheck: 0 errors
- DB migration `20260528000001_squad_costs_mode` applied to live Supabase (status: "Database schema is up to date")

---

## Session 18 — Multi-phase contract ledger + Manager (Head Coach) + 5-year amortisation cap (2026-05-29)

Implemented the multi-phase contract architecture and the Manager entity end-to-end (DB → engine → API → UI → tests), plus the UEFA/PSR 5-year amortisation cap.

### Engine — 5-year cap (the "Chelsea Rule") + carried book value

- New `AMORTISATION_CAP_YEARS = 5` and `amortisationPeriodYears(len) = min(max(len,…),5)` in [packages/engine/src/amortisation.ts](packages/engine/src/amortisation.ts). Any fee now amortises over `min(contractLength, 5)`.
- `currentBookValuePence` now amortises over the **capped** window (book value reaches zero at start+5y for 6+ year deals).
- New pure `calculateRemainingBookValue(contract, targetDate)` — the carried book value of a deal on the day an extension is signed; this becomes the new EXTENSION phase's principal.
- `generateAmortisationSchedule` capped (an £100M/8yr deal → a 5-entry £20M schedule).
- `calculateSquadCosts(contracts, manager?)` extended: registration (transfer/comp + agent fee) denominators capped, and the active Manager's wage + amortised compensation fee + amortised agent fee are added (breakdown row flagged `isManager`).
- The single-transfer simulator (`calculate.ts`) and scenario `buy` branch (`applyScenarioActions`) also cap registration amortisation, keeping every SCR path consistent.

### Engine tests — 110 total (95 → 110)

Added: `amortisationPeriodYears` cap behaviour; **Chelsea Rule** (£100M/8yr → £20M/yr, agent-fee cap, book value hits zero at year 5); **Ledger Transition** (£70M/5yr INITIAL, extension at 3 years → carried book value exactly **£28M**, re-amortised over the new phase); **Manager SCR inclusion** (£5M comp /5yr + £2M wage = **£3M** added; +manager on top of players; manager comp capped at 5yr; null manager = no addition).

### Shared

- New wire types: `ContractPhaseType`, `ContractPhase` (normalised — `feePence` is transfer or compensation fee), `ManagerWithContract`.
- New Zod schemas: `ManagerInputSchema`, `ManagerPatchSchema`, `PhasePatchSchema` (in-place correction), `ExtendContractSchema` (effectiveDate / newEndDate / newWeeklyWagePence / newAgentFeePence, ≤10y signing cap).

### Database — migration `20260529000001_manager_and_contract_ledger` (applied to live Supabase)

- `contracts`: added `phase_type` (`INITIAL`|`EXTENSION`, CHECK), `is_current` (backfilled from `is_active`), `superseded_at`; partial unique index `contracts_one_current_per_player` (one current phase per player).
- New `managers` table (one active per club via partial unique `managers_one_active_per_club`).
- New `manager_contracts` table — mirror of `contracts` with `compensation_fee` instead of `transfer_fee`, same ledger columns + partial unique `manager_contracts_one_current_per_manager`.
- Decision: **mirrored** manager_contracts (not a polymorphic Employee refactor) — avoids rewriting every existing players/contracts query. Prisma can't express partial uniques in-schema, so they're raw SQL in the migration.

### API ([apps/api/src/routes/roster.ts](apps/api/src/routes/roster.ts), [club.ts](apps/api/src/routes/club.ts))

- `deriveSquadCostsForClub` now folds in the active manager's current contract via `deriveActiveManager` → SCR everywhere includes the Head Coach automatically.
- New endpoints: `GET /roster/player/:id/phases`, `POST /roster/player/:id/extend`, `GET /roster/manager`, `POST /roster/manager`, `PATCH /roster/manager/:id`, `PATCH /roster/manager-contract/:id`, `POST /roster/manager/:id/extend`.
- Extension transaction (no REST transactions): fetch current phase → `calculateRemainingBookValue` on the effective date → supersede old (`is_current=false`, `superseded_at=now`, players also `is_active=false`) **before** inserting the new EXTENSION phase (respects the one-current partial unique) → on insert failure, revert the supersede. New phase's fee = carried book value.

### UI ([apps/web/src/pages/RosterPage.tsx](apps/web/src/pages/RosterPage.tsx))

- **Head Coach card** above the player table: name, annual wage, annualised (capped) compensation amortisation, contract expiry + chip; phase pill; Add/Edit. Empty state when unset.
- **ManagerDrawer**: edit current-phase fields, contract-phases ledger, "Log contract extension", remove (archive).
- **ContractLedger**: vertical timeline — current phase = green "Active" dot/badge, past = grey "Archived", with INITIAL/EXTENSION pills and per-phase fee/wage/book value.
- **ExtendContractWizard** (shared by player + manager): Effective date, New end date (+ InfoIcon tooltip: "…remaining book value spread over the new duration, strictly capped at 5 years"), New weekly wage, New agent fees; shows the carried book value up front.
- Player edit drawer gained the same phases ledger + "Log contract extension".
- `api.ts` client: `playerPhases`, `extendPlayer`, `getManager`, `createManager`, `updateManager`, `updateManagerContract`, `extendManager`.

### Files changed

- `packages/engine/src/{amortisation,squadCosts,calculate,index}.ts`
- `packages/engine/tests/engine.test.ts`
- `packages/shared/src/{types,schemas}.ts`
- `apps/api/prisma/schema.prisma` + `prisma/migrations/20260529000001_manager_and_contract_ledger/migration.sql`
- `apps/api/src/routes/{roster,club}.ts`
- `apps/web/src/lib/api.ts`, `apps/web/src/pages/RosterPage.tsx`
- `BUILD_LOG.md`

### Verification

- Engine tests: **110/110 passing**
- API + web typecheck: 0 errors · web production build: clean
- Migration applied to live Supabase (status: "Database schema is up to date")

### Behavioural note

The 5-year cap is regulatorily correct but **changes SCR for existing players on 6+ year deals** (e.g. an 8-year £100M signing now charges £20M/yr, not £12.5M/yr) — squad costs for such clubs will rise. Intended.

### Follow-up refinements (same session)

- **Extension effective date is auto-derived, not picked.** `ExtendContractWizard` now sets `effectiveDate = currentEndDate` (read-only field, "at expiry" tag) — a new deal begins exactly when the current one ends. Fixes a bug where you could log a 2026 extension on a deal that expired in 2023. New end-date picker gets `min={effectiveDate}`.
- **Editable contract phases (incl. archived).** `ContractLedger` gained an inline `PhaseEditor` per phase (fee / weekly wage / agent fee / start / end), routed to `PATCH /roster/contract/:id` (player) or `/roster/manager-contract/:id` (manager) — both already patch any phase by id. Saves reload the ledger in place via a new `onChanged`/`reloadPhases` (player drawer re-fetches phases; manager drawer keeps local `phases` state).
- **Deletable phases.** New `DELETE /roster/contract/:id` + `DELETE /roster/manager-contract/:id` (audit-before-delete; deleting a current phase promotes the most recent remaining one back to current/active). Client: `deleteContract`, `deleteManagerContract`. UI: trash action with inline two-step confirm; delete is **shown on every row but disabled on the live/active phase** (managed via the form/extension flow).
- **Icon + layout polish.** Edit/Save/Cancel in the ledger became `IconButton`s (pencil `EditIcon`, ✓ `CheckIcon`, ✕ `CloseIcon`). Empty "No Head Coach" state swapped the odd grey whistle for a clean violet `CoachIcon` (unified with the populated card). Phase card restructured: pills + date range stacked on the left, edit+delete fixed top-right, a divider above the FEE/WAGE/BOOK VALUE grid — every row now aligns.
- Verification: web typecheck 0 errors, production build clean.

---

## Session 19 — Onboarding templates: schema + background sync worker (Phases 1–2) (2026-05-30)

**Goal:** Friction-free onboarding. Instead of scraping the unofficial felipeall/transfermarkt-api live during signup (fragile, Cloudflare-bannable), cache all 44 PL + Championship squads locally on a controlled monthly background schedule, then hydrate a tenant's roster from that cache. This session covers **Phase 1 (template schema)** and **Phase 2 (the sync worker)** only — UI/onboarding/hydration (Phases 3–5) are gated on user verification.

### Phase 1 — Template schema (isolated dictionary, NOT RLS/tenant-scoped)

- `apps/api/prisma/schema.prisma`: two new models + two native Postgres enums.
  - `enum TemplateLeague { PREMIER_LEAGUE | CHAMPIONSHIP }`, `enum TemplatePosition { GK | DEF | MID | FWD }`.
  - `TemplateClub` — `id`, `name` (unique), `league`, `logoUrl`, timestamps; has many `TemplateRosterItem`.
  - `TemplateRosterItem` — `id`, `templateClubId` (FK, onDelete Cascade), `name`, `dateOfBirth?`, `nationality?`, `position?` (**nullable — managers have no playing position**), `isManager` (default false), `estimatedTransferFee?` (BigInt, pence), `contractStart?`, `contractEnd?`, timestamps.
  - Deliberately separate from live tables: no `club_id`, no RLS — the data is identical for every tenant and only read during onboarding.
- Migration `apps/api/prisma/migrations/20260530000001_template_tables/migration.sql` — creates the two enum types, both tables, the unique name index, the FK + cascade. **Applied to live Supabase** via `prisma migrate deploy` (7/7 migrations applied, status clean).

### Phase 2 — Background sync worker

- `apps/api/src/scripts/transfermarkt-mappers.ts` — **pure, side-effect-free** mappers (no DB/env imports, so unit-testable in isolation): `mapPosition` (keyword rules; midfield checked before defence/attack so "Defensive Midfield" → MID), `parseTransfermarktDate` ("Mar 13, 1990" / ISO / "-" → null), `parseMarketValueToPence` (raw number or "€50.00m"/"€800k"/"€1.2bn" → integer pence; no FX), `normaliseNationality`, `mapPlayerToRosterItem`, `mapCoachToRosterItem` (isManager=true, position=null).
- `apps/api/src/scripts/sync-templates.ts` — the worker.
  - Hardcoded competition set GB1 (PL) + GB2 (Championship) — fetches each competition's club list live so promotion/relegation needs no code change; that union is exactly the 44 clubs.
  - Per club: `GET /clubs/{id}/profile` (logo + best-effort coach) then `GET /clubs/{id}/players?season_id=`, map, then upsert club + wholesale-replace its roster rows (Supabase service client, select-then-update/insert since id has no DB default).
  - **Anti-Cloudflare:** configurable `setTimeout` delay between every request (default 3000ms), even after a failure. Per-request AbortController timeout (default 20000ms).
  - **Error boundary:** each club sync (and each competition fetch) wrapped in try/catch — a broken selector/timeout logs a warning and the batch continues; never crashes wholesale.
  - Config via env: `TRANSFERMARKT_API_URL` (default http://localhost:8000), `TRANSFERMARKT_SEASON_ID` (default derived: Jul+ → current year, else prior — so May 2026 → 2025), `TRANSFERMARKT_SYNC_DELAY_MS`, `TRANSFERMARKT_TIMEOUT_MS`. Guarded so importing the module (for tests) does not run `main()`.
- `apps/api/src/scripts/transfermarkt-mappers.test.ts` — node:test suite (20 tests).
- `apps/api/package.json` — added `sync:templates` (tsx --env-file) and `test:scripts` (node --import tsx --test) scripts.

### Verification

- Mapper tests: **20/20 passing** (`pnpm --filter @headroom/api test:scripts`).
- API typecheck: **0 errors**. `prisma validate` + `generate`: clean.
- Worker smoke test against an unreachable API: degrades gracefully (per-competition warnings, 0 synced, **exit 0** — no crash), season correctly derived as 2025.

### Gate

**Stopped after Phase 2 for explicit user verification before building the Onboarding UI, the `/api/onboarding/*` routes, and the roster hydration/staging-redout (Phases 3–5).**

### Phases 3–5 — Onboarding UI, hydration API, roster redout (same feature, after the Phase-2 gate)

**Phase 4 — API** (`apps/api/src/routes/onboarding.ts`, registered in `server.ts`):
- `GET /onboarding/clubs?league=` — searchable club list from the local `template_clubs` cache; `league` accepts app `league_id` (`premier-league` / `efl-championship`), mapped to the template enum. Returns `{ id, name, leagueId, logoUrl }`.
- `POST /onboarding/complete` `{ templateClubId }` — **CFO-only** (`requireRole(cfo)`). Guards against double-hydration (409 if the club already has active players), clones every `template_roster_item` into the live `players` + `contracts` (INITIAL phase, `is_current`) and any manager into `managers` + `manager_contracts`, then adopts the club identity (name / short_name / league_id). **Wages forced to 0**; transfer/compensation fee seeded from `estimated_transfer_fee`; missing contract dates fall back to today → +3y; book value via `currentBookValuePence`. Safe insert ordering (players→contracts, manager→contract) with best-effort rollback since Supabase REST has no transactions. Audited.
- `apps/web/src/lib/api.ts`: `api.onboarding.clubs()` / `complete()` + `OnboardingClub` / `OnboardingCompleteResponse` types.

**Phase 3 — UI** (`apps/web/src/pages/OnboardingPage.tsx`, route `/onboarding` inside the protected AppLayout):
- Two-step wizard: league cards → searchable club grid (crest avatar w/ initials fallback, selected check via `layoutId`, sticky confirm bar). On confirm → `complete()`, update club store identity, toast, navigate to `/roster`. Empty-cache + non-CFO states handled.
- `RosterPage` empty squad state gained a **"Pre-fill from a club"** CTA → `/onboarding` (CFO only).

**Phase 5 — Roster redout** (`apps/web/src/pages/RosterPage.tsx`):
- Amber banner above the squad when any active contract has a £0 wage, with the spec copy ("Weve pre-filled your active 25-man squad… input their official weekly payroll wages or overwrite… by uploading your clubs CSV") + a live count and an Upload-CSV shortcut.
- Player table wage cell renders a red "£0 — set wage" chip on a red background when the wage is 0 (squad tab only, via new `flagZeroWage` prop).
- Player edit drawers weekly-wage `PoundInput` red-rings when the wage is 0/blank (new optional `invalid` prop).

### Verification (Phases 3–5)
- API typecheck **0 errors**; web typecheck **0 errors**; web production build **clean**.
- Engine **110/110**; mapper tests **20/20** still green.
- Live REST check: `template_clubs` + `template_roster_items` reachable via PostgREST (0 rows pre-sync), so `GET /onboarding/clubs` returns the empty-cache state correctly until the monthly sync runs.

### Follow-up: RLS hardening, live DB fill, README, hydration tests (2026-05-30)

- **Supabase "RLS Disabled in Public" (CRITICAL) advisor — fixed.** Enabled RLS on the tables that shipped without it: `managers` + `manager_contracts` get `club_id = current_club_id()` policies (same pattern as players/contracts); `template_clubs`, `template_roster_items`, and Prisma's `_prisma_migrations` get RLS enabled with **no policy** (service-role-only — the API bypasses RLS, no anon/auth key can touch them). Canonical `apps/api/prisma/rls.sql` extended + migration `20260530000002_rls_managers_and_templates` applied to live Supabase. Verified all five tables report `relrowsecurity = true`.
- **Template library filled from the live scraper.** Ran `sync:templates` against the public `transfermarkt-api.fly.dev` instance (season 2025): **44 clubs synced, 0 failed, 1218 roster items** (20 PL + 24 Championship). Verified positions mapped (0 nulls), fees in pence, crests + DOB + nationality populated. Manager rows = 0 (the scraper exposes no coach data, as expected).
- **README** updated to MVP 2.0 with a full "Roster Templates & Onboarding" section (architecture diagram, the sync worker + its safety nets, the run command, the zero-wage rule, and the onboarding endpoints), plus the optional `TRANSFERMARKT_*` env vars and the new test commands.
- **Hydration logic extracted + tested.** Pulled the pure transform out of the route into `apps/api/src/routes/onboarding-hydrate.ts` (`buildHydratedRoster` + helpers; route refactored to call it). New `onboarding-hydrate.test.ts` (script `test:onboarding`): 16 tests — pure helper/builder assertions **plus DB-backed tests that hydrate all 44 real cached clubs** and assert the invariants (every wage £0, end>start, fee≥0, book value ≤ fee, GK/DEF/MID/FWD-or-null positions, 1:1 player↔contract linkage, 20/24 league split, Chelsea crest + CHE short code).

**Verification:** `test:onboarding` 16/16 (hydrated 44 clubs → 1218 players) · mappers 20/20 · engine 110/110 · API typecheck clean.

### Follow-up: roster polish — dynamic banner, home-nation flags, squad numbers (2026-05-30)

1. **Banner no longer hardcodes "25-man".** The pre-fill redout banner now reads "We've pre-filled your active squad (N players)." using the live `active.length`.
2. **Nationality flags fixed for football nations.** `country-flag-icons` actually ships the home-nation SVGs (exported as `GB_ENG`/`GB_SCT`/`GB_WLS`/`GB_NIR`), so added England/Scotland/Wales/Northern Ireland to `apps/web/src/lib/countries.ts` (rendered by the existing `<Flag>` with no change), plus a `NATIONALITY_ALIASES` table for common spellings (Ivory Coast, DR Congo, Turkey↔Türkiye, South/North Korea, Holland, Bosnia-Herzegovina, USA, Cape Verde, Czechia, the Gambia, …). `findCountry` now matches code → name → alias. CountryPicker sorts by name (home nations slot in alphabetically) and shows a clean code badge (`ENG`, not `GB_ENG`). Verified at runtime: all resolve to a present flag; unknowns return null. Existing synced "England" data lights up with no re-sync.
3. **Squad (shirt) numbers added** — sporting directors can assign + sort by them.
   - DB: migration `20260530000003_player_squad_number` adds nullable `players.squad_number` (applied); Prisma `Player.squadNumber`.
   - Shared: `PlayerWithContract.squadNumber`, `ManualPlayerSchema.squadNumber` (int 1–99, optional).
   - API (`roster.ts`): selected in both player queries, mapped in `buildPlayerResponse`, set on manual create, and added to `PlayerPatchBody` + the PATCH update (nullable to clear). Client `updatePlayer` patch type updated.
   - UI (`RosterPage.tsx`): new leftmost "#" column; squad tab **sorts by number ascending (unassigned last), then name**; add + edit forms gained a "Squad number" field. Template hydration leaves it null (the scraper's squad endpoint carries no shirt number).

**Verification:** web + API typecheck clean · web build clean · engine 110/110 · onboarding 16/16 (44 clubs → 1218 players) · mappers 20/20 · flag-resolution runtime check passed.

### Follow-up: shirt numbers, change-club, club logo, onboarding UX redesign (2026-05-30)

**Shirt numbers (scraped + stored end-to-end).** The bulk squad endpoint omits shirt numbers, so the sync worker now makes one extra `/players/{id}/profile` call per player (`shirtNumber`, parsed by `parseShirtNumber`, paced by `TRANSFERMARKT_PLAYER_DELAY_MS`, individually error-bounded). Added `template_roster_items.squad_number` + `players.squad_number` (migrations applied), carried through onboarding hydration. Re-synced the live DB: **44/44 clubs, 1218 items, ~99% with a shirt number** (Chelsea #1 Robert Sánchez, etc.). Also added `squad_number` as an optional CSV column (RosterRowSchema, parser, commit, staging "Shirt" column + editable cell) and a sortable `#` column on the Roster table (sorted nulls-last) and the **Dashboard** breakdown table. Manual add/edit forms gained a Squad number field.

**Change club (re-onboarding).** `POST /onboarding/complete` now takes `replace`; with it set, `wipeClubRoster()` clears the existing players/contracts/managers/manager_contracts (+ orphaned scenario_actions, FK-safe order) before hydrating the new pick. Financial settings preserved; 409 still protects first-time onboarding without `replace`.

**Club logo.** Added `clubs.logo_url` (migration), set from the chosen template on onboarding, returned by `GET /club`, stored in the club store (`clubLogoUrl`). Backfilled existing clubs from template crests. The Sidebar Workspace panel shows the crest (initials fallback). The Workspace club row is a CFO-only button opening a **change-club modal** (explains the wipe); the Roster header button was removed in favour of it.

**Onboarding UX/UI redesign (presentation only).** Centered welcome wizard; gradient league emblem cards with club-count chips + accent bars; club step with search-icon field, skeleton loading grid, larger crest tiles (hover-lift, selected ring+check, toggle-deselect), distinct no-results vs empty-cache states, softer sticky confirm bar; a full-screen **ImportingState** (pulsing crest + staged checklist) during the hydrate call; and a redesigned Roster landing banner ("Squad imported — add wages") with a wage-entry progress bar.

**Verification:** engine 110/110 · mappers 22/22 · onboarding DB tests 16/16 (44 clubs → 1218 players, wages £0, valid numbers/positions) · API + web typecheck clean · web build clean · live dev servers (web :5173, api :3001) serving the new code. RLS advisor warnings from the prior session remain resolved.

---

## Session 20 — Settings league fix, roster sorting, historical-cost + manager ingestion (2026-05-31)

Refinements on top of MVP 2.0 onboarding.

1. **Settings — removed the redundant League choice** (`apps/web/src/pages/ClubSetupPage.tsx`). The club picked during onboarding already sets the league, so the interactive `LeagueSwitch` toggle was dead UX. Replaced with a read-only league badge; deleted `switchLeague`, the `LeagueSwitch` component, and `leagueSaving`/`pendingLeague` state. `api.club.setLeague` remains but is no longer called from the UI. PL-only uplift estimator + Championship-only owner-equity field still react to `leagueId`.

2. **Roster — per-column sorting** (`apps/web/src/pages/RosterPage.tsx`). New `SortableTh` + caret mirroring the Dashboard. Sortable: # (default asc, unassigned last), Name, Position, Annual Wage, Book Value, Contract End, To Expiry/Archived. First click = text asc / money-date desc, then toggles. Ordering moved from `filteredActive` (now filter-only) into `PlayerTable`, so squad + archived tabs both sort.

3. **Transfer-fee bug fixed: market value → historical cost** (`transfermarkt-mappers.ts`, `sync-templates.ts`). SCR accounting derives amortisation/NBV strictly from the actual purchase price, never speculative market value. `mapPlayerToRosterItem` now defaults `estimatedTransferFee` to `0n` (academy/free agents). New pure helpers `parseTransferFeeToPence` (free/loan/draft/undisclosed/`-`/`?` → `0n`) and `extractCurrentTransferFeePence` (finds the move to the current club in `/players/{id}/transfers`, falls back to most recent). Worker now calls `fetchActualTransferFee(playerId, club.tmId)` per player and overrides the default.

4. **Head-coach ingestion** (`transfermarkt-mappers.ts`, `sync-templates.ts`). New `selectHeadCoach` pulls the first-team manager from a staff payload (embedded `{manager|headCoach|coach}`, `{staff}`/`{members}` array, or bare array), skipping assistants/GK/fitness/youth/academy/analysts/scouts/physios. `mapCoachToRosterItem` now captures the compensation fee (`parseTransferFeeToPence`, default `0n`) + DOB/nationality, `isManager=true`. Worker's `resolveManager` tries the profile-embedded coach, then `/clubs/{id}/staff`; degrades gracefully (logs + continues) when unavailable. Per-club try/catch + 3000 ms delay retained. New env toggles `TRANSFERMARKT_FETCH_TRANSFER_FEES`, `TRANSFERMARKT_FETCH_MANAGER` (both on by default).

5. **Schema (Phase 1)** — `TemplateRosterItem` already had every required field (`isManager`, nullable `position`, `estimatedTransferFee BigInt?`, contract dates). Only corrected the stale "market value" comment to "historical purchase price / compensation fee". No migration needed.

6. **Hydration (Phase 3)** — `onboarding.ts` + `buildHydratedRoster` already clone players→players+contracts and the manager→managers+manager_contracts (active), wages/agent fees forced to 0; `transfer_fee`/`compensation_fee` + `book_value` now carry the real historical fee. No code change needed.

7. **Roster audit banner + Net Book Value tooltip** (Phase 4, `apps/web/src/pages/RosterPage.tsx`). Reworded the post-onboarding banner to the accountancy-audit copy ("We have loaded your squad template… employee wages default to zero, and book values reflect parsed historical transfer records. Please audit these rows before executing compliance simulations."). Added a `BookValueInfo` hover/focus tooltip on the Book Value column header: 5-year-capped linear amortisation from the Initial Transfer Fee, market value ignored, academy/free → £0, formula `Initial Fee − (Annual Amortization × Years Elapsed)`. `SortableTh` gained an optional `info` slot (click-stopped so it doesn't toggle sort).

**Known caveat:** stock felipeall/transfermarkt-api has no documented `/clubs/{id}/staff` endpoint and an unreliable profile `coach` field, so manager ingestion may often be empty until the exact staff endpoint/shape is confirmed; `resolveManager`/`selectHeadCoach` mappings are easy to adjust then.

**Verification:** API typecheck clean · web typecheck clean · mappers **31/31** (added parseTransferFeeToPence, extractCurrentTransferFeePence, selectHeadCoach, manager-compensation coverage) · onboarding DB tests **16/16** (44 clubs → 1218 players, all wages £0).

---

## Session 21 — Bio-only ingestion, native scrapers (coach + shirt numbers), coach UX, full Docker sync (2026-06-01)

Pivoted the template sync to a **bio-only** model and refreshed the entire 44-club library off a locally-built transfermarkt-api in Docker.

### Why bio-only
Fetching real transfer fees meant ~1,300 extra `/transfers` + `/profile` calls per run, which tripped the public felipeall demo's Cloudflare rate-limit (persistent `HTTP 405`). Decision: **stop ingesting any financials** — drastically smaller payload, no rate-limiting, and it forces the CFO to enter their own official accounting figures (correct for compliance anyway).

### Sync worker — bio-only refactor (`apps/api/src/scripts/sync-templates.ts`)
- **Removed** all fee/market-value fetching and the per-player `/profile`/`/transfers` calls. `mapPlayerToRosterItem` now sets `estimatedTransferFee: null`; coaches likewise carry null financials.
- Deleted the now-dead financial mappers (`parseMarketValueToPence`, `parseTransferFeeToPence`, `extractCurrentTransferFeePence`, `selectHeadCoach`) + their tests. Kept `parseShirtNumber` (still used).
- Per club the worker now does: **1** API call (squad) + **1** API call (logo) + **1** HTML fetch (shirt numbers) + **1** HTML fetch (head coach). 3 s inter-club delay + retry/backoff (405/408/425/429/5xx) retained.
- New env toggles: `TRANSFERMARKT_FETCH_MANAGER`, `TRANSFERMARKT_FETCH_SQUAD_NUMBERS`, `TRANSFERMARKT_WEB_URL`, `TRANSFERMARKT_MAX_RETRIES`, `TRANSFERMARKT_RETRY_BASE_MS`.

### Native HTML scrapers (new, pure + unit-tested)
- **`transfermarkt-coach-scraper.ts`** — felipeall has no `/staff` endpoint, so we fetch transfermarkt.com's Coaching Staff page (`/-/mitarbeiter/verein/{id}`) and parse the first-team head coach (name, nationality, appointed/contract dates), skipping assistants/GK/youth/etc. Degrades to `null` on any parse failure.
- **`transfermarkt-squad-scraper.ts`** — shirt numbers aren't in the felipeall squad JSON (they were the dropped `/profile` call), so we parse them from the club's kader page (`rn_nummer` div ↔ `/profil/spieler/{id}`) and merge by player id. (User confirmed Option A: keep felipeall JSON for bio, add one kader fetch for numbers.)
- Tests: 8 coach-scraper + 4 squad-scraper. `test:scripts` now globs `src/scripts/*.test.ts`.

### Coach nationality — end to end
- Migration `20260531000001_manager_nationality` (`managers.nationality TEXT`, applied to live DB via `prisma migrate deploy`). Prisma `Manager.nationality`.
- Wired through: `buildManagerResponse` + select(`*`), `buildHydratedRoster` manager row, `ManagerInputSchema`/`ManagerPatchSchema` (shared), POST/PATCH `/roster/manager`, `ManagerWithContract` type, `updateManager` client type, and both Add/Edit forms (CountryPicker).

### Roster UI (`apps/web/src/pages/RosterPage.tsx`)
- **Squad-number column restored** end-to-end (1,175/1,276 players populated after the sync; the rest are genuinely unassigned).
- **Book Value cell** now shows the amber `FinancialWarning` (icon + tooltip) when £0 in the pre-fill state, mirroring Annual Wage; **edit drawer's Transfer fee** field highlights when empty/0.
- **Tooltip clipping fixed** — `FinancialWarning` and `BookValueInfo` now render via `createPortal` to `<body>` positioned off the icon's screen rect, so the table's `overflow` no longer clips them. Book Value tooltip text trimmed (no more "speculative market valuation" — we ingest none).
- **Coach row rework** — `ManagerCard` is now a minimalist player-style row: **flag instead of avatar**, name, "Head Coach" tag, **Annual wage only** (contract-end + the Edit button removed); the **whole row is clickable** to edit. INITIAL pill dropped from the card.

### Coach-nullable hardening
The whole chain already tolerated a missing coach (worker `if (coachItem)`, hydrate `if (managerRow)`, route `if (hydrated.manager)`, UI empty-state). Added regression tests for partial/garbage coach parses (name-only, unparseable dates, empty nationality → never throws).

### Docker — full 44-club sync
- Machine has **no Docker Desktop** and password-gated `sudo`, so installed **Colima** (CLI-only Docker runtime) via Homebrew. The published `felipeall/transfermarkt-api` image **doesn't exist on Docker Hub** — built from source (`transfermarkt-api:local`). Its app-level rate limiter is **off by default**, so the local instance has no throttling.
- Full sync: **44/44 clubs, 0 failed, 1,318 items** (1,276 players + 42 managers). Players with shirt numbers: 1,175. Managers with nationality: 42/42. Non-null fees: 0 (bio-only confirmed). Liverpool + Watford parsed no coach → handled gracefully (no manager row, no crash).
- New **[DOCKER.md](DOCKER.md)** runbook documents the whole flow (install Colima, build image, run container, run sync, env vars, verification, troubleshooting) for repeatable future re-syncs.

**Verification:** API + web typecheck clean · script tests **32/32** · live full sync 44/44 verified against the DB.

## Session 22 — Carried Book Value override + Extend-modal tooltip fix (2026-06-01)

**Problem.** Transfermarkt snapshots give only `joined` / `last_extension` / `contract_end` — no historical contract phases. For a player bought years ago who later signed an extension, we can't reconstruct how much of the original fee is already amortised. Solution: a **Carried Book Value override** the CFO can enter (the exact remaining Net Book Value at the extension date), bypassing the need for historical phase arrays.

### Engine (`packages/engine`)
- **`amortisation.ts`** — new `effectiveFeePence(transferFee, carriedBookValue?)` (override wins when non-null, incl. 0). `currentBookValuePence` gained an optional 5th param `carriedBookValuePence`; when set it amortises the carried NBV over the phase instead of the transfer fee (5-year cap still applies). Both exported from `index.ts`.
- **`squadCosts.ts`** — `ContractInput.carriedBookValuePence?: number | null`; `calculateSquadCosts` feeds `effectiveFeePence(...)` into the amortisation so the live SCR respects the override.
- Tests: +9 (3 `currentBookValuePence` override, 3 `effectiveFeePence`, 3 `calculateSquadCosts` override incl. 5-year cap). Engine **119/119**.

### Schema + DB
- `Contract.carriedBookValue BigInt?` and `TemplateRosterItem.contractStartFromExtension Boolean @default(false)` (Prisma). Migration `20260601000001_contract_carried_book_value` — **applied to live DB** via `prisma migrate deploy`.
- Zod (shared): `carriedBookValuePence` (nullable optional) added to `ManualPlayerSchema` + `ContractPatchSchema`. Deliberately **not** on `PhasePatchSchema` (manager-only; `manager_contracts` has no such column).
- Types (shared): `PlayerWithContract.contract` gained `carriedBookValuePence` + `phaseType`; `ContractPhase.carriedBookValuePence`; `RosterStagingRow.parsed.carriedBookValuePence?`.

### Ingestion (Phase 2)
- **`transfermarkt-mappers.ts`** — `mapPlayerToRosterItem` now derives `contractStart` = `last_extension` → else `joined` → else **`financialYearStart()`** (1 July of the current season), and sets `contractStartFromExtension` when the extension date was used. New exported `financialYearStart(now)`.
- `sync-templates.ts` persists `contract_start_from_extension`; `onboarding.ts` selects it.
- **`onboarding-hydrate.ts`** — an extension-block row hydrates as a **`phase_type: 'EXTENSION'`** contract with `carried_book_value: null`, so the UI flags it for CFO audit. Non-extension rows stay `INITIAL`.
- Tests: mapper +3 (last_extension preference, FY fallback, `financialYearStart`); hydrate +2 (EXTENSION-block, INITIAL default). Mapper **23/23**, onboarding **18/18** (incl. live DB-backed).

### API routes
- `roster.ts` — `buildPlayerResponse` / `buildPhase` read `carried_book_value` (+ `phase_type`) and compute live book value with the override; GET `/roster`, `CommitBody`+commit insert, manual-add insert, and PATCH `/roster/contract/:id` (set / clear-with-null / keep) all thread it.
- `club.ts` — `deriveSquadCostsForClub` selects `carried_book_value` and maps it into `ContractInput`, so the dashboard SCR honours overrides.

### Frontend (`RosterPage.tsx`) — Phase 4 progressive disclosure
- New `CarriedBookValueField` — hidden behind a subtle **"Advanced: Set Carried Book Value"** link; revealed it shows a £ input + `InfoTooltip` ("Use this field for players who signed a contract extension mid-tenure…").
- **Smart auto-reveal**: an imported extension block (`phaseType === 'EXTENSION' && carriedBookValue == null && transferFee === 0`) auto-reveals the field with an **amber warning** prompting the CFO to audit it. Wired into the Player Edit Drawer save (number ⇒ set, hidden/empty ⇒ null) and the CSV staging-row editor (merged back onto the re-validated parsed row).
- **Extend-modal tooltip fix** — `InfoTooltip` now renders via `createPortal` to `<body>` with viewport-clamped positioning, so the "New Contract End Date" info bubble is no longer clipped by the modal's right edge.

**Verification:** engine 119/119 · mapper 23/23 · onboarding 18/18 (live DB) · API + web typecheck clean · web production build clean · migration applied to live DB.

### Session 22 addendum — per-player extension scrape + preserved join date
- **UI**: the "Advanced: Set Carried Book Value" reveal is now a tiny muted "Advanced" link in the normal case; it only becomes a visible amber "Set carried book value" when a row is a flagged extension block needing audit.
- **Per-player extension scraper** (`transfermarkt-player-scraper.ts`, pure + 5 unit tests): the felipeall bulk endpoint has no renewal date, so we parse the **"Last contract extension"** date from each player's profile page (`/-/profil/spieler/{id}`, `info-table__content--regular` label → next date token; tolerant of the legacy `<th>/<td>` layout). Wired into the worker behind **`TRANSFERMARKT_FETCH_EXTENSIONS=1`** (opt-in; ~1 fetch/player, throttled by `TRANSFERMARKT_PLAYER_DELAY_MS`, default 350). When found, the extension date becomes the contract start and flags the row as an extension block.
- **Preserved join date** (`players.joined_date` + `template_roster_items.joined_date`, migration `20260601000002_player_joined_date`, applied to live DB): the mapper now keeps the **original `joined` date** independently of `contractStart` (which may be the extension date). Threaded mapper → template → hydration (`players.joined_date`, falls back to contract start) → GET `/roster` (`buildPlayerResponse.joinedDate`) → `PlayerWithContract.joinedDate` → edit drawer shows "Joined the club: X · contract start reflects a later extension" when they differ. Manual add / CSV commit default `joined_date` to the contract start.
- **DOCKER.md** updated with the two new env vars + extension-scrape cost note (~3 min → ~12–15 min when enabled).
- Tests: script suite **40/40** (added player-scraper ×5, joinedDate assertions); onboarding **18/18** (live DB); engine **119/119**; API + web typecheck clean.

---

## Session 23 — Settings refactor + Auth upgrade (TOTP 2FA + Forgot Password)

**Goal:** Tabbed Settings (Personal vs CFO-only), optional Authenticator-App TOTP at login, and a standard Forgot-Password recovery flow. Registration OTP flow untouched.

### Architecture note (important)
Headroom uses **Supabase Auth** end-to-end: passwords live in Supabase `auth.users`, the JWT is minted by Supabase, and the API only *validates* it. The task spec assumed a custom JWT/Prisma-password backend, so two adaptations were made (the password store is never duplicated):
- **TOTP** is gated by a **backend-proxied login** (user-chosen approach): `POST /auth/login` verifies the password via an anon-key client and, if 2FA is on, returns `{ requires_2fa: true }` **without tokens**; `POST /auth/verify-2fa` re-verifies password + the `otplib` code and only then returns the Supabase session. The client hydrates with `supabase.auth.setSession`.
- **Password changes** (reset + change) go through the Supabase **Admin API** (`auth.admin.updateUserById`); our DB only holds the single-use reset token + expiry.

### Backend
- **Schema** (`User`): `totp_secret`, `is_totp_enabled` (default false), `password_reset_token` (partial-unique), `password_reset_expires`. Migration `20260601000003_user_totp_and_password_reset` — **applied to live DB**.
- **Env**: added `SUPABASE_ANON_KEY` to `apps/api/.env` (mirrors the web publishable key) — needed to verify passwords server-side. New `apps/api/src/lib/supabase-anon.ts` (one-shot, no session persistence).
- **Deps**: `otplib@^12` (stable `authenticator` API — v13 is an incompatible functional rewrite) + `qrcode`.
- **`apps/api/src/routes/auth.ts`** (new, registered in server.ts): `/auth/login`, `/auth/verify-2fa`, `/auth/forgot-password` (always 200, no enumeration; console-logs the `/reset-password?token=` link in dev), `/auth/reset-password` (single-use, expiry compared **in Postgres** to avoid the naive-`timestamp`/local-parse bug), and authed `/auth/totp/setup|verify|disable` + `/auth/change-password`. Tighter per-route rate limit (10/min/IP) via `config.rateLimit`.
- **`/me`** now returns `isTotpEnabled`; new **`PATCH /me`** (name + email; email change synced through Admin API).
- **Team & Access** (`invites.ts`): `PATCH /team/:id` (change role, can't change self) + `DELETE /team/:id` (revoke — clears authored scenarios/audit rows, deletes the user + their Supabase auth identity; can't revoke self).
- **Danger Zone** (`club.ts`): `DELETE /club` (CFO only) — requires the typed club name; cascades child→parent across every club-scoped table, removes each member's auth identity, then the club.

### Frontend
- **Settings** (`ClubSetupPage.tsx`) refactored into 5 tabs using the existing UI Kit: **Profile & Security** (all users — edit name/email, change password, full TOTP enrol/QR/verify/disable), **Team & Access** (CFO — invites + active-user role dropdown + revoke), **Financial Settings** (CFO — the former financials form, unchanged), **Activity Log** (CFO), **Danger Zone** (CFO — type-to-confirm delete). CFO-only tabs are hidden from the nav and guarded server-side.
- **Login** (`LoginPage.tsx`): now proxies through `/auth/login`; added a **2FA code prompt** (`TwoFactorForm`) and a **Forgot password?** link → `ForgotPasswordForm` (request reset). Sign-up/OTP flow unchanged.
- **Reset Password** (`ResetPasswordPage.tsx`, new) at public route `/reset-password` — reads the token from the URL, enforces the password policy, single-use.
- **`api.ts`**: `auth.*` (public `publicPost` for login/2fa/forgot/reset; authed totp/change-password), `me.update`, `team.updateRole|revoke`, `club.deleteOrganization`; `me.get` gains `isTotpEnabled`.

### Verification
- Typecheck: API + web clean. Web production build clean.
- Tests: engine **119/119**, scripts **40/40**, onboarding **18/18**.
- **Live e2e drive** (throwaway Supabase user, auto-cleaned): login (no 2FA) → TOTP setup (QR) → verify/enable → login `requires_2fa` (no session leaked) → bad code rejected / good code issues session → disable → forgot → reset (single-use; replay rejected) → login with new password / old password rejected. **All passed.** Public endpoints return correct 401/400/no-enumeration; all CFO/authed routes 401 without a token.

### Standing notes
- `SUPABASE_ANON_KEY` in `apps/api/.env` is the publishable key (safe); the service-role key + DB password remain gitignored and must never be committed.
- Branch not yet committed; awaiting user instruction.

### Session 23 addendum — Financials moved out of Settings + Dashboard risk restored
- **Financials is now its own sidebar entry** (`/financials`, **`FinancialsPage`**), CFO-only, separate from **Settings** (`/setup`) — it's club compliance config, not a personal/workspace setting. `FinancialTab` is exported from `ClubSetupPage` and reused. Settings tabs are now Profile & Security / Team & Access / Activity Log / Danger Zone. Sidebar gained a CFO-only "Financials" item (£ icon, hidden for non-CFO; API still enforces). `AppLayout` title map + the Dashboard/SSR empty-state links now point to `/financials`.
- **Dashboard "Financial Risk" card restored** (after the gauge): uses engine `calculateLevy` / `calculatePointsDeduction` with the league config. Green → "No sanctions" + headroom; Amber → Estimated Financial Levy + overspend-above-Green; Red → Estimated Points Deduction (pts) + legal-advice note. Mirrors the Scenario builder's SanctionsPanel.
- Web typecheck + production build clean.

## Session 24 — Dynamic Seasons + In-App Notifications + Interactive Calendar (MVP 2.1)

### Phase 1 — Dynamic Seasons
- **`stores/season.ts`** (new): zustand + `persist` store keyed on `startYear` (e.g. 2026 → "2026/27", fiscal 1 Jul → 30 Jun). Pure helpers: `seasonLabel`, `seasonKey` (DB "2026-27" format), `seasonStartDate`/`seasonEndDate`, `seasonAsOfDate` (fiscal close — the engine's as-of date for the season), `isWithinSeason`, plus `MIN/MAX_SEASON_START` (2026 launch → +9) and `clampSeasonStart`. `nextSeason`/`prevSeason`/`setStartYear`.
- **`SeasonSelector.tsx`** (new) in the TopBar (left of the SCR pill): rounded-full dropdown matching the SCR pill / kit; lists selectable seasons, persists choice.
- **Season now dictates financials**: `ProtectedRoute` fetches `getFinancials(seasonKey)` in a season-scoped effect and **refetches on season change** (a season with no row resolves to `null` → Dashboard shows its setup empty-state). `setFinancials` now accepts `null`. `FinancialTab` (save+refetch) and `RosterPage` use the active season key; `SSRPage` derives `SEASON` + the 12-month grid from the store and refetches per season; `AmortisationTable` highlights the active-season row; footer/labels are dynamic.

### Phase 2 — Notifications backend
- **schema.prisma**: `enum NotificationType { INFO WARNING CRITICAL }` + `Notification` model (`clubId`, optional `userId` for per-user vs club-wide, `title`, `message`, `type`, `isRead`, `createdAt`; indexes on `(clubId,createdAt)` and `(userId,isRead)`; FKs cascade). Relations added to Club + User. Migration `20260601000004_notifications` **applied to live DB**; client generated.
- **`lib/notifications.ts`** (new): `createNotification` (fire-and-forget emit primitive) + `createNotificationOnce` (idempotent within a window — dedup by `(club_id,title)`), the foundation other routes emit from.
- **`routes/notifications.ts`** (new, registered): `GET /notifications` (club-wide + own, desc, limit 50, + `unreadCount`), `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` (both scoped by club + visibility), and `POST /notifications/refresh` — event-driven derivation that raises **contract-expiry** (current contracts ending ≤6 months, CRITICAL ≤2mo) and **compliance** (Levy Zone / Points Risk from season financials, squad costs via the engine) alerts idempotently.

### Phase 3 — Notifications UI
- **`stores/notifications.ts`** (new): items + unreadCount + load/refresh/markRead(optimistic)/markAllRead/reset.
- **`NotificationBell.tsx`** (new) in the TopBar: bell + red count badge; popover lists alerts with **type-coded icons (INFO=blue, WARNING=amber, CRITICAL=red)**, a "Mark all as read" button, relative timestamps, click-to-read, empty-state. On mount + season change it calls `refresh(seasonKey)` then polls every 60s. Reset on `SIGNED_OUT`.
- **`api.ts`**: `notifications.list|markRead|markAllRead|refresh` + `NotificationItem`/`NotificationsResponse`/`NotificationType` types.

### Phase 4 — Interactive Calendar
- **`CalendarPage.tsx`** rewritten. Fixed EFL dates now **derive their year from the active season** (summer/autumn in start year; Jan→Jun roll into the end year) via real UTC `Date`s sorted chronologically. A **dynamic "N Contracts Expiring" node** is injected from the live roster (players whose current active contract `endDate` falls in the season window, `isWithinSeason`), positioned at the earliest in-season expiry. The node is **clickable → right-anchored side-drawer** (subtle slide; portal + framer) listing each player's position badge, shirt no., exact expiry date, and current annual + weekly wage. ESC / backdrop dismiss.

### Verification
- Typecheck: **web + api + engine + shared all clean**. Web production build clean.
- Tests: engine **119/119**, api scripts **40/40**.
- Live DB smoke (service role): notifications insert (CRITICAL enum), the route's exact `.or(user_id.is.null,user_id.eq.X)` visibility filter, mark-read, delete — **all OK**. New routes return **401** unauthenticated.

### Note for review
- The Calendar side-drawer uses a subtle horizontal **slide** (drawers conventionally slide, and the spec said "slide out a side-drawer"). The standing "modals = pure fade" rule was about centered dialogs; if you'd rather the drawer fade too, it's a one-line change.

### Session 24 follow-up — Calendar polish + season selector relocation
- **Season selector moved out of the TopBar** into Settings → Profile & Security (new "Active Season" card, visible to all users). TopBar is back to SCR pill + bell. Store/behaviour unchanged.
- **Calendar loader** now uses a shimmer `CalendarSkeleton` (new in `page-skeletons.tsx`) that mirrors the timeline layout — consistent with every other page (Spinner removed).
- **Calendar UI upgraded into a working dashboard**:
  - **COMPLIANCE TEST nodes** show a right-aligned, colour-coded **Projected SCR** pill pulled from global state (`computeActiveBaseline(financials, includedScenarios)` — same Active Baseline as the TopBar pill), with status label; graceful "Set up financials" state when none.
  - **CHECKPOINT / DEADLINE nodes** carry a subtle **Pending ↔ Completed** toggle (local `Set<string>` of node ids, reset on season change). Completed → card dims (`opacity-60`) + timeline dot turns success-green.
  - Clean vertical layout preserved; new pills/toggles use the existing kit palette.
- Web typecheck + production build clean.

---

## Session 25 — Roster import: Excel support + field parity + sample squad

### Goal
The roster importer accepted **CSV only** and predated two player-field additions
(`joined_date`, Carried Book Value). Add **Excel (.xlsx/.xls)** ingestion, bring the
parser up to date with current player fields, and ship ready-to-upload **sample files**.

### Excel ingestion (client-side, server unchanged)
- `RosterPage.tsx` → new `fileToCsvText(file)` helper. `.csv` is read as text as
  before; **`.xlsx`/`.xls` is converted to CSV in-browser via SheetJS** (`xlsx`, already
  a web dep) — first sheet, `sheet_to_csv(sheet, { blankrows:false, dateNF:'yyyy-mm-dd' })`.
  `dateNF` guarantees real Excel **date cells** emit ISO `YYYY-MM-DD`, so the rest of the
  pipeline (server `/roster/parse` + `RosterRowSchema`) is **identical for both formats** —
  no server changes for Excel.
- Modal updated: title "Import roster from CSV **or Excel**", `accept` now includes the
  xlsx/xls MIME + extensions, button label + help text mention Excel. Both "Upload CSV"
  buttons → "Upload CSV / Excel".

### New optional columns (CSV + Excel)
- **`joined_date`** (YYYY-MM-DD) — original club join date. Previously the commit
  hard-coded `joined_date = contract_start`; now uses the column when supplied, else
  falls back to contract start. Refine: must be in the past and on/before contract end.
- **`carried_book_value_pounds`** (£) — Carried Book Value override. Feeds
  `currentBookValuePence(..., carriedBookValuePence)` so amortisation matches the
  manual-add path. Blank ⇒ standard transfer-fee amortisation.
- Wired through: `RosterRowSchema` + `RosterStagingRow.parsed` type (shared),
  `EXPECTED/OPTIONAL_COLUMNS`, `buildStagingRow` (+ `parseOptionalPoundsCell`, NaN guard),
  `CommitBody`, commit re-validation candidate, and the DB insert. The inline staging-row
  editor now also merges `joinedDate` back across its re-parse round-trip (it already did
  this for Carried BV).

### Sample files — `sample-data/`
- **`manchester-city-squad.csv`** and **`manchester-city-squad.xlsx`** — full 23-player
  Man City squad, approximate wages/fees. Exercises every column: 9 rows carry a Carried
  Book Value, 14 have a `joined_date` distinct from contract start, and 9 contracts expire
  inside the 2026/27 season window (drives the calendar expiry node + expiry notifications).
  Excel built via AOA so dates are stored as text and money as numbers.

### Verification
- Typecheck: **web + api + shared all clean**; shared rebuilt. Engine tests **119/119**.
- End-to-end: both the CSV and the XLSX (through the app's exact `sheet_to_csv` path) parse
  **23/23 valid** against `RosterRowSchema`. Excel→CSV round-trip preserves ISO dates,
  blank cells, and numeric values.

### Session 25 fix — Dashboard SCR ignored Carried Book Value (dual-source mismatch)
- **Symptom:** with carried-book-value players in the squad, the Dashboard "Live Squad
  Cost Ratio" + "Headroom to Green" cards + Compliance Gauge showed **86.4%** while the
  TopBar pill, popover, and Financial Risk card showed **78.8%** — same revenue, no scenarios.
- **Cause:** the server (`club.ts` → `deriveSquadCosts`) feeds `carriedBookValuePence` into
  `calculateSquadCosts`, so `financials.currentSquadCosts` amortises the (lower) carried book
  value. Three **client-side** call sites rebuilt `ContractInput[]` from the roster but **omitted
  `carriedBookValuePence`**, so they amortised the full transfer fee → inflated squad costs.
- **Fix:** pass `carriedBookValuePence: p.contract!.carriedBookValuePence` in all three:
  `DashboardPage.tsx` (live SCR + per-player breakdown), `ScenariosPage.tsx` (scenario baseline,
  which overrides `currentSquadCosts`), and `exports/squadPdf.ts` (PDF total). The engine already
  supports it via `effectiveFeePence`; no engine change.
- **Verified:** over the sample Man City squad @ £500M revenue — with carried = £394.3M (78.9%,
  matches server/pill); without = £432.1M (86.4%, the old bug). Web typecheck clean.

### Session 25 — product feedback pass (5 small fixes)
1. **Account chip shows the real user** (was hard-coded "CFO / Finance"). New
   `useMe()` + `roleLabel()` in `lib/role.ts` (fetch `/me` once, cache in
   localStorage; `useRole` now derives from it). AppLayout renders the user's
   `fullName`, role label, and initials avatar, with email-prefix fallback.
2. **Settings "Danger Zone" tab renamed** → **"Delete Workspace"** (the heading
   was already "Delete Organization"; the tab name now says what it does).
3. **Calendar missed imminent expiries** (e.g. a 30 Jun 2026 deal — got a
   notification but no calendar node). New `isExpiringInSeasonView()` in
   `season.ts`: same as `isWithinSeason` but for the *upcoming* season it pulls
   the lower bound back to today, surfacing run-up expiries (matches the rolling
   notification window). Future/past seasons keep the strict 1 Jul–30 Jun window.
   CalendarPage now uses it. Verified: 2026-06-30 included for 2026/27, excluded
   for a future 2028/29 view; already-expired excluded.
4. **Password change no longer logs you out** of the whole app. The server
   changes the password via the admin API, which revokes refresh tokens → the
   stale token silently 401'd everything. `changePassword` now re-mints a fresh
   session client-side via `signInWithPassword(email, newPw)` (falls back to a
   clean sign-out + redirect to /login if that fails).
5. **TopBar SCR pill is always present.** When the active season has no
   financials, instead of disappearing it shows a muted "Current SCR — · Set up
   financials →" pill linking to /financials.

Web typecheck clean; shared rebuilt.

  - **Follow-up:** the expiry node previously lumped *all* expiring players onto
    the earliest date (e.g. "7 Contracts Expiring" at 30 Jun 2026 even though 5
    expired 30 Jun 2027). Now grouped by exact expiry date → one node per date,
    each positioned chronologically with only that date's players in its drawer.
