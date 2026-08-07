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

### Session 26 — product feedback pass (4 fixes)
1. **Delete-workspace confirmation is now case-insensitive.** Typing the club
   name in different capitalisation no longer blocks deletion. Compared with
   `.trim().toLowerCase()` on both the client (`ClubSetupPage` DangerZoneTab,
   `armed`) and server (`club.ts` DELETE `/club`). The typed name is still
   required as a friction gate.
2. **Coaches no longer get a fabricated contract end.** Transfermarkt's Coaching
   Staff page often lists no "Contract expires" (the column shows " - "); the old
   hydration ran that through `resolveContractWindow`, inventing a today→+3yr
   window (sometimes already in the past). Now `onboarding-hydrate.ts` only seeds
   a manager contract phase when the template carries a **genuine scraped end
   date** (`toDateOnly(contract_end)`); otherwise the manager is still created
   (name/nationality) but with **no contract** for the CFO to fill in.
   `onboarding.ts` updated to insert the manager even when its contract is null.
   `deriveActiveManager` already returns null for a contract-less manager, so SCR
   is unaffected. New unit test covers the no-expiry path; all 19 hydrate +
   40 script tests pass.
3. **No more SCR flicker while scenarios load.** The TopBar pill + Dashboard
   projections fold in included scenarios, which load *after* financials — so they
   briefly showed a pre-scenario number that then jumped (e.g. 40% → 80%). Added
   `scenariosLoaded` to the club store (set true on the scenarios fetch's success
   **or** failure). AppLayout re-gates it to false at the start of each load and
   shows a new `SCRLoadingPill` placeholder until the real figure is in; the
   Dashboard holds its skeleton until both roster **and** scenarios are loaded.
   Reset on sign-out.
4. **First-run nudge to pick a club.** A CFO whose workspace has an empty squad
   now sees a violet coachmark anchored above the Sidebar Workspace switcher
   ("👋 Start here — Pick your club… → Choose a club"), with the switcher
   highlighted. It fetches the roster count, auto-hides once a squad exists, and
   is dismissible. CTA routes to `/onboarding`.

Web + API typecheck clean.

  - **CSV import replace-vs-append:** `/roster/commit` always *appended*, so
    importing a CSV on top of a pre-filled template duplicated the squad. Added a
    `mode: 'append' | 'replace'` to the commit body (default `append` for back-
    compat). In `replace` mode the server first wipes the current **active**
    players — FK-safe order: their `scenario_actions` → `contracts` → `players`
    (head coach + archived players preserved) — then inserts the batch. The CSV
    modal now shows a Replace / Add-to-squad choice whenever the club already has
    a squad (defaults to Replace so an import never silently duplicates), with a
    one-line warning in replace mode and a mode-aware commit button. `existingCount`
    passed in from `RosterPage`; `api.roster.commit(rows, mode)`.

  - **Follow-up (coach contract editable):** with coaches now allowed to have no
    contract (#2 above), the Head-Coach edit drawer hid its contract block
    entirely (`{c && …}`), so wages/fee/dates vanished. The drawer now **always**
    renders those fields; when the coach has no contract it shows a "Not set"
    pill + helper and seeds an INITIAL phase on save. New endpoint
    `POST /roster/manager/:id/contract` (+ `ManagerContractInputSchema` in shared,
    `api.roster.createManagerContract`) creates the first phase for an existing
    contract-less manager (409 if one already exists). Entering any contract
    field requires start + end dates and a positive wage; identity-only edits
    still save without forcing a contract. Feeds SCR exactly like before. Shared
    rebuilt; web + API typecheck clean.

  - **Stable TopBar SCR (no more 3–4 reloads on page load / tab switch):** the
    pill flickered through its loading state several times on every reload and
    navigation. Root cause was a cascade of redundant store writes, each minting
    a fresh object reference that re-fired the AppLayout scenarios effect:
    (a) Supabase fires several auth events on load (INITIAL_SESSION, SIGNED_IN,
    TOKEN_REFRESHED) and the financials effect keyed on the whole `session`
    object, refetching on each; (b) `setFinancials`/`setScenarios` always created
    new references even for identical data, and RosterPage/ScenariosPage re-set
    them on every visit. Fixes: ProtectedRoute's financials effect now keys on
    `session?.user?.id` (stable across auth events); the club store's
    `setFinancials`/`setScenarios` are identity-stable (no-op when the payload is
    structurally equal, via a small `sameJSON` guard); and AppLayout only flashes
    the SCR loading pill on the genuine **first** scenarios load — later refreshes
    reload silently and let the figure animate in place. Web typecheck clean.

  - **SSR Tests redesign (all 3 tabs):** reworked `SSRPage.tsx` to a cohesive,
    UI-Kit-aligned design while keeping all data/logic untouched. New shared
    `TestResultBanner` mirrors the SCRResultPanel StatusBanner (coloured left
    rail + tint, status dot + PASS/FAIL/NO DATA label, test title + plain-English
    formula, and the test's single headline figure big on the right) — replaces
    the three ad-hoc headline cards. Added a `ZoneBar` (red/green zones split at
    the threshold with a marker for where the club sits + axis ticks) to the
    Liquidity and Equity tabs so pass/fail is visual and intuitive; Liquidity
    plots net liquid position vs the £85M floor, Equity plots the ratio vs the
    season cap. Working Capital gained a 12-block "season at a glance" pass/fail
    strip (green/red/dashed-empty per month with a legend) above the grid, and the
    grid now tints failing rows + shows a status dot per month. Tabs got numbered
    pills (1/2/3). Shared `SectionHeader`/`StatBlock`/`LegendDot` primitives for
    consistency. Web typecheck clean; presentational only.

  - **Consequence Engine (live league table + breach impact visualiser):**
    surfaces the real-world consequence of a Red-Threshold breach.
    - *Backend:* new `apps/api/src/routes/league-table.ts` → `GET /league-table`
      (auth'd, registered in `server.ts`). Resolves the caller's league from
      their club, proxies football-data.org v4 standings (`PL` / `ELC`) using a
      server-side `FOOTBALL_DATA_API_KEY` (added to `.env.example`; key never
      reaches the browser). On missing key / upstream error / 6s timeout it
      returns a bundled end-of-2025-26 snapshot (`source: 'fallback'`) so the
      endpoint never hard-fails. Response: `{ leagueId, competition, season,
      source, fetchedAt, standings: LeagueTableRow[] }`.
    - *Existing logic reused:* points deduction comes from the engine's
      `calculatePointsDeduction` — the Dashboard already computes `pointsDeduction`
      + `riskStatus` on the active baseline; `isBreach = riskStatus === 'red'`.
    - *Frontend data:* `api.leagueTable.get()` + types in `api.ts`; shared
      `useLeagueTable` hook (`lib/useLeagueTable.ts`) fetches the table and
      fuzzy-matches the user's club row (`normaliseTeam`/`findClubRow`, strips
      FC/AFC etc.).
    - *New League Table tab:* `pages/LeagueTablePage.tsx` + nav item (table icon)
      in `Sidebar.tsx` + `/league-table` route in `App.tsx` + `routeLabel` in
      `AppLayout.tsx`. Pure read-only standings using UI-Kit table styling
      (matches the Dashboard squad table); highlights the user's row (violet
      "You" chip), promotion/play-off/relegation zone rails + legend, live/cached
      data-source tag, crest-with-initials fallback, skeleton loader, and an
      error/retry fallback card.
    - *Dashboard impact:* below the SCR hero, when `riskStatus === 'red'` a
      `ConsequenceAlert` danger banner ("Regulatory Breach Detected: Estimated
      Sanction of −X Points") plus `components/dashboard/LeagueImpactTable.tsx`.
      The impact table clones the live standings, subtracts the sanction from the
      club's points, re-sorts (pts → GD → GF), shows Current → Projected position
      (e.g. 12th → 18th) with a "▼ N places" chip, and renders the projected
      table with the club's row highlighted red + per-row move arrows. Degrades
      to a skeleton while loading and a contained notice if the table is
      unreachable or the club can't be matched. Source standings are never
      mutated. API + web typecheck clean; web prod build passes; API boots with
      the route registered (401 without auth, i.e. not 404).
    - *Follow-up (logos + cache):* the fallback snapshot rows now carry real
      crest URLs (`https://crests.football-data.org/{id}.png`, football-data team
      ids hard-coded per club) so logos render even offline; the browser onError
      degrades a 404 crest to the initials chip. All 44 PL+ELC ids verified 200.
      Added a 6h in-memory per-league cache of the last successful LIVE fetch so
      the rate-limited free tier isn't hit on every dashboard load (process-local;
      restart re-fetches). NOTE: the snapshot's positions/points are illustrative
      placeholders (league composition is 25/26-correct, but exact standings are
      only real when `FOOTBALL_DATA_API_KEY` is set → live mode).

  - **Dashboard refinements (consequence + scenarios):**
    1. *Interactive scenario inclusion* — new `ScenarioInclusionCard` on the
       Dashboard lists every scenario with a `Switch`; toggling calls
       `setScenarioInclusion` (optimistic) + `api.scenarios.update`, so the SCR
       %, Headroom card, gauge and Consequence section all recompute live.
       Gated by `can.toggleActiveBaseline` (disabled switch + tooltip otherwise).
       Replaces the read-only status-only view with a control surface.
    2. *De-duplicated points deduction* — `FinancialRiskCard` no longer renders
       in the red zone (dropped its `pointsDeduction` prop + red branch); the
       figure now appears once, in the Consequence Engine section.
    3. *League impact → 5-club before/after* — `LeagueImpactTable` rewritten to
       show a tight 5-club window (2 up · club · 2 down) BEFORE (live) and AFTER
       (−pts applied) side by side, with crest logos + initials fallback and the
       club row highlighted (violet before, red after), keeping the Current →
       Projected ordinal summary + "▼ N places" chip. No full table on the dash.
    4. *Headroom to Green now scenario-aware* — the hero Headroom stat uses the
       active baseline (`riskHeadroomPence` / `riskThresholds.greenPence` /
       `riskRevenuePence`) instead of settings-only, with an "incl. N scenarios"
       tag. Web typecheck + prod build clean.

  - **Per-scenario money impact ("how much is each scenario worth?"):** new
    `scenarioMoneyImpact(financials, scenario)` in `lib/scr.ts` returns
    `{ costDeltaPence, revenueDeltaPence, headroomDeltaPence }`. The engine's
    cost/revenue deltas are additive (independent of baseline), so a scenario's
    worth is a stable property — read by applying its actions to the settings
    baseline and diffing. Headline figure = `headroomDeltaPence`
    (= 0.85·Δrevenue − Δcost), the net change in headroom to the Green threshold:
    **+ (green) frees SCR room, − (red) consumes it**. Verified vs engine
    (£40M+£10M/yr buy → −£20M; £30M sale w/ £6M wage relief → +£27.25M).
    Surfaced as a compact signed chip ("+£8.2M") with a cost/revenue tooltip:
    (a) on every row of the Scenarios list (`ScenarioListItem`, gains a
    `financials` prop), and (b) on the Dashboard `ScenarioInclusionCard` —
    shown **only for included (turned-on) scenarios** per the requested rule.

---

## Currency Architecture — workspace base currency (GBP / EUR / USD)

Every club now runs all financial data (input, storage, FFP engine) in a single
**base currency**. There is **no conversion anywhere** — the base currency only
selects the display symbol (£ / € / $); the engine keeps running on the exact
integer pence values entered.

- **Shared (`packages/shared`)**
  - `types.ts`: new `Currency = 'GBP' | 'EUR' | 'USD'`.
  - `money.ts`: `CURRENCY_SYMBOLS`, `currencySymbol(c)`, and `formatMoney(pence, currency, opts)`
    (Intl currency formatting; per-currency locale). `formatPence` is now a thin
    GBP wrapper around `formatMoney` (back-compat).
  - `configs.ts`: `getDefaultCurrencyForLeague(league)` — PL / Championship → GBP;
    La Liga / Serie A / Bundesliga / Ligue 1 → EUR; **fallback EUR**. Accepts both
    app league ids ('premier-league') and human names ('Premier League').

- **Schema + migration**
  - `Club.baseCurrency Currency @default(GBP)` + `Club.currencyIsCustom Boolean @default(false)`,
    plus a `Currency` enum. Migration `20260602000001_club_base_currency`
    (CREATE TYPE + two `ADD COLUMN IF NOT EXISTS`). **Additive/idempotent; not auto-applied.**
    Apply with `cd apps/api && npx prisma migrate deploy` (or run the SQL in Supabase).

- **Backend (`apps/api`)**
  - `getDefaultCurrencyForLeague` drives the default on: club seed insert
    (`prisma/seed.ts`), onboarding-complete (adopts league → re-derives currency
    unless `currency_is_custom`), and `PATCH /club/league` (re-derives unless custom).
  - New `PATCH /club/currency` (CFO only): sets `base_currency` + `currency_is_custom = true`.
    No financial records are converted.
  - `GET /club` now returns `baseCurrency`. League-change/onboarding responses carry it too.

- **Frontend (`apps/web`)**
  - `lib/api.ts`: `Currency` type wired through `club.get`, `setLeague`, new `club.setCurrency`,
    and `OnboardingCompleteResponse`.
  - `stores/club.ts`: `baseCurrency` (default GBP) + `setBaseCurrency`; threaded through `setClub`.
    Hydrated by `ProtectedRoute` and `OnboardingPage`.
  - `lib/useWorkspaceCurrency.ts` (NEW): `{ currency, symbol, format }` — single source of truth
    for the symbol everywhere. Changing the setting re-renders all consumers instantly.
  - **Settings → Financial tab**: new `BaseCurrencyCard` (CFO-only) — styled select
    (£ GBP / € EUR / $ USD), pre-selected to current, Save calls `setCurrency`. Shows a
    standard **amber warning alert** when changing with a populated roster
    (`contractCount > 0`): "Changing the base currency does not convert existing
    financial records…". FinancialTab inputs/labels/threshold previews now use the symbol.
  - **Dynamic symbols** applied via the hook across the named surfaces:
    - RosterPage: `PoundInput` (modal fee/wage/agent inputs), `FinancialCell` (squad table
      money), `Field` (auto-swaps "(£)" → symbol in all modal labels), staging table
      headers + agent cell, player/manager drawers, contract ledger, carried-book-value field.
    - DashboardPage: SCR hero headroom/threshold/revenue, cost-breakdown table + total,
      green/amber risk card, scenario impact badge (`signedCompactPence` now symbol-aware).

Typecheck (api + web) and full `pnpm build` clean. Pure helpers unit-verified
(symbols, formatMoney GBP/EUR/USD, league→currency mapping incl. fallback).

**Manual step:** apply the migration to the DB before relying on the new columns —
`cd apps/api && npx prisma migrate deploy` (or paste
`prisma/migrations/20260602000001_club_base_currency/migration.sql` into Supabase SQL editor).

### Currency follow-up — full-project dynamic sweep

After the initial pass, swept every remaining money surface so the symbol
(£ / € / $) is dynamic everywhere (no conversion — same pence, new label):

- **TopBar SCR pill** (`AppLayout.tsx`): `fmtGBP` → `fmtMoneyCompact(pence, symbol)`;
  `SCRBreakdownPopover` now reads `useWorkspaceCurrency` (revenue / squad costs /
  adjusted revenue).
- **SSR Tests** (`SSRPage.tsx`): `Field` auto-swaps "(£)" labels; `PoundInput`,
  `PoundCell`, `SignedPence` currency-aware; `fmtCompactPence(pence, symbol)`;
  Working Capital tooltip + table header + cells, Liquidity preview/threshold/chart
  ticks, and the £12.5M / £85M threshold copy all use the symbol.
- **Calendar** (`CalendarPage.tsx`): expiring-contracts drawer player wages.
- **Scenarios** (`ScenariosPage.tsx`): `Field` auto-swap, `PoundInput`,
  `formatPenceNumber(pence, symbol)`, `signedPence(p, fmt)`,
  `compactSignedPence(pence, symbol)`; ScenarioListItem impact chip, ProjectionPanel
  cost tiles, PlayerPicker wage, CompareModal Δ stats, CompareColumn costs/revenue.
- **Exports (PDF + Excel)**: new `lib/exports/exportCurrency.ts` holds the active
  export currency (set once per export — they're synchronous/non-overlapping).
  `pdfMoney` → `exportMoney`; Excel `GBP_FORMAT` const → `moneyFormat()` (dynamic
  `${symbol}#,##0;[Red]−${symbol}#,##0`). Entry points `exportSquadPDF`,
  `exportComparisonPDF`, `exportAmortisationXLSX` gained an optional `currency`
  prop; the three call sites pass it from the workspace currency.

Reusable leaf components (`Field`, `PoundInput`, `FinancialCell`, etc.) were made
currency-aware so most call sites needed no change. `SCRResultPanel` /
`AmortisationTable` under `components/simulator/` were left as-is — they're dead
code (not imported/rendered anywhere; only `ComplianceGauge`, which shows no money,
is used). Web typecheck + full `pnpm build` clean.

---

## Session — Granular Permissions (replace enum roles) (2026-06-03)

### What changed

Ripped out the single enum-`role` access model (`cfo` / `sporting_director` /
`finance_analyst` / `admin`) and replaced it with three explicit boolean grants
plus an optional free-text job title.

**Permission model (per user + per invite):**
- `canEditRoster` — add/edit/delete players + contracts (else roster is read-only)
- `canEditScenarios` — create/modify simulation scenarios (else read-only)
- `isWorkspaceAdmin` — Settings, members, base currency, league, financials, SSR,
  audit log, onboarding. **Admin implicitly satisfies every permission check.**
- `title` — display-only job title (e.g. "Head of Finance"); no access of its own.

### Phase 1 — DB
- `apps/api/prisma/schema.prisma`: `User` and `Invite` drop `role` (it was a
  `String`, not a Prisma enum), gain `title String?` + the 3 booleans
  (`@map` snake_case). Schema validates + formatted.
- Migration `prisma/migrations/20260603000001_granular_permissions/migration.sql`:
  additive + backfill + drop, idempotent. Backfill mapping from legacy role:
  admin/cfo → admin+roster+scenarios; finance_analyst → roster+scenarios;
  everyone → scenarios (old `mutateScenarios` was open to all); `title` set from
  the old role label. **NOT auto-applied** — runtime uses Supabase client, so run
  `cd apps/api && npx prisma migrate deploy` (or paste the SQL into Supabase)
  before the new columns exist in the live DB.
- `prisma/seed.ts`: dev user seeded as admin (all three true, title 'CFO').

### Phase 2 — Backend
- New `apps/api/src/middleware/permissions.ts` (`requirePermission(perm)`,
  `hasPermission(perms, perm)`, `Permissions` type, `PERMISSION_LABEL`).
  Deleted `middleware/roles.ts`.
- `middleware/auth.ts`: selects the 3 bool columns, attaches
  `request.permissions` (replaces `request.userRole`); invite-linking + founder
  provisioning carry/grant permissions (founder = full admin; invitee inherits
  the invite's grants).
- Route guard remap: roster mutations → `canEditRoster`; scenario
  create/modify/delete → `canEditScenarios` (added preHandlers to POST + DELETE,
  inline check on PATCH); financials/league/currency/delete-club, onboarding,
  audit, **and SSR** → `isWorkspaceAdmin`; invites + team CRUD → `isWorkspaceAdmin`.
- `GET /me` now returns `{ title, canEditRoster, canEditScenarios,
  isWorkspaceAdmin, ... }`. `PATCH /team/:id` accepts a permission/title patch
  (admins can't edit their own grants). `POST /invites` + `GET /invites` +
  `/invites/lookup` carry the grants.

### Phases 3 & 4 — Frontend
- `lib/role.ts` repurposed: `AppMe`/`Permissions`, `useMe()`, `accessLabel()`,
  and `useCan()` (admin overrides everything; same predicate names —
  `mutateRoster`, `toggleActiveBaseline`, `switchLeague`, etc. — so existing
  consumers needed no change). `has('cfo')` call sites → `isWorkspaceAdmin`.
- `lib/api.ts`: `Permissions` type; `InviteRow`/`TeamMember`/`InviteLookupResponse`
  extend it + `title`; `invites.create` takes title+grants; `team.update` replaces
  `team.updateRole`.
- `ClubSetupPage.tsx` Team & Access tab rebuilt with UI Kit components:
  - Invite card: Email + **Job Title (Optional)** inputs + a **PermissionToggles**
    group (UI Kit `Switch`) for Edit Roster / Edit Scenarios / Workspace Admin
    (admin toggle locks the other two on). No more Role dropdown.
  - Active users table: **Permissions** column rendering `<PermissionTags>`
    ([Admin] / [Edit Roster][Edit Scenarios] / [Read-Only]); per-row **Manage
    access** (sliders icon) opens `ManageAccessModal` (pure-fade) with the same
    toggles + title, saving via `api.team.update`.
  - Pending invites table also shows permission tags + title.
- `AppLayout` account chip shows `accessLabel(me)` (title → tier fallback).
- `LoginPage` invite banner uses `inviteAccessSummary()` instead of role label.

API + web typecheck clean; full `pnpm build` green.

## Session — Internationalization (i18n) scaffolding

European-expansion groundwork: English (en, fallback), Spanish (es), French
(fr), Italian (it). Architecture + UI toggle only — the app text is NOT fully
translated yet (Sidebar nav is the proof-of-concept).

### Phase 1 & 2 — Config + global init
- `pnpm add i18next react-i18next` (apps/web).
- `src/locales/{en,es,fr,it}/translation.json` — structural keys only:
  `nav.*` (the 7 sidebar items), `common.*` (save/cancel/delete/edit/close/
  loading), `settings.interfaceLanguage(+Hint)`.
- `src/lib/i18n.ts` — single global i18next instance (`initReactI18next`, no
  `<I18nextProvider>` needed). `fallbackLng: 'en'`, `escapeValue: false`.
  Exports `SUPPORTED_LANGUAGES`, `LANGUAGE_LABELS` (native names), and
  `setLanguage(lng)` which calls `changeLanguage` + persists to localStorage
  (`headroom-language`); boot reads the saved choice back.
- `main.tsx` imports `./lib/i18n` for its init side effect before render.

### Phase 3 — Language toggle (Settings ▸ Profile & Security)
- `InterfaceLanguageCard` in `ClubSetupPage.tsx`: UI Kit Card + SectionHeader +
  the native styled `<select>` (same class convention as the currency picker).
  Options English / Español / Français / Italiano; onChange → `setLanguage`.

### Phase 4 — Locale-aware formatting (dates/numbers, NOT currency)
- `src/lib/locale.ts` — `activeLocale()` maps the live i18n language → BCP-47
  (`en-GB`/`es-ES`/`fr-FR`/`it-IT`); `formatDate()` / `formatNumber()` read it
  at call time. **Money stays currency-locale-based** (`formatMoney`) and is
  untouched, per the "don't disrupt data formatting" directive.
- POC wiring: `CalendarPage` `fmtDate` now uses `formatDate` (e.g. "01 juil.
  2026" in FR, "01 lug 2026" in IT) — removed the hardcoded English `MONTHS`.

### POC text wrapping
- `Sidebar.tsx` nav items carry `labelKey` (`nav.*`) rendered via
  `useTranslation().t()` — switching language re-localizes the sidebar live.

Verified: i18next `changeLanguage` returns translated values for all 4 langs;
Intl date parity confirmed per locale. web typecheck clean; `pnpm build` green.
Rest of the app intentionally left in English (no mass string conversion).

### Follow-up — UI Kit Select (replaces native dropdowns)
- New `components/ui/select.tsx` — generic, styled dropdown mirroring
  `CountryPicker` (trigger button + popup listbox, violet field style, rotating
  chevron, check on the active row, click-outside/Escape). Each option takes an
  optional `leading` node.
- Settings ▸ Base Workspace Currency and Interface Language now use `<Select>`
  instead of the native `<select>` (fixes the cramped browser arrow/padding).
  Currency options show a £/€/$ glyph; languages show a `<Flag>` (GB/ES/FR/IT).

## Session — Expert Co-pilot (RAG AI assistant) (2026-06-03)

A retrieval-augmented (RAG) AI co-pilot that explains the SCR regulations and the
engine's already-computed figures, grounded strictly on the Nov 2025 Premier
League financial-system explainer. **Hard rule kept throughout: the LLM never
does arithmetic** — it reads serialized engine output and explains it; all maths
stays in `@headroom/engine`.

### Provider-abstraction decision (Phase 2 × Phase 5)
The spec asked for both a hand-rolled `LLMService`/`AnthropicAdapter` seam AND the
Vercel AI SDK. Reconciled by implementing the `LLMService` interface *powered by*
the AI SDK — the seam abstracts the provider choice (swap adapter → Gemini/GPT in
one line), the AI SDK abstracts the wire protocol. Pinned **AI SDK v4**
(`ai@4.3.19`, `@ai-sdk/anthropic@1.2.12`) to match the named `ai/react` `useChat`
+ `streamText` + `pipeDataStreamToResponse` surface (v5 moved/renamed these).

### Embeddings decision
Anthropic has no embeddings endpoint, so retrieval uses **local** sentence
embeddings — `@xenova/transformers` all-MiniLM-L6-v2 (384-dim) running in the
Fastify process. No new vendor, no key, no per-call cost; ideal for the one-page
corpus. `pnpm-workspace.yaml` `allowBuilds` sets `protobufjs`/`sharp` → `false`
(image-pipeline deps we don't use; onnxruntime-node ships prebuilt) so installs
exit clean.

### Phase 1 — RAG database (pgvector)
- `apps/api/prisma/rag.sql` (apply in Supabase SQL editor, like `rls.sql`):
  `create extension vector`; `documents(id, content, embedding vector(384),
  source_url, created_at)`; HNSW cosine index; `match_documents(query_embedding,
  match_count)` SQL RPC returning top-k by cosine similarity; RLS enabled with no
  client policy (service-role only, like the template tables).
- `apps/api/src/lib/embeddings.ts` — lazy singleton `embedText`/`embedMany`
  (mean-pooled, normalised, 384-dim) used by **both** ingest and query time.
- `apps/api/src/scripts/ingest-knowledge-base.ts` (`pnpm --filter @headroom/api
  ingest:kb`) — fetches the source URL, strips HTML→text, paragraph-chunks with
  overlap, embeds, and refreshes the `documents` rows for that source_url
  (idempotent; embeds first so a failure never half-wipes the table).

### Phase 2 — LLM abstraction (`apps/api/src/services/ai/`)
- `types.ts` — `LLMService` / `StreamChatParams` / `LLMStream` (provider-agnostic).
- `system-prompt.ts` — `buildSystemPrompt(passages)` with the mandated guardrails
  verbatim: co-pilot **not** a legal advisor; references the Nov 2025 PL explainer;
  tells the user to verify against the unpublished official 2026/27 Handbook;
  answer strictly from the retrieved passages; treat serialized engine numbers as
  authoritative and never recompute.
- `anthropic-adapter.ts` — `AnthropicAdapter implements LLMService` via
  `createAnthropic` + `streamText` (model `ANTHROPIC_MODEL`, default
  `claude-sonnet-4-6`; key `ANTHROPIC_API_KEY`, server-side only).
- `knowledge-source.ts` — single source-of-truth URL/label shared by ingest +
  prompt. `index.ts` exposes the `llm` singleton.

### Phase 5 backend — `apps/api/src/routes/chat.ts` (`POST /chat`, auth'd)
Embed the latest user turn → `match_documents` RPC (top-5) → inject passages into
the system prompt → `llm.streamChat(...).pipeToResponse(reply.raw)` after
`reply.hijack()`. Retrieval failure (e.g. `rag.sql` not yet applied) logs and
proceeds with no passages rather than 500-ing. Rate-limited 20/min. Registered in
`server.ts`. `.env.example` gains `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`.

### Phase 3 — Chat UI (`apps/web`)
- `lib/copilotContext.ts` — shared `CONTEXT_PREFIX` contract + `buildContextInjection`
  / `parseContextLabel`, and the public source URL/label (mirrors the API const).
- `stores/copilot.ts` — zustand `open(context?)` / `close` / `consumeInjection`
  (one-shot, StrictMode-safe).
- `components/ai/CopilotChat.tsx` — right-hand sliding drawer (framer-motion) built
  from UI-Kit primitives (Button/Input + inline SVG icons). `useChat` from
  `ai/react` → `/api/chat` with an auth-injecting `fetch` (fresh Supabase bearer
  per call). Streams tokens live; every assistant turn carries a **"Source" chip**
  linking to the PL explainer; context-injection messages render as a compact
  "Analyzing …" chip (not raw JSON). Header carries the "not legal advice"
  disclaimer. `CopilotLauncher` floating button. Mounted once in `AppLayout`.

### Phase 4 — Context-aware triggers (serialize → `append`)
A reusable `components/ai/CopilotTrigger.tsx` (button + icon variants). On click,
the page serializes engine output into JSON and `open()`s the drawer, which
silently `append`s it for an immediate breakdown:
- **Dashboard** — button by the SCR hero/gauge: revenue, squad costs, current SCR
  %, zone, headroom to Green, thresholds, included-scenario count.
- **Roster** — sparkle icon on each squad row: player name, position, annual wage,
  remaining contract, current book value, annual amortisation, total squad costs.
- **Scenarios** — button next to the Plan Actions: current SCR %, projected SCR %
  + zone, and the proposed transactions (type + money fields per action).

### Verification
- `pnpm typecheck` — all 4 packages clean. `vite build` green (bundle +~0.4 MB for
  the AI SDK). Engine/shared untouched. Confirmed `ai@4.3.19` exposes `ai/react`
  `useChat` + `pipeDataStreamToResponse`.
- **Not runnable end-to-end without setup** (no live keys here): the user must
  (1) apply `apps/api/prisma/rag.sql` in Supabase, (2) set `ANTHROPIC_API_KEY` in
  `apps/api/.env`, (3) run `pnpm --filter @headroom/api ingest:kb` to populate the
  knowledge base. First chat/ingest downloads the ~90 MB MiniLM model once.

### Notes / deployment caveats
- In dev the web proxies `/api` → Fastify same-origin, so the hijacked stream needs
  no CORS. In a **cross-origin prod** split, `reply.hijack()` skips Fastify's
  onSend hooks (helmet/CORS), so put web + api same-origin or add the CORS header
  to `reply.raw` before piping.
- Branch not committed — awaiting user instruction.

### Setup applied to live env (this session)
- `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL=claude-sonnet-4-6` added to `apps/api/.env`
  (gitignored). Model is **Sonnet 4.6** per request.
- `prisma/rag.sql` applied to Supabase (pgvector + `documents` + `match_documents` + RLS).
- `ingest:kb` run → **44 passages** embedded from the live PL explainer and stored.
- `@xenova/transformers` eagerly imports **sharp** at load, so `pnpm-workspace.yaml`
  `allowBuilds` now sets `sharp: true` (its native binary must build); `protobufjs: false`.
  Symptom if skipped: API crashes on boot → Vite proxy returns 500 for all `/api/*`.

### Bugfix — Dashboard blank-on-load (hooks-order violation)
The Phase-4 trigger declared `const openCopilot = useCopilot(...)` **below** the
Dashboard's early returns (loading / no-financials). When the loader cleared, the
component called one more hook than the prior render → React "rendered more hooks
than previous render" → blank screen. Moved the hook to the top of the component
(above all early returns). Roster/Scenarios already had theirs at the top.

## Session — Compliance Analyst UX overhaul (2026-06-03)

Reworked the AI chat (renamed **Co-pilot → Compliance Analyst** everywhere
user-facing; internal `copilot` store/file names kept). Backend unchanged except
the system-prompt self-identification.

1. **Persisted multi-session history.** `stores/copilot.ts` rewritten with zustand
   `persist` (localStorage `headroom-analyst-sessions`): `sessions[]` (id, title,
   messages, timestamps) + `activeId`. Auto-titles a chat from its first user
   message (or its context label, e.g. "Dashboard · Haaland"). New/switch/delete/
   rename. `open(context)` calls `ensureActiveSession` and **continues** the active
   session (never silently forks) — satisfies "AI analysis continues the session".
2. **Fullscreen mode + session switcher.** `CopilotChat` now renders either a
   right **drawer** (default, `max-w-lg`) or a **fullscreen** overlay with a left
   **SessionSidebar** (new chat, history list, switch, hover-delete). Header
   expand/collapse toggles `isFullscreen`.
3. **useChat ↔ store sync.** One `useChat` instance; a LOAD effect (`[activeId]`
   only, reads sessions via `getState()` to avoid clobber loops) calls `setMessages`
   on session switch; a SAVE effect persists on each message boundary + stream end
   (skips per-token writes via a count/sig guard). Injection is appended via a
   ref-guarded, deferred `append` (StrictMode-safe; fires after the load flush).
4. **Markdown.** New `components/ai/Markdown.tsx` — `react-markdown` + `remark-gfm`
   with custom UI-Kit-styled renderers (bold, lists, **tables**, code, links,
   blockquote). Replaces the old plain-text bubble.
5. **Scroll fix.** `MessageList` owns its scroll: instant `scrollTop = scrollHeight`
   in `useLayoutEffect`, and only auto-sticks when the user is within 80px of the
   bottom (scroll up to read freely). Removes the laggy smooth-scroll-per-token.
6. **Modern UI to the kit.** Gradient violet Analyst avatars, rounded-2xl bubbles
   (assistant card + violet user bubble), auto-grow textarea composer with
   Enter-to-send / Shift+Enter newline, stop button while streaming, example-prompt
   empty state, per-answer Source chip, framer mount fades.
7. **Triggers.** `CopilotTriggerButton` is now a prominent gradient "Ask the
   Analyst" pill (Dashboard SCR card + Scenarios Plan Actions). Roster icon is
   **hover-reveal** per row (`group-hover` opacity) so it isn't visually duplicated
   across every player — fixes the "button copied a million times" complaint.

Deps: `react-markdown@9`, `remark-gfm@4` (web). Verification: `pnpm typecheck`
all 6 tasks clean; `vite build` green (+~170 KB gzip for markdown). Not committed.

## Session — Analyst: backend history, Rules tab, button polish (2026-06-03)

Four follow-up fixes.

1. **Real backend chat history** (replaces the localStorage v1). New
   `apps/api/prisma/chat.sql` — `chat_sessions` + `chat_messages` (ids are TEXT to
   match the Prisma `String` schema and the text-returning `current_club_id()`;
   an earlier `uuid` draft failed the RLS `uuid = text` comparison), club-scoped
   RLS backstop. Applied to live DB. `routes/chat.ts` gained session CRUD
   (`GET/PATCH/DELETE /chat/sessions[/:id]`, per-user) and **persist-on-finish**:
   the turn is saved in the AI SDK `onFinish` (new optional `onFinish` on
   `StreamChatParams` → adapter → only the new user msg + assistant reply are
   stored; the client sends full history but prior turns are already saved).
   `lib/api.ts` got an `api.chat.*` namespace; `stores/copilot.ts` rewritten to be
   API-backed (session metadata from `/chat/sessions`, messages fetched on switch,
   new chats are local until first send, `refreshSessions()` on `onFinish`). The
   client sends `sessionId` in each `useChat` request `body`. Verified the routes
   return 401 (registered) and the tables persist.
2. **Scenarios trigger height** — `CopilotTriggerButton` now wraps the UI-Kit
   `<Button variant="outline">`, so it's the same height (h-9 default) as the
   adjacent ActionAdder and every other app button.
3. **Dashboard trigger** — same UI-Kit button at `size="sm"`, sitting cleanly
   under the status badge instead of the bespoke gradient pill.
4. **Rules tab** (`/rules`, between Calendar and Financials). New
   `pages/RulesPage.tsx` — Headroom's **own plain-English summary** of the SCR/SSR
   framework (formula, inclusions, three zones + allowance, sanctions, the 3 PL
   SSR tests, Championship specifics, assessment calendar), NOT a reproduction of
   any third-party article; links to the official PL statement at top + bottom.
   Wired route + Sidebar nav (book icon) + `routeLabel` + `nav.rules` i18n (en/es/
   fr/it). The Analyst's **Source chip now deep-links in-app to `/rules`** (closes
   the chat, navigates) instead of the external site.

Verification: `pnpm typecheck` 6/6 clean; `vite build` green; `chat.sql` applied +
session routes 401-gated. Not committed.

## Session — Analyst: professional prompts, auto-compaction, tests (2026-06-03)

### 1. Prompt quality (all tabs)
- `services/ai/system-prompt.ts` rewritten into a professional, structured system
  prompt: what Headroom is, the SCR/SSR domain framing, who the user is, how to
  read each module's injected data (Dashboard / Roster / Scenarios), the analyst
  role/task, and the hard guardrails (not legal advice; source = Nov 2025 PL
  explainer; verify the unpublished 2026/27 Handbook; **never recompute** engine
  numbers; answer from retrieved passages). Accepts an optional `summary` (for
  compaction).
- `lib/copilotContext.ts` per-tab injections rewritten with a tailored analysis
  brief per module (Dashboard = standing/headroom/levers; Roster = one player's
  SCR contribution + sell/extend/release; Scenarios = current→projected + watch-
  outs), so each trigger produces a focused, decision-grade answer.

### 2. Seamless auto-compaction + visible context bar
- **Shared pure logic** `packages/shared/src/chatContext.ts`: `estimateTokens`,
  `estimateContextTokens`, `contextUsageRatio`, `shouldCompact`, `planCompaction`,
  with conservative constants — `CONTEXT_TOKEN_LIMIT=3000`, trigger at 80%,
  `KEEP_RECENT_TURNS=4`, `MIN_TURNS_TO_COMPACT=7` (a count guard so a couple of
  big messages can't thrash). Used by **both** client and API.
- **Backend** `services/ai/history.ts` (`deriveTitle`, `buildSummaryPrompt` — keeps
  acronyms verbatim) + `LLMService.complete()` (non-streaming `generateText` in
  the Anthropic adapter). New `POST /chat/compact`: reads the session, plans the
  split, summarises the older turns (merging any prior summary) via the LLM,
  stores the summary on `chat_sessions.summary` (new column), **deletes** the
  summarised rows, returns `{ summary, messages: kept }`. `POST /chat` now folds
  `body.summary` into the system prompt; `GET /chat/sessions/:id` returns it.
- **Frontend** `stores/copilot.ts` gains `activeSummary`; `CopilotChat` runs an
  idle-only auto-compaction effect (no manual action), sends `summary` in every
  request body, restores it on session load, and renders a **`ContextBar`**
  (violet→amber→red fill, % + "Compacting…" + "compacted") above the composer,
  plus an "Earlier conversation summarized" divider. The user never compacts
  manually but sees the bar fill and the compaction happen.

### 3. Tests + verification
- `apps/api/src/scripts/chat-context.test.ts` (token math, usage ratio,
  shouldCompact count+token thresholds, planCompaction order/keep, no-thrash
  property) and `chat-prompt.test.ts` (system prompt carries identity/domain/
  modules/guardrails/source/summary; deriveTitle plain+context cases;
  buildSummaryPrompt labelling + prior-summary merge). **`test:scripts` 54/54.**
- `pnpm typecheck` 6/6 clean; `vite build` green; `/chat/compact` + session routes
  401-gated on boot; `chat.sql` summary column applied to live DB; live one-shot
  check confirmed `llm.complete` summarises correctly. Not committed.

### Follow-up — context ring + meaningful drop
- **Circular ring** replaces the horizontal bar (`ContextRing` — an SVG gauge that
  fills like the Claude Code / Cursor context indicator; violet→amber→red, pulses
  while compacting, shows the %).
- **Compaction now drops the ring close to empty** (was 100→79%). Root cause: with
  a 3000-token budget and 4 kept turns, the kept messages alone were ~66%. Fixed by
  raising `CONTEXT_TOKEN_LIMIT` 3000→**8000** and lowering `KEEP_RECENT_TURNS`
  4→**2** (the summary carries the rest), so a freshly-compacted chat (small summary
  + last exchange) reads ~10–20%. `MIN_TURNS_TO_COMPACT` = 5, trigger 0.75.
- New test asserts post-compaction usage `< 0.35` and `< before/2`. **test:scripts
  55/55**, typecheck 6/6, build green.

### Follow-up — context ring redesign
- The ring is now **text-free and lives inside the composer**, just left of the
  send button (`ContextRing` moved into `Composer`; the standalone row removed).
  Hovering shows a clean slate-900 tooltip ("Chat context · N%" / "Compacting
  context…" / "· compacted"). On-brand with the UI Kit (Inter, violet, rounded).
- Confirmed (product decision) that compaction floors at ~**19%**, not 0: the
  remaining context is the running summary (~3%) plus the last exchange kept
  verbatim (~16%) — both are real tokens sent to the model. Kept
  `KEEP_RECENT_TURNS = 2` (continuity over a literal-zero reset). typecheck clean,
  build green.

---

## AI credit balance system (Compliance Analyst billing) — 2026-06-04

Hardcoded prepaid USD credit per user, debited per Analyst query at Anthropic
Sonnet token cost + 10% margin. No payment gateway — top-ups are manual (admin
DB edit). Deterministic SCR engine remains entirely untouched.

### Phase 1 — schema (`schema.prisma` + migration)
- `User` gains `aiBalanceUsd Decimal @default(5.00)` (`ai_balance_usd`) and
  `totalAiTokensUsed Int @default(0)` (`total_ai_tokens_used`).
- Migration `20260604000001_user_ai_balance/migration.sql` (idempotent, additive):
  adds the columns as `NUMERIC(10,4)`/`INTEGER`, and defines
  `deduct_ai_balance(p_user_id text, p_cost numeric, p_tokens int) RETURNS numeric`
  — an **atomic** debit doing all arithmetic in Postgres NUMERIC, `ROUND(…,4)` and
  `GREATEST(0, …)` so the balance never drifts (no 4.81999999) or goes negative.
  Applied to the live DB via `prisma db execute` + `prisma generate`. Verified:
  all existing users defaulted to $5.00, RPC returns the new balance.

### Phase 2 — pricing utility (`apps/api/src/utils/aiPricing.ts`)
- `INPUT_PRICE_PER_1M=3.00`, `OUTPUT_PRICE_PER_1M=15.00`, `MARGIN_MULTIPLIER=1.10`.
- `calculateQueryCost(inputTokens, outputTokens)` → base USD cost × margin, guards
  negative/NaN as 0, rounds to 6 dp (clean number for the NUMERIC(10,4) column).

### Phase 3 — backend (`POST /api/chat`)
- **Pre-check**: reads `users.ai_balance_usd`; if `<= 0.01` returns **402** with
  `"AI balance depleted. Please contact your workspace admin to top up."` before
  spending a token.
- **Deduction**: the LLM seam (`services/ai/types.ts`) now passes token usage to
  `onFinish` (`ChatFinishResult { text, usage{promptTokens, completionTokens} }`);
  the AnthropicAdapter forwards `event.usage`. The route's `onFinish` persists the
  turn **and** calls `calculateQueryCost` → `supabase.rpc('deduct_ai_balance', …)`.
  Best-effort: a debit failure is logged, never breaks the stream.
- `GET /me` now returns `aiBalanceUsd` (NUMERIC parsed via `Number()`).

### Phase 4 — UI (UI Kit only)
- **Settings → Profile & Security**: new **AI Usage** `Card` showing the balance
  (`formatUsd` → "$4.82"), subtext "To top up your balance, please contact Headroom
  support.", a loading skeleton until `/me` resolves, and a red "Depleted" badge at
  ≤ $0.01.
- **Chat drawer**: subtle `Balance: $4.82` footer (left of the disclaimer, amber
  ≤ $0.50, red ≤ $0.01, "…" while loading). On **402** the `useChat` `fetch`
  wrapper latches a depleted state → the composer is replaced by a clean red notice
  and input is blocked until refilled. Balance refetched on open and after each
  turn. New `formatUsd` helper in `lib/utils.ts` (USD regardless of workspace
  currency).

### Tests + verification
- `apps/api/src/scripts/ai-pricing.test.ts` (margin, rounding/float-drift cleanup,
  output>input, realistic mixed query, negative/NaN guards). **test:scripts 61/61.**
- web `tsc` + `vite build` green; api `tsc` green; migration applied + RPC verified
  live. Not committed.

---

## Onboarding — European-expansion league teasers — 2026-06-04

Roadmap teaser on the league-selection step (`OnboardingPage.tsx`): added **La Liga**
and **Serie A** as a second row, turning the existing `grid-cols-1 sm:grid-cols-2`
into a clean **2×2** on desktop (no grid changes needed — extra cards wrap).
- `LeagueMeta` gains `comingSoon?` + a `TeaserLeagueId` ('la-liga' | 'serie-a').
- Teaser cards render as a **non-clickable `<div>`** (no button semantics, can't be
  focused/clicked), dimmed with the UI Kit `opacity-60`, logo `grayscale`, and the
  "Choose this league →" CTA replaced by a muted **🔒 Coming Soon** badge. `onChoose`
  is only passed to active leagues.
- Copy: La Liga — "Top flight · LCPD economic controls & individual squad caps";
  Serie A — "Top flight · FIGC Liquidity Index & structural sustainability checks";
  both "20 clubs".
- Added original SVG placeholder wordmarks (`public/leagues/la-liga.svg`,
  `serie-a.svg`) — not the trademarked official logos (IP-safe for a teaser).
- New inline `LockIcon`. typecheck clean; rendered + verified the 2×2 muted layout.

### Follow-up — league teaser polish
- Rebuilt `la-liga.svg` / `serie-a.svg` as circular **crest-style** marks in brand
  colours (La Liga red #EE2737, Serie A Italian green #009246) — original
  placeholders, not the trademarked official logos (drop licensed files in at the
  same paths to swap).
- Serie A accent bar → green (`from-green-600 to-emerald-700`).
- Shortened taglines to match Prem/Championship: La Liga "Top flight · LCPD cost
  controls & squad caps"; Serie A "Top flight · FIGC liquidity & sustainability
  checks".
- Removed `grayscale` from the teaser logo so the brand colours (incl. Serie A
  green) show; kept `opacity-60` for the muted/inactive read. typecheck clean.

### Follow-up — real league logos
- Replaced the placeholder SVGs with the official La Liga / Serie A logos (user-
  supplied Transfermarkt CDN URLs), saved as `la-liga.png` / `serie-a.png` —
  139×181 RGBA, identical format + location + reference pattern as the existing
  `premier-league.png` / `championship.png`. `logo` paths flipped `.svg` → `.png`;
  placeholder SVGs removed. Serie A keeps the green accent bar. typecheck clean.

### Follow-up — balance chip redesign
- Replaced the plain "Balance: $5.00" footer text with a modern, centred
  **credit chip** (`BalanceChip`): soft pill carrying the Analyst spark mark + the
  amount, shifting violet → amber (≤ $0.50) → red (≤ $0.01). Loading state is a
  pulsing dot + "Loading credit…"; hover expands a subtle "credit" label. Blends
  into the composer rather than reading as raw text. typecheck clean.

### Follow-up — balance chip moved to header
- Moved the `BalanceChip` from the composer footer up into the chat **header**
  (left of the New/Fullscreen/Close buttons). The composer footer row is gone, so
  the input sits flush at the bottom. `balanceUsd` now flows to `Header`, dropped
  from `Composer`. typecheck clean.

### Follow-up — hard-stop sending at $0 balance
- Closed every client send path when depleted (backend 402 is the hard guarantee):
  `submit` (already), `onExample` now returns early + example buttons render
  `disabled`, and the context-injection effect skips firing when depleted (injection
  stays pending until topped up). Frontend threshold (≤ $0.01) matches the backend.
- Balance now refetches on open, after each turn, AND on window focus /
  visibilitychange — so a manual admin top-up clears the depleted lock without a
  reopen. `depleted` recomputes false as soon as the balance reads > $0.01.
- typecheck clean.

---

## Admin panel (separate app) — 2026-06-04

A standalone, server-rendered control panel in `apps/admin/` — separate from the
platform (own port 4000, own session auth), but talks to the same Supabase project
via the service-role key. Deployable independently later. Stack chosen for
"functionality over UI": one Fastify app rendering plain HTML + form posts (no
build step, no second port). Run: `pnpm --filter @headroom/admin dev`.

### Auth
- Single admin login from env (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), constant-time
  compared; success sets a signed httpOnly cookie (`ADMIN_SESSION_SECRET`). Every
  route except /login is guarded; wrong password → /login?error=1. Fully separate
  from platform user auth.

### Users (CRUD)
- List all accounts (email, name, club, access, AI balance, tokens, created).
- Detail page: edit name/email (email change goes through Supabase auth-admin so
  auth.users stays in sync; rejects duplicate emails), reset password (auth-admin),
  delete account (removes chat/scenarios/audit/notifications + users row + auth
  user; leaves the club).
- **AI chat balance**: shown per user (red ≤ $0.01); top-up (add USD, via float-safe
  `admin_topup_balance` RPC) and set-exact.

### Maintenance jobs
- Trigger the two manual scripts; each run spawns the EXACT api package script
  (`pnpm --filter @headroom/api sync:templates` / `update:league`), captures output,
  refuses concurrent same-type runs, and records an `admin_jobs` row (who, start/
  finish, status, summary, log tail). Full history table + per-job log view.

### League table → snapshots (new behaviour)
- Extracted football-data fetch + bundled fallback into `lib/league-table-source.ts`.
- New `scripts/update-league-table.ts` (`update:league`) fetches both leagues and
  stores `league_table_snapshots` rows (deactivating the prior active one).
- `GET /league-table` now serves the newest ACTIVE snapshot → else live (6h cache)
  → else bundled. So the admin's "League table update" publishes the active table
  with full history.

### DB (`apps/api/prisma/admin.sql`, applied live)
- `league_table_snapshots` (league_id, competition, season, source, standings jsonb,
  is_active, fetched_at), `admin_jobs` (type, status, triggered_by, summary, log,
  started_at, finished_at), `admin_topup_balance()` RPC. RLS on, service-role only.

### Verified
- Login + auth gate, wrong-password reject; users list (5 accounts); balance top-up
  (+$2.50 → correct new balance) and set-exact; league_table job ran → success,
  2 live snapshots stored, shown in history with timestamps + log. api + admin
  `tsc` clean. `apps/admin/.env` is gitignored (creds mirror apps/api/.env;
  ADMIN_PASSWORD is a dev placeholder — change before deploy).

### Follow-up — balance prefetch + README
- Credit chip was only fetched when the chat drawer opened (slow first paint).
  `CopilotChat` is mounted in the app shell for the whole session, so added a
  mount-time `refreshBalance()` — the balance is now warmed at app load and is
  ready before the drawer opens. Open + focus refetches retained.
- README documents the three `pnpm dev` localhosts (web 5173, api 3001, admin
  4000), the admin `.env` setup, the architecture tree entry, and an Admin Panel
  section.

### Follow-up — Compare scenarios modal polish
- Replaced the raw native `<select>` (chevron crowding the edge) with the UI Kit
  `<Select>` — proper pl-3/pr-2.5 padding + controlled chevron.
- Projection cards now informative: compliance StatusBadge, SCR figure tinted by
  zone (green/amber/red), a directional "vs baseline" delta (arrow + colour), and
  clean labelled Squad costs / Revenue rows. Empty column shows a dashed
  placeholder so the two sides stay balanced.
- Delta footer (B vs A) colour-codes ΔSCR / ΔCosts / ΔRevenue (red = worse,
  green = better) with signed values. typecheck clean.

### Spanish translation rollout — wave 1 (i18n)
- Began full app translation to Spanish, module by module, on the existing
  i18next/react-i18next scaffolding (single `translation` namespace, nested by
  module). `en` is the source/fallback; `es` translated in lockstep.
- Translation files grew from 24 lines (3 demo keys) to **239 keys** with full
  **en↔es parity** (verified by a flat-key diff: 0 missing, 0 extra).
- Modules completed this wave (wired with `t()` / `<Trans>` + es copy):
  - **Foundation** — `common` (buttons, statuses, positions GK/DEF/MID/FWD →
    POR/DEF/MED/DEL, action plurals), compliance `gauge` legend.
  - **Chrome** — Sidebar (workspace, change-club modal, first-run nudge),
    AppLayout top bar + SCR breakdown popover, NotificationBell (incl. relative
    time), SeasonSelector.
  - **Auth** — LoginPage (sign-in / sign-up / 2FA / OTP / forgot-password,
    invite banner via `<Trans>`, zod validation messages now built from `t`
    via `makeSignInSchema`/`makeSignUpSchema`), ResetPasswordPage.
  - **Dashboard** — DashboardPage (hero SCR, headroom, scenario inclusion,
    financial-risk, consequence engine, per-player table with localized
    position pills + expiry labels), LeagueImpactTable (locale-aware ordinals),
    ComplianceGauge.
  - **Financials** — page shell (FinancialTab itself lands with Settings).
- Football/finance terminology preserved: SCR = "ratio de coste de plantilla",
  levy = "recargo", points deduction = "descuento de puntos", squad =
  "plantilla", wage = "salario", amortisation = "amortización", agent fee =
  "comisión de agente", Green/Red threshold = "umbral verde/rojo".
- Verified: `tsc --noEmit` clean, `vite build` OK (2758 modules), engine tests
  119/119 pass, en/es JSON valid + full key parity.
- Remaining (pending, same pattern): Roster, Scenarios + simulator panels,
  League Table, Calendar, Rules, SSR, Onboarding, Settings (ClubSetupPage +
  FinancialTab), AI chat, UI primitives. fr/it fall back to en until translated.

### Spanish translation — complete (whole app, en↔es)
- Finished translating the **entire web app** to Spanish, module by module, on the
  existing i18next/react-i18next setup (single `translation` namespace, nested by
  module). `en` is source/fallback; `es` translated in lockstep at **full parity**.
- **1015 keys**, en↔es verified by flat-key diff (0 missing, 0 extra).
- Every page + shared surface wired with `t()` / `<Trans>`:
  - **Chrome**: Sidebar, AppLayout + SCR breakdown popover, NotificationBell,
    SeasonSelector.
  - **Auth**: Login (sign-in/up, 2FA, OTP, forgot — zod messages built from `t`),
    ResetPassword.
  - **Pages**: Dashboard (+LeagueImpactTable, ComplianceGauge), Roster (full —
    CSV import + staging editor, manual/edit player, manager add/edit, contract
    ledger + phase editor, extension wizard, NBV/carried-book-value, all modals),
    Scenarios (builder, action editors, projection, compare modal), League Table,
    Rules (regulatory reference via `<Trans>` + `returnObjects` lists), Calendar
    (regulatory event timeline + expiry drawer), SSR (3 calculator tabs),
    Onboarding (league teasers + club wizard), Financials, Settings (FinancialTab,
    BaseCurrency, Profile/AI-usage/Password/2FA, Team & invites, Activity log,
    Danger zone).
  - **AI chat**: CopilotChat (greeting, example prompts, composer, balance chip,
    context ring, header, history, depleted state) + CopilotTrigger.
  - **UI primitives**: StatusBadge default labels, DatePicker (localized month/day
    names via Intl + aria), Select / CountryPicker placeholders.
- **Locale-aware formatting**: dates/numbers now render via the active interface
  locale (`lib/locale.ts` Intl helpers) — Roster/Calendar/SSR/LeagueTable/Settings
  date columns, SSR month grid, DatePicker calendar, league-impact ordinals.
- **Football/finance terminology preserved**: SCR = "ratio de coste de plantilla",
  levy = "recargo", points deduction = "descuento de puntos", squad = "plantilla",
  wage = "salario", amortisation = "amortización", agent fee = "comisión de
  agente", Green/Red threshold = "umbral verde/rojo", table abbrevs PJ/PG/PE/PP/
  GF/GC/DG, positions POR/DEF/MED/DEL.
- **Verified**: `tsc --noEmit` clean, `vite build` OK (2758 modules), engine tests
  119/119, en/es JSON valid + 1015-key parity. fr/it still fall back to en (next
  languages to translate — keys are all in place).

### French + Italian translations — complete (all 4 languages live)
- Added full **French (fr)** and **Italian (it)** translations using the English
  file as the source template — both translated key-for-key, preserving every
  `{{interpolation}}`, plural suffix (`_one`/`_other`), `<Trans>` tag
  (`<s> <b> <n> <e> <v> <d> <c0…c4>`), and array (lists, calendar rows, example
  prompts).
- **All four locales now at 1015 keys with exact parity** (en/es/fr/it — 0
  missing, 0 extra each). `i18n.ts` already imported + registered fr/it, so the
  Settings → Interface Language picker offers English / Español / Français /
  Italiano and switches instantly.
- Football/finance terminology localized professionally per language:
  - FR: SCR = "ratio de coût de l'effectif", effectif, prélèvement, retrait de
    points, indemnité de transfert, amortissement, commission d'agent, seuil
    vert/rouge; table J/G/N/P/BP/BC/Diff; postes GB/DÉF/MIL/ATT.
  - IT: SCR = "rapporto costo rosa", rosa, prelievo, penalizzazione in punti,
    costo del trasferimento, ammortamento, commissione del procuratore, soglia
    verde/rossa; table G/V/N/P/GF/GS/DR; ruoli POR/DIF/CEN/ATT; svincolo,
    allenatore, ingaggio.
- Locale-aware dates/numbers already in place flow through to fr/it automatically
  (month/day names, ordinals, currency-symbol-aware fields).
- **Verified**: 4-locale parity check (1015 each), `tsc --noEmit` clean,
  `vite build` OK, engine tests 119/119. The Spanish/French/Italian apps are
  fully translated; English remains the source & fallback.

### Shipped — i18n committed & pushed
- Committed all four locale files (1015 keys each, full parity) + every page/
  component wired with `t()`/`<Trans>` + UI primitives, as **`b37aff2`**
  ("i18n: full app translations for Spanish, French & Italian"), pushed
  `a83cd6c..b37aff2 main -> main`.
- 29 files staged by explicit path (`apps/web/src` + `BUILD_LOG.md`); no `.env`
  staged. Pre-push checks green: tsc clean, vite build OK, engine tests 119/119,
  4-locale parity (en/es/fr/it = 1015 keys, 0 missing / 0 extra).
- Net result: the entire app ships in English (source/fallback), Spanish,
  French and Italian, switchable from Settings → Interface Language.

---

## 2026-06-05 — Notification dedup bug + i18n follow-ups (countries, AI language)

### Bug fix — duplicate notifications (doubled bell entries)
- **Root cause:** `createNotificationOnce` ([apps/api/src/lib/notifications.ts])
  deduped with a non-atomic *SELECT-then-INSERT*. Two near-simultaneous
  `POST /notifications/refresh` calls both passed the existence check before
  either inserted → two identical rows (same timestamp). Reproduced exactly the
  doubled "5h ago" / "1d ago" pairs in the user's screenshot.
- **Trigger:** `NotificationBell`'s mount `useEffect` calls `refresh()` with no
  in-flight guard; **React.StrictMode** double-invokes mount effects (dev) and
  the `seasonStartYear` dep + 60s poll can overlap — so two refreshes fire at
  once. Not dev-only: the race also occurs across tabs / API instances.
- **Fix (two layers, defence in depth):**
  1. *Frontend* — `stores/notifications.ts` now coalesces concurrent `refresh`
     calls behind a module-scoped in-flight promise (overlapping callers share
     one derive+reload).
  2. *Backend* — `createNotificationOnce` now writes via `upsert(..., {
     onConflict: 'id', ignoreDuplicates: true })` with a **deterministic primary
     key** `dedup_<sha1(club|user|title|window-bucket)>`. Racing inserts collide
     on the PK (ON CONFLICT DO NOTHING) so exactly one wins. The rolling-window
     SELECT is kept for the normal "already alerted within 24h" case. **No
     migration** — `notifications.id` is already a TEXT primary key.

### i18n — country names localized in the nationality picker
- Player & coach nationality were always shown in English. Added
  `countryName(country, locale)` in [apps/web/src/lib/countries.ts] using
  **`Intl.DisplayNames`** (region) to localize the ~190 ISO countries per
  interface language automatically — no hand-translated country tables. The four
  football home nations (England/Scotland/Wales/Northern Ireland) aren't ISO
  regions, so they use a small hand map (en/es/fr/it). Falls back to the
  canonical English name when a code/locale can't resolve. `DisplayNames`
  instances are cached per locale.
- Wired `CountryPicker` (trigger label, list rows, search match — now matches
  the localized name, English name, and code — and locale-aware sort) plus both
  `NationalityFlag` tooltip renderers (Roster + Dashboard). Stored value is
  unchanged (still canonical English) — presentation only.

### i18n — AI Compliance Analyst replies in the user's language
- `buildSystemPrompt` ([apps/api/src/services/ai/system-prompt.ts]) now takes a
  `language` option and appends a **"# LANGUAGE — respond in <X>"** directive
  (en/es/fr/it → English/Spanish/French/Italian) with football-finance
  vocabulary guidance, keeping SCR/SSR acronyms, club names and currency codes
  as-is, and deferring to an explicit user request for a different language.
- Threaded through: `POST /chat` reads `body.language`; `CopilotChat` sends
  `i18n.language` in `sendOpts()` (covers all three send paths — submit, append,
  injected prompt).
- **Verified:** tsc clean (all 5 pkgs), engine tests 119/119, API prompt tests
  6/6, web `vite build` OK, locale parity es/fr/it = 991 keys, 0 missing/0 extra
  (no JSON changes — country localization is code-level).

### UX fix — double scrollbar / scroll chaining behind overlays
- **Symptoms:** (1) scrolling the Copilot chat also scrolled the page behind it
  (two scrollbars on the right, intersecting); (2) with a dialog open, the page
  kept scrolling even while interacting inside the dialog.
- **Cause:** no overlay locked page scroll, and the panels' inner scroll areas
  let wheel/touch **chain** to the window once they hit their end.
- **Fix — shared `useScrollLock` hook** ([apps/web/src/lib/useScrollLock.ts]):
  while any overlay is open it sets `body { overflow: hidden }` and pads the
  body by the scrollbar width (no layout jump when the bar disappears).
  **Reference-counted at module scope** so stacked overlays (a modal that opens
  a nested picker, or the drawer over a page that also has a modal) coordinate —
  the lock applies on the first open and releases only on the last close;
  StrictMode's mount→cleanup→mount nets to one lock.
- Applied to every dimming overlay: Copilot chat (drawer + fullscreen, keyed on
  `isOpen`), Roster `ModalShell` (covers all 6 roster modals), Scenarios
  `CompareModal`, ClubSetup `ManageAccessModal`, Calendar expiring-contracts
  drawer, Sidebar change-club modal. Anchored popovers (SCR breakdown,
  notifications, date-picker) intentionally do **not** lock.
- Defence in depth: added `overscroll-contain` to each overlay backdrop and to
  the scrollable regions (chat message list + session list, calendar drawer body,
  notifications list) so a wheel/touch at a scroll boundary can't chain to the
  page even before the lock engages.
- **Verified:** tsc clean (all 5 pkgs), web `vite build` OK.

### UX fix — horizontal table overflow in non-English languages
- Longer translated strings widened tables past their card, clipping the last
  column (most visible on the Dashboard squad-cost breakdown). Wrapped each
  table in an `overflow-x-auto` container + a `min-w-[…]` on the table so it
  scrolls horizontally instead of being cut off.
- Tables fixed: Dashboard breakdown + `LeagueImpactTable`, Roster squad table,
  SSR working-capital table, Rules reference table, ClubSetup team / invites /
  activity tables. Already scrollable (left as-is): League Table page, Roster CSV
  staging grid, chat markdown tables.
- **Verified:** tsc clean, web `vite build` OK.

### UX fix — chat reopens in the small drawer (never fullscreen)
- `copilot` store: `close()` and `toggle()` now reset `isFullscreen` to false
  when the panel closes, so a fully-closed chat always reopens as the small
  drawer. Re-triggering `open()` while still open in fullscreen (a context
  inject) intentionally keeps fullscreen.

---

## 2026-06-05 — Rebrand: Headroom → 85Percent

Renamed the **platform brand** from "Headroom" to "85Percent" (case-preserving:
`Headroom`→`85Percent`, `headroom`→`85percent`, `HEADROOM`→`85PERCENT`).

**Critical nuance — the word is overloaded.** "headroom" is also the core
*financial* term (spare capacity under the SCR cap), used pervasively as code
identifiers (`headroomRemaining`, `liquidityHeadroomPence`, `worstHeadroomPence`,
`redThresholdHeadroom`, …) and as UI copy ("Headroom to Green", "Liquidity
Headroom", th "Headroom", i18n `tipHeadroom`/`thHeadroom`/`{{headroom}}`). A
literal global replace would (a) break the build — `85percentRemaining` is not a
valid JS identifier — and (b) corrupt domain copy. So the rebrand was scoped
**brand-only, user-visible-only** (confirmed with the user):

- **Rebranded:** new shared `Wordmark` component (`apps/web/src/components/ui/Wordmark.tsx`,
  bold violet "85" + slate "Percent", replaces the pitch-glyph "H" logo in
  Sidebar + LoginPage); `index.html` `<title>` = "85Percent | Football Financial
  Compliance" + meta + Inter 800 weight added; AppLayout brand fallback; AI system
  prompt ("85Percent Compliance Analyst" + product description) + its test; admin
  panel ("85Percent Admin"); PDF/XLSX disclaimers + header + export filename
  prefixes (`85percent-squad-…` etc.); club-name fallbacks ("85Percent FC");
  TOTP issuer; disclaimer/intro/footer/greeting/topUp brand strings in all 4
  locales; README + design-system catalog brand text; seed club name.
- **Deliberately untouched:** the financial term "headroom" (identifiers AND
  copy like "Headroom to Green"); `@headroom/*` workspace package scope + imports;
  `localStorage` keys (`headroom-auth`, `headroom-language`, `headroom.activeSeason`,
  `headroom-me`) — renaming would log users out / drop saved language; seed login
  email `dev@headroom.test`; historical docs (CONTEXT/PLAN/DOCKER/mvp_2.0_plan/
  prior BUILD_LOG entries).

**Verified:** typecheck (7/7), build (5/5, web vite OK), engine 119/119, API
scripts 61/61 (incl. prompt brand assertion), locales valid + parity (1015 each).

---

## 2026-06-06 — Brand logo: real "85" mark integrated (favicon + Wordmark)

Replaced the interim typography logo with the finalized design-team mark from
`design/Logo/85Percent Logo.html` (rendered by `design/Logo/mark85.js`): a
monoline, hexagonally-constructed "85" with a vertical, symmetric violet
gradient — outer tips dissolve to white, materialising inward to the brand
core `#6D28D9`, then fading back to white at the bottom anchors. One free end
(the 5's bottom-left stub) fades into the surface via its own gradient.

- **New `Mark85` component** (`apps/web/src/components/ui/Mark85.tsx`) — a faithful
  React/SVG port of the source geometry + "gradient" palette. `size` = mark
  height (px); stroke is optically scaled exactly as the source
  (`max(2.4, 7·h/300 + 1.6)`); gradient ids are per-instance via `useId` to avoid
  DOM collisions; `fadeTo` matches the surface behind the mark.
- **`Wordmark` rebuilt as logo Option 2** — `Mark85` + "Percent" in **Space
  Grotesk 400** (`#1E293B`, tracking −0.015em), word size & gap derived from the
  mark height to hold the design proportions. Rendered as a **clickable but inert
  control** (`<button>`, hover/focus affordance, no navigation yet — wire `onClick`
  or a router link when the marketing landing exists). Used in Sidebar (size 28,
  top-left) and LoginPage (size 42), the two placements the user specified.
- **Favicon** (`apps/web/public/favicon.svg`) = logo Option 1 (standalone mark)
  on a white rounded tile, geometry baked + stroke thickened for legibility at
  16–32px.
- **Space Grotesk** added to the Google Fonts `<link>` in `index.html` (alongside
  Inter + JetBrains Mono).
- The financial "headroom" term, `@headroom/*` scope and storage keys remain
  untouched (see prior entry).

**Verified:** web typecheck clean; web build OK (vite, 2761 modules); favicon
rasterised at 16/32/64/128 (reads as the violet "85"); wordmark lockup rendered
in Chrome at sidebar/login sizes on white + slate-50 (Space Grotesk loads, tips
dissolve cleanly, mark leads "Percent" per the design).

**Favicon follow-up (same day):** at 16–32px the large mark's white-fading tips
made the "85" nearly invisible. Reworked the favicon (`apps/web/public/favicon.svg`)
to a favicon-specific build — gradient kept in visible violets (`#8B5CF6`→`#6D28D9`
→`#5B21B6`, no white fade), thicker stroke, and the mark enlarged in the tile —
so it reads boldly. Verified at 16/32/48 in simulated light + dark browser tabs.

**Favicon = Option 1 mark at the in-app bold weight (next day):** per user, the
favicon now uses logo Option 1 ("The mark") geometry + the symmetric
white→violet→white gradient from `design/Logo/85Percent Logo.html`, but with the
stroke set to match the on-screen Wordmark "85" (Mark85 `strokeScale=8` at the
login lockup → 22.6 mark-space units) instead of the native thin 6.967. So the
favicon's boldness is identical to the in-app 85Percent logo. Centered on a white
rounded tile; verified at 16/32/64/128 in light + dark tabs — reads well and
matches the logo. (Interim states this session: bolder favicon-specific build →
faithful thin Option 1 → this, the bold Option 1.)

**Wordmark "85" weight (same day):** the in-app lockup's mark read too thin at
sidebar/login sizes. Added a stroke-weight knob to `Mark85`; "Percent" unchanged.
Final: replaced the `strokeScale` multiplier with an **absolute `strokeWidth`**
(mark-space units, the 440×420 viewBox) so the same value gives proportionally
identical boldness at any size, and set `strokeWidth={16.95}` in `Wordmark`
(= base 2.825 × 6, matching the LinkedIn export). Both registration and sidebar
"85" now carry that exact weight. (Favicon is a separate static asset, currently
at 22.6/8×.)

**Wordmark zoom (same day):** decoupled mark vs word scale. Added a `markScale`
prop to `Wordmark` — the word ("Percent") and gap derive from the base `size`,
while `markScale` scales only the "85" mark. Final: the two placements differ.
both placements share the "85" 1.25× / "Percent" 1× ratio.
- **Sidebar** `size={31.5} markScale={1.25} gap={6}` (25% smaller than login).
- **LoginPage** `size={42} markScale={1.25} gap={8}`.
(`size` carries the word scale, `markScale` the extra mark scale; `gap` absolute.)
Both fit their placements (sidebar in the 240px/64px header).

**Equal gap (same day):** added an optional absolute `gap` prop to `Wordmark`
(defaults to proportional `markHeight×0.18`); pinned to `gap={8}` so the
mark↔"Percent" spacing is identical across pages.

(History: scales went whole-block 1.5×→1.25×, then decoupled to sidebar 1.5×/1.25×
& login 1.25×/1×, then unified to 1.25×/1× on both.)

**Logo folder cleanup (pre-push):** pruned `design/Logo/` to the essentials —
kept `85Percent Logo.html` (canonical lockups), `mark85.js` (mark source of truth,
referenced by the HTML + app code comments), and `exports/` (LinkedIn logo + cover
PNGs). Removed outdated marks & iteration artifacts (`85 Mark.html`,
`85 Mark build.html`, `85Percent Brand Identity.html`, `design-canvas.jsx`,
`logo-marks.jsx`, `screenshots/`, `uploads/`, `.DS_Store`).

---

## Shared AI balance for workspace members (guest = owner's pool)

**Problem:** AI credits were per-user (`users.ai_balance_usd`). Every club
member — including invited "guests" — had their own balance, so a guest spent
their own credit instead of the club's. The intent is one shared pool per
workspace, owned by the founder.

**Fix (API only — no schema/RLS/SQL change needed):** the server uses the
service-role Supabase client (bypasses RLS) and `deduct_ai_balance(p_user_id…)`
already takes the target user as a param, so routing balance reads/writes to the
owner was a pure code change.

- **New** `apps/api/src/lib/clubOwner.ts` → `getClubOwnerId(clubId)`: the
  owner is the earliest-created `is_workspace_admin` in the club (the founder
  from authMiddleware), falling back to the earliest member. Single source of
  truth — the only place to change if a real `clubs.owner_id` is added later.
- **`routes/chat.ts`** — resolve `balanceOwnerId` once after auth; the 402
  pre-check reads the owner's balance; the `onFinish` debit hits the owner
  (`p_user_id: balanceOwnerId`). History persistence still uses the acting
  user's id.
- **`routes/club.ts` `/me`** — `aiBalanceUsd` now returns the owner's balance
  (shared pool) so the chat credit chip + Settings both show it. For the owner
  this is just their own row.

**Chat isolation preserved:** `chat_sessions` / `chat_messages` inserts remain
keyed to `request.userId`, and reads filter by `user_id` — a guest's history
stays private; the owner never sees it and vice-versa. Only the balance is
shared.

**Not changed (note):** admin panel still tops up a *specific* user — to refill
a workspace, top up its owner (guest balances are now never read). `tsc --noEmit`
clean.

---

## Frontend caching — instant tab switching (no re-shimmer)

**Problem:** tabs are React Router routes, so each navigation unmounted the page
and its `useEffect` re-ran a fresh Supabase fetch behind a 3–4s skeleton — every
single switch, even when the data was unchanged.

**Fix:** TanStack Query (`@tanstack/react-query` v5). The QueryClient cache lives
ABOVE the router (main.tsx `QueryClientProvider`), so server data survives the
page unmount/remount. Skeletons now gate on `isPending` (genuine first load, no
cache) — a stale-while-revalidate background refresh is `isFetching` and keeps
the existing data on screen.

- `src/lib/queryClient.ts` — client defaults: staleTime 5m (revisits within 5m
  don't refetch at all → truly instant), gcTime 30m, refetchOnWindowFocus off,
  retry 1.
- `src/lib/queries.ts` — query-key factory + per-fetch hooks (roster, archived,
  manager, financials(season), scenario details, league table, SSR
  wc/liquidity/equity). Error-tolerant fetches (manager, financials) resolve to
  null, mirroring the old `.catch(() => null)`.
- Pages refactored: Dashboard, Roster, Scenarios, SSR (3 tabs), Calendar; and
  `useLeagueTable` now wraps the query internally (same return shape → Dashboard
  + LeagueTable unchanged at call sites). Each: local `useState(loading)`+effect
  fetch → query hook; skeleton on `isPending`.
- Mutations invalidate the matching query key so a revisit reflects server state:
  Roster (`refresh()` now invalidates roster/archived/manager/financials);
  Scenarios (create/delete/toggle-include); SSR saves (per-season key). The
  zustand club store still receives financials/scenarios via sync effects so the
  TopBar SCR pill keeps working.

**Not converted:** ClubSetup (Settings) sub-sections still fetch on mount — a
low-traffic settings tab, outside the daily-workflow shimmer; optional follow-up.

**Verified:** `tsc --noEmit` clean, `pnpm build` succeeds, app boots headless
with the provider (login renders, no runtime errors). Authenticated tab
click-through left to manual QA (needs API + login).

---

## State-update fix — cache no longer clobbers optimistic store writes

**Bug:** after the caching refactor, toggling a scenario's include switch (or
editing financials in Settings) could revert on tab switch — the page showed
stale state. Cause: I added effects that **re-seeded the zustand store from the
TanStack Query cache on every change/remount**. On revisit the cache is served
before any refetch, so a stale cached copy overwrote the just-made optimistic
update.

**Principle applied:** data that is mutated optimistically and shared across tabs
lives in the **zustand store as the single source of truth** (it already persists
across tab switches). Query is used only to *seed* the store on first load — never
to re-clobber it afterwards.

- **ScenariosPage** — seed the store from `scenarioDetails` query only when
  `!scenariosLoaded` (first load); skeleton now gates on the store's
  `scenariosLoaded` (instant revisits, independent of query GC); removed the
  post-mutation `invalidateQueries` on create/delete/toggle. Optimistic
  `setScenarioInclusion` + server persistence are authoritative; the server does
  round-trip `is_included`, and AppLayout's financials-triggered reload keeps it
  fresh.
- **RosterPage** — dropped the financials query + its sync effect (same clobber
  class: a Settings financials edit could be reverted from stale cache). Roster
  /archived/manager stay query-owned (read directly, no store). After a roster
  mutation, financials are refreshed once imperatively into the store
  (`setFinancials(await api.club.getFinancials(season))`).
- Removed the now-dead `useFinancialsQuery` hook + `financials` query key.

**Audited & OK (no clobber):** Dashboard (players from shared roster query;
scenarios/financials from store; own toggle is store-optimistic, no refetch),
SSR tabs (per-season editable forms, reseed-after-save matches prior behaviour),
League Table & Calendar (read-only). `tsc` clean, `pnpm build` succeeds.

## 2026-06-09 — Repo hygiene: docs grouped, landing-page groundwork, scope rename @headroom → @85percent

Three pre-landing-page housekeeping pieces.

**1. Planning docs grouped into `docs/`.** Moved `BUILD_LOG.md`, `CONTEXT.md`,
`PLAN.md`, `DOCKER.md`, `mvp_2.0_plan.md` out of the repo root into `docs/`
(git renames, history preserved). `README.md` stays at root (front door) with its
tree diagram updated; the `ssr.ts` source comment repointed to `docs/CONTEXT.md`.

**2. Landing-page groundwork (no app code yet).**
- `apps/landing-page/landing-page-spec.md` — full architectural spec for the public
  marketing site (Next.js 14, design tokens mirrored from `apps/web`, framer-motion
  motion doctrine, carousel + lead-capture architecture). Decisions: Next.js over
  Vite SSG; logo extracted to a future `packages/brand`.
- `demo_requests` lead-capture table — migration
  `apps/api/prisma/migrations/20260609000001_demo_requests_lead_capture/`. RLS
  ENABLE + FORCE; the ONLY policy is `FOR INSERT TO anon` → anon can insert a lead
  but cannot SELECT/UPDATE/DELETE. GRANT layer mirrors it (`REVOKE ALL`, then
  `GRANT INSERT`). Service-role (BYPASSRLS) reads/triages. Email-format + length
  CHECK constraints harden the public write path. Modeled in Prisma as
  `DemoRequest` (standalone, no relations). Includes a post-migration audit query
  confirming no public table is anon-readable.

**3. Workspace scope renamed `@headroom/*` → `@85percent/*`.** All 6 package names
(root `85percent`), ~150 imports/deps across 58 files, lockfile regenerated, `dist/`
rebuilt. Brand residuals also fixed: 3 SQL comment headers, `85PercentBot/1.0`
ingest User-Agent, dev seed creds (`dev@85percent.test` / `Dev@85percent1!`),
design scratch href. **Kept as-is (deliberate):** the financial domain term
"headroom" everywhere (`*HeadroomPence`, `tipHeadroom`, "Headroom to Green") —
overloaded, not brand; the repo dir name; `localStorage`/persist keys
(`headroom-auth`, etc. — would log users out without a migration shim); `docs/*.md`
historical logs. Verified: `pnpm -r typecheck` clean (5/5), 119/119 engine tests
pass, 0 `@headroom` left in code.

## 2026-06-09 — Caching follow-ups: login flash, settings tab caching, live identity, local-time activity log

Four fixes to the TanStack Query caching work.

**1. Dashboard "no club" flash on login.** Sign-out reset `financials` to null but
left `financialsLoaded: true` and never cleared the query cache, so the next
login rendered the Dashboard's setup empty-state against a stale "already loaded"
flag for ~3s. Fix (`ProtectedRoute.tsx`): on `SIGNED_OUT` also reset
`financialsLoaded: false` + `queryClient.clear()` (also closes a cross-user
roster-cache leak); plus a guard that forces `financialsLoaded: false` during the
post-login bootstrap window (clubId not yet known), so the skeleton always holds.

**2. Settings tabs re-loaded on every entrance (no caching).** Profile, Team and
Activity each fetched on mount with local `loading` state. Converted to shared
TanStack Query hooks (`useMeQuery`, `useTeamMembersQuery`, `useInvitesQuery`,
`useAuditLogQuery` in `queries.ts`); skeleton only on `isPending`, re-entry is
instant. Mutations invalidate the matching key; member-access edits patch the
cache optimistically with the server's returned values (no clobber); audit log
uses `keepPreviousData` so paging never flashes a skeleton.

**3. TopBar/Sidebar name + role chip stayed stale after a profile edit.** `useMe`
kept its OWN `/me` cache (localStorage, fetched once per session), separate from
the settings `['me']` query — so a name save updated Settings but not the chrome.
Unified `useMe` onto the shared `['me']` query (`role.ts`), keeping the
localStorage copy only as a reload paint-hint. Now a profile save invalidates
`['me']` and the name/role update live everywhere, no reload. Editing your own
access in the Team dialog also invalidates `['me']`.

**4. Activity log showed UTC, not local time.** Audit `created_at` is Postgres
`TIMESTAMP(3)` (no zone); Supabase returns it zone-less, so `new Date()` parsed
the UTC value as local and showed UTC digits. Added `parseServerDate()`
(`locale.ts`) — labels an unlabeled server timestamp as UTC, passes through
already-zoned/epoch values — and the activity log now renders it with
`toLocaleString` in the browser's zone.

Verified: `pnpm --filter @85percent/web exec tsc --noEmit` clean + `pnpm --filter
@85percent/web build` succeeds.

---

## Session — Marketing Landing Page (`apps/landing-page`) (2026-06-09)

Built the public marketing site end-to-end from `apps/landing-page/landing-page-spec.md`.
Stack decisions (user-confirmed): **Next.js 14 App Router** (the rest of the repo
stays Vite) and a new shared **`packages/brand`** for the logo. Runs independently
on **http://localhost:3100** (`pnpm --filter @85percent/landing-page dev`); web is 5173.

**1. `packages/brand` (`@85percent/brand`).** Extracted `Mark85` + `Wordmark` out of
`apps/web/src/components/ui/` into a dist-built package (same `tsc`→`dist` pattern as
shared/engine), both with a `'use client'` directive (preserved through `tsc`). Added
`tokens.ts` (violet ramp, gradient stops, stroke width). `apps/web` keeps one-line
re-export **shims** at the old paths so every existing import compiles unchanged.
`Wordmark` gained additive `wordColor`/`fadeTo` props (for the charcoal hero) — web
call sites use defaults, unaffected. Both `apps/web` and `apps/landing-page` consume it.

**2. Scaffold.** Next 14 + TS + Tailwind 3.4 (HSL-var tokens mirroring the app, plus
`violet-tip`/`hero-glow` gradients, `charcoal` band, `expo` easing), Inter + Space
Grotesk via `next/font`, `transpilePackages: ['@85percent/brand']`. Picked up by Turbo
via the existing `apps/*` glob. Dev port 3100.

**3. Motion system** (`components/motion/`). `variants.ts` (fadeUp/fadeIn/staggerParent,
`EASE_EXPO [0.16,1,0.3,1]`), `Reveal` (scroll fade-up, delay baked into the variant),
`Stagger` + `Stagger.Item`. Reduced-motion gated centrally by `<MotionConfig
reducedMotion="user">` in `app/providers.tsx`.

**4. Sections.** `Navbar` (transparent→frosted-white on scroll; `forceSolid` for legal
pages; mobile sheet), `Hero` + `HeroVisual` (signature SVG SCR gauge — green/amber/red
zones, violet-tip progress arc drawing to a coherent **81% under the 85% limit**, needle,
limit tick, wages/amortisation/headroom row; scroll parallax), `ProblemSolution` (#the-rule,
two beats + the 85% stat-formula card), `CapabilitiesCarousel` (#capabilities) — hand-rolled
framer-motion: one shared motion value for drag + `animate()`, focal-card-with-peeking-neighbours
depth falloff, 6s autoplay paused on hover/focus/drag/tab-hidden/reduced-motion, velocity
snap, full ARIA carousel + keyboard, dot + arrow controls. `Footer` (lockup, tagline,
legal links, contact). `RequestAccessButton` (3 variants, each owns a `DemoRequestDialog`).

**5. Lead capture (Supabase, anon INSERT-only).** `lib/demoRequest.ts` (shared zod schema +
`toRow`, honeypot accepted-not-rejected so it never 422s), `lib/supabase.ts` (lazy anon
client, anon key only), `app/api/demo-request/route.ts` (zod validate → honeypot silent-drop
→ per-IP rate-limit → anon insert), `DemoRequestDialog` (a11y modal: focus trap, Esc/backdrop
close, success/error states). Env in gitignored `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_ANON_KEY`); `.env.example` committed.
  - **Migration applied to live DB** (`20260609000001_demo_requests_lead_capture`, via Supabase
    Management API). **RLS smoke test passed:** RLS on, 1 INSERT-only policy, anon granted
    INSERT only; anon insert → 201, anon SELECT → 401 permission denied. Route e2e: valid → 200,
    bad email → 422, honeypot → 200 no-write. All test rows deleted; `demo_requests` back to 0.

**6. SEO / a11y.** Per-route `metadata` + canonical, JSON-LD (Organization + SoftwareApplication),
`robots.ts`, `sitemap.ts`, dynamic `opengraph-image.tsx` (charcoal + violet lockup + headline).
Legal stubs `/terms` `/privacy` `/ssr-disclaimer` (shared `LegalPage`, placeholder copy marked
counsel-owned). Reduced-motion, focus-visible rings, landmarks, `lang` set.

Verified: `next build` clean (9 routes, home 163 kB First Load), `apps/landing-page` tsc clean,
`apps/web` tsc + `vite build` still green (brand shim non-breaking). Every section visually
checked via headless-Chrome/CDP screenshots (scaffold, hero gauge, problem/solution, carousel
advance, demo dialog, OG image, legal page).

**Still open (spec §10):** real WhatsApp number (placeholder in `content/site.ts`), counsel legal
copy, optional commissioned hero render. Not yet committed.

### Landing follow-up round (2026-06-09) — copy, interactive logo, full feature set, live animations

1. **Copy/links.** Email → `contact@85percent.pro`; footer "WhatsApp Business" → "WhatsApp";
   copyright → "© 2026 85Percent. All rights reserved." Hero slogan priority swapped: **"Win the
   transfer window. Within the rules."** is now the prominent sub-headline; "Maximize your squad.
   Protect your points." is the CTA microcopy.
2. **Interactive logo.** `Mark85` gained a `tone` prop ('violet' default / 'white' white-cored for
   dark bands) and `Wordmark` gained `tone` + `interactive` (renders an inert `<span>` so it can
   sit inside the navbar `<a>` — fixes the nested-interactive). Navbar logo is **bigger (38px)** and
   **cross-fades white-on-charcoal ↔ violet-on-white** with the scroll/`forceSolid` state. Brand
   rebuilt; `apps/web` tsc still clean (additive props, defaults unchanged).
3. **Full platform section** (`PlatformFeatures`, `#platform`). 12-card grid of the complete feature
   set drawn from this log — every PL club (La Liga/Serie A next), pre-filled-or-upload squads (Prem
   & Championship), SSR tests, drag-drop scenario builder, compliance calendar, notifications,
   RAG-grounded AI analyst, PDF/Excel exports, 2FA + tamper-evident audit log, granular team
   permissions/invites, multi-currency/season, share. The 3 carousel pillars stay the focus; this is
   the depth. Nav reordered The Rule → Capabilities → Platform to match scroll order.
4. **Live value animations.** Extracted the hero gauge into a reusable, value-driven `ScrGauge`
   (single motion value → draws in on mount AND re-sweeps on value change; read-out/needle turn red
   past the limit). New **interactive `ScenarioDemo`** dark band ("Model the window. Watch the line.")
   — toggle real transfer moves (sign £60M striker +5.5pts, sell CB −4.1pts, …) and the SCR gauge
   sweeps live, headroom recomputes, status flips Compliant↔Breach with a red panel glow. New
   `CountUp` (on-view 0→value) applied to the 85% stat. HeroVisual refactored onto `ScrGauge`.
5. **Favicon.** Copied the web app's violet-tile white-"85" mark to `app/icon.svg` (Next emits the
   `<link rel="icon">`; serves 200 image/svg+xml).

Verified: `next build` clean (9 routes, home 168 kB First Load), landing + web tsc clean, brand
rebuilt. CDP-drove the interactive demo (breach 87% → toggle sale → compliant 82%) and the logo
cross-fade (white over hero / violet when scrolled); no console exceptions.

### Interactive mock-UI upgrade (2026-06-09) — SCR Command Center + AI Analyst chat

Goal: make the landing page demonstrate the product, not just describe it (Stripe/Linear-grade
interactive sections). Decisions taken with the user up front: **charts = hand-rolled SVG for the
radial gauge + recharts only for the one genuine multi-series trend chart**; **consolidate** the old
standalone `ScenarioDemo` into one larger "SCR Command Center" and add a new auto-typing AI chat.

1. **Dependency.** Added `recharts@^2.15.4` to `apps/landing-page` (the only new lib — declined
   recharts/visx for the gauge and declined magic-ui/aceternity wholesale because their spring/bounce
   defaults violate the no-bounce doctrine; the radial gauge stays hand-rolled framer-motion SVG).
2. **SCR Command Center** (`components/command-center/`, `#command-center`, replaces `ScenarioDemo`).
   One dark dashboard panel that folds the gauge + scenario loop together. State: `CURRENT = 0.78`,
   toggle a `Set` of moves (sign £80M striker +6.0, renew GK +2.0, loan winger +1.2, sell CB −4.5,
   promote academy −1.5), `projected = clamp(current + Σδ)`, `breach = projected > 0.85`. Live pieces,
   all driven off `projected`:
   - reused `ScrGauge` (re-sweeps, red past limit);
   - `ScrComparisonBars` — hand-rolled animated Current-vs-Projected bars sharing a 0–100% track with
     an 85% dashed cap marker + red over-limit wash; projected bar flips red on breach;
   - `ScrTrendChart` — **recharts** `AreaChart` of SCR Jun→deadline with a dashed red 85% `ReferenceLine`
     and a live `ReferenceDot` at the projected point (red on breach), fully restyled for charcoal
     (violet-tip gradient, mono ticks, `ease-out`, `isAnimationActive` gated on reduced-motion);
   - header status pill `AnimatePresence`-flips Compliant ↔ "Breach — over 85%", panel border/shadow
     animate red on breach. Move rail is a 3-col toggle grid below.
3. **AI Analyst chat** (`components/ai-analyst/AiAnalystChat.tsx`, `#ai-analyst`, white band for
   rhythm). On scroll-in a scripted exchange plays via a small phase machine (idle→ask→think→answer→
   resolved): the Sporting Director's question types out (`lib/useTypewriter.ts`, steady cps, blinking
   caret), a thinking-dots indicator, then the analyst's answer types out, then a **deterministic
   calculation card** resolves (GK renewal +£4.2M/yr → +2.0 pts → 80% → 5 pts headroom ≈ one £60M
   5-yr signing). "RAG-grounded · Deterministic" badge + inert composer sell the affordance. Reduced
   motion renders the whole exchange at rest.

Verified: `apps/landing-page` tsc clean; dev server compiles `/` 200 (2569 modules, no errors). CDP
screenshots confirm: Command Center default (84%, Compliant, recharts trajectory climbing to the cap
line), breach state (click "Renew the goalkeeper" → 86%, gauge/bars/dot/pill/border all red), AI chat
full exchange completes, and AI chat under `prefers-reduced-motion: reduce` renders at rest. Old
`components/ScenarioDemo.tsx` deleted; `app/page.tsx` order is hero → rule → capabilities → command
center → AI analyst → platform → footer. Production `next build` not re-run this round (user skipped);
not yet committed.

### Landing high-fidelity polish round (2026-06-09) — fonts, consequences, interactivity

A large multi-item batch to push the landing toward a "£100M enterprise SaaS" feel.

1. **Editorial serif type.** Replaced the Inter + Space Grotesk pairing (the cliché AI combo) with
   **Fraunces** (display serif, weights 400/500/600, normal+italic) over **Inter** body. `font-display`
   token now maps to Fraunces; all display headings relaxed from `tracking-tight` to `tracking-[-0.01em]`
   (serifs don't want negative tracking). Reads expensive/institutional.
2. **Navbar scrolled colour.** The frosted-white bar became a **deep-violet frosted glass**
   (`rgba(26,17,48,0.74)` + violet border + blur/saturate + shadow); bar stays dark in both states so the
   white lockup and light links read throughout (dropped the light/dark cross-fade). 
3. **Pulsing CTA.** `RequestAccessButton` gained a `pulse` prop: a breathing scale + an expanding violet
   stroke ring + a soft glow (all reduced-motion gated). Enabled on the hero and navbar CTAs.
4. **Brand AI icon.** Ported the product app's `SparkIcon` (open compliance-gauge arc + centred spark)
   to `components/icons/SparkIcon.tsx`; replaced lucide `Sparkles` in the AI chat (avatar + chrome),
   `capabilities.ts` and `features.ts`. Shared `IconType` widened so lucide + SparkIcon both satisfy it.
5. **Gradient / glow text.** New globals utilities: `.text-gradient-violet`, `.text-gradient-hero`
   (white→violet + drop-shadow glow), `.text-shimmer` (animated sweep, reduced-motion safe). Applied to
   the hero headline (gradient + shimmer) and accent phrases ("Squad Cost Ratio", "one place").
6. **85% limit emphasis** on `ScrGauge`: brighter/thicker limit tick, a pulsing halo marker on the arc at
   the limit point, and a bold "85% / THE LIMIT" label — the cap is now the loudest mark on the dial.
7. **110% + sporting consequences** (the headline ask). Added aggressive moves (£180M galáctico +14,
   deadline-day spree +10) so stacking reaches 110%, plus a **"Show a points deduction"** preset (and
   Reset). New `ConsequencesPanel` opens on breach and climbs a 3-rung ladder (registration restrictions
   → formal breach → automatic deduction); past ~105% a `−N pts` badge appears (−6 at 105%, −10 at 110%)
   and a new `LeagueTable` **physically re-sorts** the club out of the top four via framer `layout`
   (illustrative clubs; 4th → 8th at −10). `ScrTrendChart` Y-domain now auto-scales to keep a 110% spike +
   cap line in frame.
8. **Carousel visuals.** Added perspective + 3D `rotateY` tilt and `blur` on non-focal cards, violet glow
   + icon glow on the active card (`CapabilityCard` now motion-driven), soft left/right edge fades, and a
   CSS autoplay **progress bar** (`@keyframes carousel-progress`) that restarts per slide and freezes on
   hover/focus/drag/reduced-motion.
9. **PlatformFeatures interactivity.** Per-card violet top-accent on hover (no grid shift) + icon pop; two
   live cards — a **ticking transfer-deadline countdown** (client-only, 1s tick) and a **cycling
   notifications feed** (AnimatePresence). 
10. **Championship / 44 clubs.** First feature now "Every Premier League & Championship club" / "All 44 …
    pre-loaded", with a clarifying comment (44 = 20 PL + 24 Championship).
11. **Em dashes removed** from all user-facing copy (rewritten compacter) and from SEO/OG titles
    (`—` → `·`); only code comments retain them.

Verified: `apps/landing-page` tsc clean; dev compiles `/` 200 (2581 modules, no console errors). CDP
screenshots confirm: serif hero with gradient headline + emphasized 85% limit; deep-violet scrolled
navbar; carousel 3D blur/tilt + edge fades + progress bar; Command Center default (84%, compliant) and
the **110% consequences** (−10 pts badge, escalation ladder, league table dropping the club to 8th / out
of the top four); AI chat with SparkIcon + compacted copy; live deadline countdown + notifications feed
in the platform grid. Production `next build` not re-run; not yet committed.

### Cinematic / "royal" pass (2026-06-09) — atmosphere, smooth scroll, footer, interactions

Goal: make the landing feel like one continuous, expensive experience (Stripe/Linear-grade), not a
stack of sections. **New deps:** `lenis` (smooth scroll), `react-parallax-tilt` (3D tilt).

- **Atmosphere primitives** (`components/atmosphere/`): `Aurora` (3 blurred, screen-blended violet blobs
  drifting on long offset CSS loops — globals `.aurora-blob` + `aurora-a/b/c`), `Grain` (tiled SVG
  fractal-noise overlay, `mix-blend: overlay`), `Spotlight` (cursor-following violet radial glow,
  attaches to its `relative` parent, off under reduced-motion/touch). Applied to the hero and command
  center bands (content bumped to `relative z-10`) and the new footer.
- **Smooth scroll** (`components/SmoothScroll.tsx`, mounted in `providers.tsx`): Lenis with an ease-out
  cubic, one rAF loop, anchor-link interception (`lenis.scrollTo`, −72 offset). Never initialises under
  reduced-motion. Lenis CSS added to globals.
- **Cinematic reveals**: `Reveal` now adds a `blur(8px)→0` to its fade-up (kept reduced-motion-independent
  so it doesn't mismatch on hydration).
- **Tactile surfaces**: `TiltCard` (react-parallax-tilt, small angles, slow transition, faint white
  glare, reduced-motion off) wraps the hero gauge panel and the **active** capability card. The hero +
  footer CTAs are **magnetic** (lean toward the cursor via spring-smoothed motion values).
- **Hero microcopy** "Maximize your squad. Protect your points." restyled from flat grey into an editorial
  lockup: a vertical gradient rule + Fraunces italic + a violet-gradient "Protect your points."
- **Navbar CTA** now `gradientShift` — a violet gradient that drifts hue over a ~6s loop
  (`.cta-gradient-shift` + `cta-gradient` keyframes, static under reduced-motion) — plus magnetic.
- **Footer redesign** (royal close): charcoal band with Aurora + Grain, a giant ghost "85" watermark, a
  final "Win the transfer window. / Within the rules." headline (gradient) + Request Access CTA, a
  violet gradient hairline, four columns (brand / Explore / Legal / Contact with icon chips) and a
  back-to-top.

**Hydration hardening** (all surfaced via a CDP console capture, incl. a `prefers-reduced-motion` pass —
the dev overlay's "1 error" badge):
  1. `ScrGauge` polar coords rounded to 2dp — `Math.cos/sin` aren't bit-identical Node vs V8, so the raw
     floats mismatched on the static limit-mark SVG.
  2. `ScrGauge` halo + `RequestAccessButton` wrapper + `Reveal` blur: never branch **rendered structure or
     SSR initial style** on `useReducedMotion` (it resolves false on server / true on client-first-render).
     Structure/initial now depend only on props; `reduce` is consulted only in `animate`/event handlers.
  3. `CapabilityCard` animated `borderColor` switched from `hsl(var(--…))` (framer can't interpolate a CSS
     var) to literal rgba.

Verified: `apps/landing-page` tsc clean; **production `next build` clean** (10 routes, home First Load
278 kB); CDP console **clean in both normal and reduced-motion** (walked + interacted); screenshots
confirm the aurora hero, gradient nav CTA, restyled microcopy, command center + 110% consequences, and
the redesigned royal footer — no dev-overlay errors. Not yet committed.

### Mobile audit + floating-island navbar (2026-06-10)

- **Mobile responsiveness verified** (CDP at 360/390px): every section already stacks to a single
  column, the hamburger → full-screen sheet works, gauge/recharts scale fluidly, and there is **no
  horizontal overflow** (`scrollWidth === clientWidth`; the only elements exceeding the viewport are the
  aurora blobs, carousel track and tilt glare, all inside `overflow-hidden`). One fix: the breach league
  table's "out of the top four" tag is now `hidden sm:inline` so the row doesn't truncate on phones.
- **Navbar redesign** — from a flat full-width bar to a **floating frosted-glass island**: a rounded
  `max-w-content` pill hung below the top edge (`px-4 pt-3`), violet border, top-edge sheen highlight,
  inset + drop shadow, `blur(8px)` over the hero firming to `blur(16px) saturate` deep-violet glass when
  scrolled. Links gained an animated violet underline (origin-left scaleX on hover); height trimmed to
  h-14; markup is now `<header>` wrapping `<motion.nav>`.

Verified: tsc clean; CDP console clean in normal + reduced-motion; screenshots confirm the island over
the hero, scrolled, and on mobile. Not yet committed.

### Section-aware navbar theme — logo + glass switch on background (2026-06-10)

- **The ask**: make the top-bar logo switch colour with the background it floats over — the violet-cored
  mark on the light bands, the white-cored mark on the purple/charcoal bands (matching the two brand
  exports `85Percent-mark-1200.png` / `-violet-1200.png`).
- **Mechanism**: each section root now declares `data-nav-theme="dark" | "light"` (Hero/CommandCenter/
  Footer = dark; ProblemSolution/Capabilities/AiAnalyst/PlatformFeatures = light). The Navbar runs a
  rAF-throttled scroll/resize `measure()` that finds whichever `[data-nav-theme]` element crosses a line
  ~52px from the top (the bar's vertical centre) and sets a `theme` state from it.
- **What switches**: the whole island adapts so the mark stays legible — bar background (deep-violet
  glass ⇄ bright white glass), border (violet-200/30 ⇄ violet-700/18), top-edge sheen (white ⇄ violet),
  desktop link colour (white/70 ⇄ slate/65), and the mobile trigger. The "85" mark itself **cross-fades**
  between its `tone="white"` and `tone="violet"` forms via `AnimatePresence` keyed on `theme`
  (`mode="popLayout"`, both lockups equal width so no layout shift). The CTA keeps its drifting gradient.
- **Hydration-safe**: `theme` initialises from the same `forceSolid` prop on server + client
  (`forceSolid ? 'light' : 'dark'`), so the first paint matches; `AnimatePresence initial={false}`.
  `forceSolid` (legal pages, which sit on the light band) now also maps to the **light** theme — fixing
  the prior white-logo-on-white-page contrast there.

Verified: tsc + **production `next build` clean** (10 routes, home First Load 279 kB); CDP console
**clean** scrolling the full page (no hydration warnings). The theme switch confirmed at every section by
DOM probe — navBg + link colour flip correctly hero→the-rule→capabilities→command-center→ai-analyst→
platform (dark/light/light/dark/light/light). Note: clipped headless screenshots over scrolled sections
white-out (a `--disable-gpu` backdrop-filter/Lenis compositing quirk, not a real bug) — verified via DOM
inspection instead. Not yet committed.

### SCR points-deduction threshold → 115% + mandatory name field (2026-06-10)

- **Rules fix**: the automatic points deduction is supposed to trigger at **115%**, not 105%. Retuned the
  Command Center: deduction is now `projected >= 1.20 ? 10 : projected >= 1.15 ? 6 : 0`, the
  ConsequencesPanel ladder reads 85% (restrictions) → 100% (formal breach) → **115% (automatic
  deduction)**, and the empty-state/comment copy now says "past 115%". Retuned the moves so the scenario
  can actually reach it (galáctico 0.14→0.18, spree 0.10→0.14, gk 0.02→0.04) and the "Show a points
  deduction" preset is now the three signings (striker+galáctico+spree). Verified interactively:
  default = 84% compliant (no deduction); preset = **116% → −6 pts**; preset + goalkeeper renewal =
  **120% → −10 pts** (the ceiling). Trend-chart frame comment updated to ~120%.
- **Form**: "Full name" is now **mandatory like work email** — `required` on the dialog field (renders
  the `*` + HTML constraint) and the shared zod schema tightened from optional to
  `z.string().trim().min(1, 'Enter your full name').max(120)`. `toRow` still maps cleanly.

Verified: tsc + **production `next build` clean**; CDP console **clean** on CTA click (no runtime error);
SCR thresholds confirmed by interactive DOM probe (84%/116%/120% → none/−6/−10). The lead dialog won't
open under headless automation here (Lenis/portal interaction quirk, console stays clean) so the
`required` field was confirmed from source + build rather than a live screenshot. Not yet committed.

### Cinematic GSAP hero entrance — pitch → chrome pass → morph → dashboard (2026-06-10)

- Rebuilt `components/Hero.tsx` as a single **GSAP-orchestrated** entrance (added `gsap@3.15`
  + `MotionPathPlugin`; +36 kB First Load, now 315 kB). Sequence: (1) **the pitch** — top-down
  pitch geometry etched in by a clinical icy light **sweep**, chrome strokes drawing on under
  `power3/power4` ease; (2) **the pass** — a chrome football (`<g class="he-ball">`, radial-gradient
  sphere + specular) runs a tactical **MotionPath** across the pitch, drawing a fading violet/ice
  specular **trail**; (3) **the morph** — it reaches target, a white **flash** fires, the pitch
  contracts + dissolves and the glassmorphism **dashboard** assembles (gauge count-up to **81%** under
  the 85% cap, FFP €42.8M, wage/turnover 68% vs 70% cap, net-spend sparkline draw-on, per-panel
  specular sweep); (4) **the reveal** — headline opens with a vertical **clip-path slice + seam flash
  + metallic sheen**, then kicker/sub/CTA fade up. Strictly `power4.inOut`/`expo.out` — no linear, no
  bounce. Cold/charcoal with violet (#6D28D9) only as a laser accent. A **Replay** control restarts
  the timeline; `prefers-reduced-motion` jumps straight to the end state.
- Styles live in `app/globals.css` scoped under `.hero-entrance` with short `he-` class names; the
  section keeps `data-nav-theme="dark"` so the Navbar theme detection still reads it. Reuses the real
  `RequestAccessButton` (lead dialog) — no duplicate nav.
- **Two bugs found and fixed while driving it in-browser (CDP, real delays):** (a) the pitch/ball/trail
  overlay sat **outside** the `ref={root}` element, so `gsap.utils.selector` never found them — the
  pitch rendered statically and never faded; moved the GSAP root + `hero-entrance` var scope to the
  `<section>`. (b) `MotionPathPlugin` reads a string `path:` as a **CSS selector**, so passing raw SVG
  path data threw `querySelectorAll('M 70 330…')` every tick and halted the timeline — now passes the
  `.he-trail` **element** (same SVG coord space as the ball) for `path`/`align`.
- Verified: tsc clean; **production `next build` clean**; CDP capture across the timeline shows the
  full sequence; DOM probe confirms end state (`pitchOpacity:0`, panels `1`, gauge `81`); **console
  clean** throughout. Headless one-shot `--screenshot`+`--virtual-time-budget` proved unreliable (grabs
  the frame before dev's JS-injected CSS applies, and `next start` 500s on assets while the dev server
  shares `.next`) — CDP with real delays against the dev server is the reliable path. Not yet committed.

### Hero entrance — restored original copy/data, 3D morph, glyph + replay cleanup (2026-06-10)

Iteration on the cinematic hero per feedback:
- **Restored the original first-slide copy + glowing gradient title.** Eyebrow back to the
  "The Squad Cost Engine" pill; H1 back to "The definitive financial compliance platform for elite
  football clubs." with `text-gradient-hero text-shimmer` (the white→violet glow + slow light sweep);
  sub back to "Win the transfer window. Within the rules." The two-line slice/seam/sheen headline was
  dropped (its CSS pruned).
- **Corrected the dashboard data** to the real SCR story (was generic/wrong): gauge **81%** under the
  85% cap with **+4 pts headroom / Within the rules**, **Wages 62%** + **Amortisation 19%** (= the 81%
  SCR), and an **SCR · this window** trajectory sparkline. Dropped the invented FFP €42.8M and the
  wage/turnover-70% panel.
- **Fixed the gauge number position** — `.he-gnum` was `align-items: baseline`, floating "81%" to the
  top of the ring; now `center`.
- **Removed glyph symbols** the brief flagged: the em dash in the sub copy, and the ▾/▴ triangles
  (replaced the "live" triangle with a dot pill).
- **Removed the Replay control** (button + `replay()` + its timeline reveal + CSS).
- **3D morph transition** (the "evolve into the dashboard" ask): the pitch now **folds away in 3D**
  (`rotationY 42 / rotationX -8 / z -320`) instead of a flat fade, and the dashboard **unfolds from
  depth** — the rack swings level (`rotationY -16 → 0`) while each panel rotates in from a tilted,
  receded stack (`z -300, rotationY -34, rotationX 16`, staggered, `power4.out`) under a shared
  `perspective: 1600px` + `transform-style: preserve-3d`.
- Verified: tsc clean; **production `next build` clean** (First Load 314 kB); CDP capture shows the full
  sequence incl. the mid-morph 3D unfold; DOM probe confirms end state (`pitchOpacity:0`, panels `1`,
  gauge `81`); **console clean**. (`next build` 500s on a missing chunk only when the dev server is
  racing the same `.next` — build clean once dev is stopped.) Not yet committed.

### Hero entrance — 6-point polish pass (2026-06-10)

Feedback round on the cinematic hero:
1. **Full-bleed checkered grid.** The `.he-bg-grid` / `.he-bg-glow` layers were inside the centred
   `max-w-content` column, so the grid only showed mid-screen. Moved them to **section-level**
   `absolute inset-0` (full width) and widened the radial mask (`150% 130% at 50% 38%`) so the grid
   spans the whole purple band. Verified by DOM probe: gridW == sectionW (1440).
2. **85% cap focus.** Added a bright **cap tick** on the gauge ring at the 0.85 mark (computed in the
   ring's pre-rotation coords), retitled the panel "Holding under the **85% cap**", added a **CAP 85%**
   chip beside "Within the rules", and a **85% cap** label on the SCR sparkline's dashed cap line.
3. **Replaced the ugly light-sweep.** The flat vertical light bar that crossed the pitch is gone.
   The pitch now **ignites from the centre spot** (`.he-ignite` cold violet/white bloom) and the chrome
   strokes crystallise outward (`stagger from:'center'`).
4. **Shiny pitch + unpredictable 3D ball.** Added specular **sparkle glints** (`.he-glint`, radial-grad
   circles) that flick on across the markings and settle to a shimmer; brightened the chrome stroke
   glow. New **erratic** ball route (several sharp reversals, no smooth arc). At the end the ball
   **rushes the camera** — scales to 12× with motion blur + white bloom (`power3.in`), reading as it
   leaves the screen, then the flash + 3D pitch-fold hands off to the dashboard.
5. **Fixed the text-over-pitch flash.** The H1 was only clipped by GSAP (post-hydration), so it flashed
   fully-formed over the pitch for ~seconds pre-JS. Now clipped in **CSS** (`clip-path: inset(0 100% 0 0)`)
   from first paint; reduced-motion shows it immediately.
6. **3D tilt on the dashboard panels.** Wrapped all four panels in **`TiltCard`** (the same
   react-parallax-tilt primitive the capabilities carousel uses) — interactive parallax tilt + glare on
   pointer, disabled under reduced motion. Grid spans moved to the TiltCard wrapper (`.he-cell-full`).

Verified: tsc clean; **production `next build` clean**; CDP captures show the ignite bloom, erratic
pass, ball camera-rush (scale>3 detected mid-flight) and the settled dashboard; DOM probes confirm
full-bleed grid + end state (`pitchOpacity:0`, panels `1`, gauge `81`); **console clean** throughout;
high-res crop confirms the gauge cap tick + CAP 85% chip. Not yet committed.

---

## Hero animation — 3D pitch, patterned ball, richer morph + hover-3D cap card (2026-06-10)

Second polish pass on the cinematic hero (`components/Hero.tsx`, `app/globals.css`) plus a 3D
hover on the marketing cap card. Six asks, all verified via deterministic GSAP-timeline seeking
over CDP (`window.__tl.time(t)` — a temporary hook, since removed).

1. **Visibly 3D pitch.** Raked the tactical board hard — `.he-pitch-tilt` now sits at
   `rotateX(52deg)` (GSAP-owned via `gsap.set(... transformPerspective:1600, rotationX:52)`), with a
   blurred floor sheen (`::after`) grounding it in depth. Added **mowing stripes** (`.he-stripes`,
   8 alternating cold bands) under the markings, plus **corner arcs** and **goals** for a richer field.
2. **Shining tactical player markers.** Replaced the generic field glints with a **4-3-3-a-side
   coaching formation** (`FORMATION`, 14 chrome/violet discs). Each disc catches a crisp **4-point
   star sparkle** (`starPath`) that **twinkles forever** (standalone `gsap.fromTo … repeat:-1 yoyo`,
   random stagger). Reduced motion pins them to a static lit state.
3. **Ball — slower, bigger, real soccer pattern.** MotionPath duration `1.5→1.75s` (~17% slower).
   `R_BALL 11→13`, pattern scaled with it (`F`). Built a **Telstar pattern** in local space
   (central + 5 rim pentagons via `pentPts`, seams), clipped to the ball, on a chrome sphere
   gradient with a specular highlight; the pattern **spins** as it rolls. The rush now **swells crisp**
   to 7.5× (pattern reads big, coming at you) **then whites out** to 19× with motion blur — split so
   the soccer ball is legible before the bloom. **Clip fix:** the pattern was detaching/floating above
   the ball — caused by `transform-box: fill-box` offsetting GSAP's SVG matrix + the clip riding the
   spun element. Fixed by a **static clip wrapper around the spinning inner group** and dropping
   `fill-box`.
4. **Richer morph (not just a flash).** On impact: specular **flash** + **14 raking light shards**
   (`.he-shard b` scaleX burst, random stagger) + an **expanding shockwave ring** (`.he-ring`), the
   **camera lifts** (`rotationX 52→14`) so the ball strikes head-on, the pitch **folds away in 3D**,
   and a **violet scan** (`.he-dash-scan`) rakes down the dashboard as it unfolds. Route re-ended at
   pitch centre so the rush aligns with the centre burst.
5. **Dashboard 3D at rest.** The rack settles to a **resting rake** (`rotationY:-10, rotationX:3`)
   instead of flat — visibly 3D at a slight angle even before hover; `TiltCard` still adds interactive
   parallax on pointer.
6. **Cap-definition card hover-3D.** Wrapped the marketing **85% cap** stat band
   (`components/ProblemSolution.tsx`) in **`TiltCard max={8}`** + a deepening hover shadow — the same
   carousel parallax/glare, now on the light band.

Verified: tsc clean (ESLint not configured in this app — interactive setup prompt, skipped); CDP
timeline-seek captures confirm the raked 3D board + twinkling formation, the legible spinning soccer
ball at the swell, the shard/ring/flash burst, the 3D fold, and the settled dashboard at a resting
rake; hover capture confirms the cap card tilts with glare; **no exceptions/console errors** in any
run. Not yet committed.

---

## Hero animation — six follow-up fixes (2026-06-10)

1. **Post-animation jank/jumping fixed.** Root cause: after the morph the pitch overlay
   stayed in the DOM — a `transform-style:preserve-3d` + `mix-blend-mode:screen` + drop-shadow
   layer with an **infinite star twinkle** (`repeat:-1`) repainting forever and janking scroll.
   Fix: kept the twinkle tween in a ref and, at `t=5.2` on the timeline, **kill it and set
   `.he-pitch-layer { display:none }`** — the whole overlay leaves the compositor once it's
   off-screen. Probe confirms `pitchLayerDisplay:"none"` at end state.
2. **Stars now sit inside the player circles.** Redesigned markers: the disc is a **glowing
   player ring** (translucent fill + bright team-coloured stroke, r 5.4) with a **smaller
   sparkling star inside** (s 3.1, white/violet, double drop-shadow glow) that twinkles.
3. **Pitch more visibly 3D.** Raised the rake `52°→58°` and shortened the perspective
   `1600→1080px` (`PITCH_TILT`/`PITCH_PERSP`), so the near edge is markedly wider than the far —
   a much stronger tactical-table depth.
4. **Ball now rides the trajectory.** It was momentarily parked at the SVG origin (top-left)
   before the MotionPath kicked in. Added `gsap.set('.he-ball',{x:60,y:60→360})` to the path
   start so it appears **on the line**; zoom-crop confirms the ball tracks the trail centreline.
5. **Nav anchor landing fixed.** The real control was **Lenis** `scrollTo(target,{offset:-72})`
   in `SmoothScroll.tsx` (overrides CSS scroll-margin for motion users) — combined with the
   sections' 112px top padding it left the heading mid-screen. Changed the offset to **`+28`**
   (scrolls just past the empty padding) and set the three sections' `scroll-mt` to **`-1.75rem`**
   for the reduced-motion/native path. Clicking The Rule / Capabilities / Platform now lands each
   **heading at y≈96px**, just under the navbar (was ~184px).
6. **Cap panel.** Removed the **"Cap 85%" chip** (only the "Within the rules" pill remains) and
   lengthened the line to *"Projected to settle at 81% on deadline day, with +4 full points of
   headroom still in hand."*

Verified: tsc clean; deterministic timeline-seek captures confirm the steeper 3D board, the
star-in-circle markers, the patterned ball on the trail line; end-state probe confirms the pitch
layer is dropped from the compositor and the chip is gone; click-through measures all three nav
headings landing at the top. Not yet committed.

---

## Hero animation — four more fixes (2026-06-10)

1. **Nav heading no longer hidden under the top bar.** Lowered the landing further:
   Lenis `scrollTo` offset `28→8` in `SmoothScroll.tsx` and sections' `scroll-mt` to
   `-0.5rem`. The three nav headings now land at **y≈136px** (was 96, originally ~184) —
   comfortably clear of the floating navbar.
2. **Ball now rides the trajectory line.** Two compounding bugs: (a) `align: trailEl`
   makes the path *relative* to the ball's pre-set position (floated it ~60px off), and
   (b) `alignOrigin:[0.5,0.5]` registers the ball by its **bounding-box centre**, which
   shifts every frame as the asymmetric pattern *spins*. Removed **both** — all ball
   geometry is centred at local (0,0), so default origin registration lands its true
   centre on the path. Seek crops confirm the ball sits at the tip of the drawn trail.
3. **Stars distributed evenly (were bunched top-left).** Same class of SVG bug as the
   ball pattern: discs/stars drawn at absolute (x,y) with GSAP `scale` were scaling about
   the **SVG origin (0,0 = top-left)**, dragging the twinkling stars toward the corner.
   Fix: wrap each marker in `<g transform="translate(x y)">` with children at local (0,0),
   and drop the `transform-box`/`transformOrigin` overrides — scale now happens about each
   star's own centre. Confirmed evenly spread across both halves.
4. **Post-morph stutter reduced.** The infinite star twinkle (3D + mix-blend + drop-shadow,
   repainting forever) is now **killed at the morph start (t=3.9)** instead of lingering;
   the whole `.he-pitch-layer` is dropped from the compositor at **t=5.05** (right as the
   fold ends); and the costly **`filter: blur()` was removed from the glass-panel unfold**
   (animating a filter on backdrop-filtered panels thrashes the compositor). End-state probe
   confirms `pitchDisplay:"none"`, no exceptions.

Verified: tsc clean; deterministic seek crops confirm ball-on-line and evenly-spread
star-in-circle markers; click-through measures all three nav headings at y≈136; settled
end-state probe clean. Not yet committed.

---

## Hero — stars moved outside the player circles (2026-06-10)

Reversed the earlier "star inside the circle" treatment per request. The player markers
are now plain glowing circles, and a **separate field of shining white stars** (`STAR_FIELD`,
23 points on a staggered grid) is spread **evenly across the whole pitch**, outside the
circles. Each star uses the translated-group + local-(0,0) pattern so GSAP scales it about
its own centre (no SVG-origin drift); they fade up with the formation and twinkle on a yoyo
loop that's killed at the morph. `.he-marker-star` CSS replaced by `.he-star`. tsc clean;
seek capture confirms even, shining distribution. Not yet committed.

---

## Legal section — deep-slate (legal) route group + full pre-incorporation copy (2026-06-10)

Replaced the three placeholder legal stubs with a finished **`app/(legal)` route group**
of four pages, all carrying real institutional copy positioned for 85Percent's
**pre-incorporation** status (no Ltd/LLC/Inc; framed as a "project" by "the creators of
85Percent"; website terms, not a SaaS contract):

- **`/terms` — Website Terms of Use** (not "Terms of Service"): acceptance by browsing, IP
  over the name/marks/UI, acceptable use (anti-scraping + form abuse), "as is" limitation
  of liability, governing law (England & Wales).
- **`/privacy` — Privacy Policy**: UK/EU GDPR lead-gen notice — what the access-request form
  collects (name, work email, club, role, message), legitimate-interest basis, never sold,
  storage/security, full data-subject rights incl. deletion on request.
- **`/disclaimer` — SCR Compliance Disclaimer** (replaces the old `/ssr-disclaimer`): not
  regulatory advice (decision-support, not a governing body/auditor), accuracy-of-inputs
  (deterministic math, GIGO), legacy/PSR disclaimer, assumption of risk (clubs solely own
  UEFA/PL submissions; zero liability for sanctions, points deductions, levies).
- **`/cookies` — Cookie Policy**: PECR/GDPR — essential cookies (routing/security) + basic
  privacy-respecting analytics; documents current "essential-only" status forward-compatibly.

Design: installed **`@tailwindcss/typography`** and registered it in `tailwind.config.ts`;
reworked the shared **`LegalPage`** shell into a **deep-slate band** (`bg-charcoal`, same
aurora/grain as the hero) rendering body copy as **`prose prose-invert`** tuned to brand
(display headings, violet links, constrained measure, last-updated date + optional eyebrow/
summary). Made the **Navbar dark** on legal pages (`forceSolid` now initialises theme `dark`)
so navbar → page → footer form one continuous dark surface. `site.legal` updated to the four
routes (footer Legal column + `sitemap.ts` both derive from it automatically); old flat
`app/terms|privacy|ssr-disclaimer` routes removed.

Verified: tsc clean; `next build` prerenders all four routes; CDP screenshots of `/terms`
and `/disclaimer` confirm slate bg `rgb(14,16,27)`, violet links, correct titles, cohesive
dark navbar+footer, no console exceptions. Not yet committed.

## Hero intro: kill finished-state flash + play-once-per-tab (2026-06-11)

Two bugs on the cinematic GSAP hero (`apps/landing-page/components/Hero.tsx`):

1. **Finished-state flash on entry.** The `.he-pitch-layer` had no initial hidden
   state, so the server-rendered / pre-hydration paint showed the fully-drawn pitch
   before GSAP took over. Fix: CSS now keeps the layer at `opacity:0` and reveals it
   only under `.hero-entrance.he-ready` (globals.css). The effect adds `he-ready`
   after building the timeline (so GSAP's initial states are already applied), and the
   effect is now an isomorphic `useLayoutEffect` so the from-states + reveal commit
   before paint. (Dashboard panels / kicker / sub / actions / h1 were already CSS-hidden.)

2. **Intro replay semantics** (clarified by user): a browser reload / re-entering the
   tab must play the intro EVERY time; an in-app logo click back to the top must NOT.
   The landing logo is `<a href="#top">` intercepted by Lenis (scroll only, no remount),
   so the right scope is per-document, not per-tab. Fix: a module-level `introHasPlayed`
   flag — it resets on every full document load (reload / new tab → plays) but persists
   across in-app soft remounts in the same JS context (logo click → `tl.progress(1)`,
   no replay). The flag is set on a deferred `setTimeout(0)` whose cleanup cancels it, so
   React StrictMode's throwaway first mount (dev) can't set it before the surviving mount
   plays — without this the intro would not animate at all in dev. (An earlier attempt
   used `sessionStorage`, which wrongly suppressed reloads and got stuck → "not playing at
   all"; replaced.) Reduced-motion still skips via the same path.

Verified (CDP headless, dev/StrictMode): fresh load @180ms → pitch `opacity:0`, panels
`opacity:0`, h1 clipped (no finished flash); @1.4s → PLAYING (pitch grid, panels 0);
@7.4s → RESOLVED. **Reload @1.4s → PLAYING again** (replays as required); @7.4s → RESOLVED.
tsc clean, no console exceptions. Not committed.

## Admin panel migrated to Next.js + new "Inbound Leads" dashboard (2026-06-11)

Migrated `apps/admin` from the Fastify server-rendered control panel to a **Next.js 14
App Router** app (Tailwind + lucide-react + a hand-rolled shadcn-style UI layer), and
added the requested Leads / Demo Requests dashboard. Still a standalone app on its own
port (4000) and own session auth, intended for a separate domain.

**Stack / structure**
- `app/` (App Router): `login/`, protected `(dashboard)/` group (`leads`, `users`,
  `users/[id]`, `jobs`, `jobs/[id]`), root `page.tsx` redirects → `/leads`.
- Server Actions replace the old Fastify POST routes: `app/actions/{auth,users,jobs,leads}.ts`.
- Server-only libs in `lib/`: `env` (lazy getters, no NEXT_PUBLIC), `supabase` (lazy
  service-role client), `session` (HMAC-signed httpOnly cookie via node:crypto;
  `requireSession()` guards the dashboard layout), `format`, `jobs` (ported verbatim,
  still spawns the api scripts), `users`, `leads.server` (DB) + `leads` (client-safe
  constants/types — split because the client sheet imports `LEAD_STATUSES`).
- UI: `components/ui/{button,card,badge,table,input,select,sheet,dropdown}` + `cn()`
  (clsx + tailwind-merge). Cold monochrome shadcn token layer in `globals.css`
  (white/slate, hairline `border-border`, brand violet #6D28D9 as the only accent).
- Feature pieces: `metric-card`, `top-nav` (active link), `flash` (?flash=&msg= banner),
  `confirm-submit`, and `leads/{leads-table,lead-sheet,status-badge}`.

**Leads dashboard** — real schema (`demo_requests` already fed by the landing form):
columns are `full_name`/`work_email`/`club`/`role`/`message`/`source`/`status` (the
task's `name`/`email` assumption was wrong; `leads.server.ts` maps DB→display). Header +
3 metric cards (Total / New in violet / Demos Scheduled), dense data table (Date · Name
w/ avatar+email · Club · Role · Status pill · Actions kebab). Long CFO messages stay out
of the table — a right-hand slide-out **Sheet** (portal, Esc/click-outside/scroll-lock)
shows full details + the message, with a status `<select>` that writes via the
`updateLeadStatus` server action (optimistic + rollback, `revalidatePath` + router.refresh).
Status tones: New=violet, Contacted=blue, Demo Scheduled=green, Archived=grey. Seeded 5
sample `@example.com` leads so it's demonstrable (archive/delete anytime).

**Verified** — `tsc` clean; `next build` compiles all 8 routes. Drove it headless against
`next start` (prod): login form → `/leads`; metrics [5,2,1]; headers Date/Name/Club/Role/
Status/Actions; 5 rows; row click opens the sheet (full message shown); status change →
Supabase write + "Saved". Zero console exceptions in production. (A `__webpack_require__.n`
error appears only on the dev server's cross-route-group server-action redirect — a known
Next dev-only quirk; absent in the production build, which is the deployed artifact.)

Old Fastify `src/` + `dist/` removed. turbo.json already captured `.next/**`. Not committed.

---

## Session — Supabase project migration: Headroom (SG) → 85Percent (EU) (2026-06-11)

All four apps were silently still wired to the **old** Headroom project
`xwvtwczdwdqaxdblyxtr` (aws-1-**ap-southeast-1**), not the new
`deebcfzsgdwnmeoqphgm` (**eu-central-1**, "85Percent"). Caught via the region in
the API's Prisma pooler host. Repointed everything to EU.

**Env repoints** (gitignored, never committed; old values backed up to
`/tmp/env-backup-headroom/`): `apps/web/.env.local` (`VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY`), `apps/admin/.env` (`SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`), `apps/landing-page/.env.local`
(`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_ANON_KEY`), `apps/api/.env`
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL`).
New keys are the `sb_publishable_…` / `sb_secret_…` format.

**Connection gotcha:** the direct host `db.deebcfzsgdwnmeoqphgm.supabase.co` is
**IPv6-only** (AAAA, no A record) → P1001 from this machine. Use the IPv4
**session pooler** instead: `aws-1-eu-central-1.pooler.supabase.com:5432`, user
`postgres.deebcfzsgdwnmeoqphgm` (note: this project is on **aws-1**, not aws-0 —
aws-0 returns "tenant not found"). `DATABASE_URL` now uses that pooler.

**Schema:** EU project was *not* empty — 18 of 20 migrations already applied.
`prisma migrate deploy` applied the last two (`user_ai_balance`,
`demo_requests_lead_capture`). `migrate status` → "Database schema is up to date".
EU already held data (44 templateClubs / 1316 templateRoster / 56 clubs / 5 users /
267 players), so **no seeding** was done (would duplicate templates;
`seed.ts` is a demo-club + auth-user seeder, not the template sync). Per the
"fresh start" decision, **no** user/club/auth data was carried over from Headroom.

**Verified end-to-end against EU:** anon insert into `demo_requests` (landing-form
path, RLS-gated) → OK; service-role read (admin dashboard path) → OK; cleanup
delete → OK. Zero references to the old ref remain outside this log.

**Note for whoever deletes Headroom:** safe to delete the SG project
`xwvtwczdwdqaxdblyxtr` only after confirming EU works in the deployed
environment too (the IPv6 caveat is local-only; prod hosts may reach the direct
host fine, but the pooler URL works everywhere). Minor pre-existing detail: the
`demo_requests.status` DB default is lowercase `new`, while the admin's
`LEAD_STATUSES`/badge map key on `New` — unchanged by this migration, flagged for
later.

---

## Session — Onboarding stale-roster cache bug + app-wide cache audit (2026-06-11)

**Reported bug:** first-time user picks a club in onboarding → server pre-fills the
squad → lands on `/roster` but the roster shows empty/stale; the UI doesn't reflect
the new squad until a hard reload or the 5-minute `staleTime` elapses.

**Root cause:** the web app caches server data in TWO systems —
TanStack Query (`staleTime: 5m`, see `lib/queryClient.ts`) and a Zustand club store
(`stores/club.ts`, holds `financials` + `scenarios`). Every other mutation invalidates
the right keys, but `OnboardingPage.complete()` reset **neither** after
`api.onboarding.complete()`. With a 5m staleTime nothing refetches on its own, and
because onboarding keeps the SAME `clubId` (it re-identifies the existing tenant row,
doesn't create a new one), the bootstrap effects in `ProtectedRoute` / `AppLayout`
(keyed on `clubId` / `financials`) don't re-fire either. So `/roster` served the
pre-onboarding `['roster','active']` cache (often an empty `[]` cached by a prior
Dashboard visit).

**Fix** (`pages/OnboardingPage.tsx`): after a successful complete, before navigating —
`queryClient.removeQueries` for the `['roster']` (covers active/archived/manager),
`['scenarios']` and `['ssr']` prefixes (removeQueries, not invalidate, so /roster shows
a skeleton then the real squad instead of flashing the stale-empty list), and
`useClubStore.setState({ scenarios: [], scenariosLoaded: true })` (a freshly pre-filled
club has no what-if scenarios; clears any carried over from a previous club so the SCR
baseline / Scenarios tab don't reference deleted players, and marks loaded so the TopBar
SCR pill resolves instead of hanging).

**App-wide cache audit (the "check all such cases" ask):** swept every write path —
RosterPage (✓ invalidates roster/archived/manager + refreshes financials store; baselines
derive live from the roster query), financials save in `ClubSetupPage` (✓ updates store
`financials`, Dashboard reads it reactively), ScenariosPage (✓ store is source of truth
with optimistic create/delete/toggle; the `scenarioDetails` query is a one-time seed,
guarded by `!scenariosLoaded`), SSRPage (✓ invalidates its own SSR keys), profile/team
(✓ me/team/invites), sign-out (✓ clears store + `queryClient.clear()`). **Onboarding was
the only broken path.** Known non-cache edge (left as-is): deleting a player that a saved
scenario references leaves a stale action in the store — a server-side referential-integrity
concern, not a UI cache-refresh bug.

**Verified:** `tsc --noEmit` clean; `vite build` succeeds. Live click-through E2E
(login → pick club → confirm roster populates) not run here — it writes a squad into the
new EU prod DB and needs a test login.

---

## Session — Enterprise lead protection + VIP invite auth flow (2026-06-11)

Hardening for an **invite-only / white-glove** production model. Adapted a generic
spec (which named non-existent `apps/main-app` / `apps/admin-panel` / Next `@supabase/ssr`)
onto the real monorepo: web = `apps/web` (Vite SPA, `@supabase/supabase-js`), admin = `apps/admin` (Next).

**Step 1 — Upstash rate limit (landing).** `apps/landing-page/lib/ratelimit.ts` (new): Upstash
`Ratelimit.slidingWindow(3, '1 h')` per IP, `Redis.fromEnv()`, prefix `ratelimit:demo-request`.
`app/api/demo-request/route.ts` now calls `checkRateLimit(clientIp)` (replacing the old in-memory
counter) → 429 `"You've submitted too many requests. Please try again later."`. `DemoRequestDialog.tsx`
now reads the server JSON `error` on non-2xx so the 429 message actually surfaces (it previously
masked everything with a generic string). Deps `@upstash/ratelimit` + `@upstash/redis`. Creds in
`apps/landing-page/.env.local` (gitignored): `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
**Verified live:** 4 POSTs from one IP → `200,200,200,429`; test rows cleaned from EU.

**Step 2 — Close public signup (web).** Public is invite-only. Removed the visible "Create account"
link in `LoginPage.tsx` (and the now-unused `onSwitchToSignUp` prop) — signup form/OTP/`signUp` logic
and the `?invite=` team-invite flow are all preserved (decision: "hide link, keep mode open"). Added
`/register → /login` redirect in `App.tsx`.

**Step 3 — Provision Account (admin Leads CRM).** New server action `provisionLeadAccount(email)` in
`app/actions/leads.ts`: `requireSession()` → `getSupabase().auth.admin.inviteUserByEmail(email,
{ redirectTo: ${env.appUrl}/set-password })`; maps "already registered" to a friendly message. New
`env.appUrl` (`APP_URL`, default `http://localhost:5173`) in `lib/env.ts` + `.env`/`.env.example`.
`lead-sheet.tsx`: a "Provision account" button (own `useTransition`) with inline "Invite sent to …"
/ error feedback (admin has no toast lib — reused the existing inline pattern).

**Step 4 — Set Password page (web).** New `pages/SetPasswordPage.tsx` at `/set-password`: the Supabase
invite link lands here, the default client (`detectSessionInUrl`) exchanges the hash tokens, we wait
for the session (auth-event + getSession, 1.5s timeout → invalid-link state), then
`supabase.auth.updateUser({ password })` → navigate `/`. The API's existing auto-provision
(`apps/api/src/middleware/auth.ts:48`) gives the new auth user a fresh workspace on first call — no
backend change needed. Shared validator extracted to `lib/password.ts` (reused by ResetPasswordPage).

**Verified:** `tsc` + production build clean for all three apps (web/landing/admin); live 429 probe
passed. Not committed. **User-owned Supabase settings still needed:** enable email invites, add
`${APP_URL}/set-password` to allowed redirect URLs, disable public signups.

---

## Session — First-login workspace bootstrap race + production Supabase project drift (2026-08-07)

Two separate regressions, both surfacing as "login is broken". Diagnosed independently.

### Bug 1 — Production login: the web app is built against a DELETED Supabase project

Not a code bug. `app.85percent.pro`'s deployed bundle has
`https://fkyexcddvogkngbbrefz.supabase.co` inlined (Vite bakes `VITE_*` at build
time). That hostname is **NXDOMAIN** — the old production Supabase project no
longer exists. The current production project is `smhzdbyztyavwyuzuumz` (per
`SUPABASE_PROD_*` / `MIGRATION_DATABASE_URL_PROD` in `apps/admin/.env.local`).

Failure mode: `POST /api/auth/login` succeeds (the **API** reaches a live
project — a bogus-credential probe returns a clean 401, not a 500), so the
backend hands back a valid session. The browser then calls
`supabase.auth.setSession()` on a client pointed at the dead host, that call
fails on DNS, and `LoginPage` surfaces the error and never navigates. Creating
the auth user in the Supabase dashboard was never the problem.

Evidence gathered without reading any secret value: live bundle grep, Vercel
`env ls` timestamps (`85percent-web` vars 56d old; on `85percent-admin`,
`SUPABASE_ANON_KEY` 4d old but `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
56d), and DNS resolution of all three project refs.

**`scripts/validate-vercel-env.mjs` was itself pinned to the dead project ref**,
so it would have failed the deploy that fixed this. Rewritten: pure logic
extracted to `scripts/lib/validate-env.mjs`, production default updated to
`smhzdbyztyavwyuzuumz`, `EXPECTED_SUPABASE_PROJECT_REF` override added for
future migrations, stale `ANTHROPIC_API_KEY` → `OPENAI_API_KEY`, and a new
**credential-consistency check**: legacy Supabase keys are JWTs carrying their
project ref, so a key rotated to one project while the URL points at another is
now a build failure instead of a silent auth outage. Opaque `sb_publishable_` /
`sb_secret_` keys carry no ref, so they are skipped rather than guessed at.

### Bug 2 — First login raced its own provisioning (dev AND prod)

`authMiddleware` provisions the `public.users` row (+ starter club, or invite
join) lazily on the first authenticated request. The first page load fires
`/me`, `/club`, `/roster`, `/league-table`, `/chat/sessions`, `/scenarios` in
parallel — **all** before any row exists, so all of them tried to provision.
One won; the rest hit a `users_pkey` unique violation and returned **503**,
which `ProtectedRoute` rendered as "Unable to load this workspace". A refresh
"fixed" it only because the winner had committed by then. Each loser had also
already inserted its own starter club, leaving orphan `clubs` rows.

**Server fix** (`backend/middleware/provision.ts`, new): provisioning is now
idempotent and race-safe behind a store port. A unique violation means a sibling
request already provisioned us, so we re-read and adopt its row; a starter club
created by a losing request is compensated away; 503 is reserved for genuine
database unavailability. An email owned by a *different* account is now 409, not
503. `middleware/auth.ts` is reduced to token validation plus one call.

**Client fix** — the ordering was wrong too, and would still stampede a cold API:
- `lib/workspace.ts` (new) — `useWorkspaceReady()`, one predicate for
  `bootstrapStatus === 'ready' && clubId !== null`.
- Every workspace-scoped hook in `lib/queries.ts` gates on it (`useMeQuery` is
  deliberately ungated — it *is* the bootstrap). A disabled query stays
  `isPending`, so pages keep showing their normal skeleton.
- `AppLayout` holds the routed page behind its own per-route skeleton and does
  not mount `CopilotChat` until the workspace resolves.
- `stores/copilot.ts` tracks `localSessionIds`, so a never-persisted new chat no
  longer fires a `/chat/sessions/:id` request that can only 404.

No sleeps, no retries, no programmatic refresh.

### Tests

- `backend/middleware/provision.test.ts` — 12 cases on an in-memory store that
  enforces the real PK/unique constraints and yields on every operation, so
  concurrent `resolveAppUser` calls interleave deterministically. Covers the
  6-request first-load race (one user, one club, no orphans, zero failures),
  invite join, orphan cleanup, 409-vs-503, and compensating club deletion.
- `scripts/lib/validate-env.test.mjs` — 18 cases: wrong target project, dev
  creds in production, key/URL project mismatch, missing service-role key,
  placeholders, `EXPECTED_SUPABASE_PROJECT_REF` override.
- `apps/web/src/components/auth/ProtectedRoute.test.tsx` — 7 cases asserting the
  ordering at the **network boundary** (stubbed `fetch`, real `api.ts`): no
  workspace-scoped request may fire while `/me`/`/club` are in flight, each
  endpoint requested exactly once, no 5xx, no refresh needed, same on reload,
  and the error screen only after a genuine failure.

Both suites were verified to FAIL against the pre-fix behaviour before being
kept. `apps/web` gained a test runner (vitest + jsdom + @testing-library/react);
admin's test glob now also covers `backend/middleware/` and `scripts/lib/`.

Playwright was **not** added — no browser suite exists in this repo and adding
one was out of scope for this fix.

### Verified

`pnpm typecheck` 9/9 tasks pass. `pnpm build` 6/6 pass (web bundle 2.70 MB
minified, unchanged). `pnpm test`: engine 119, admin 124 (was 94), web 7.

### Still required in production (not done here — no deploy was made)

On Vercel project **85percent-web** → Production: repoint `VITE_SUPABASE_URL`
and `VITE_SUPABASE_ANON_KEY` at `smhzdbyztyavwyuzuumz`, then **redeploy** (Vite
inlines them at build time; an env change alone does nothing). On
**85percent-admin** → Production: confirm `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` all belong to that same
project — the new validator now fails the build if they disagree. Also absent
from admin Production entirely: `QSTASH_TOKEN`,
`QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`,
`FOOTBALL_DATA_API_KEY`, `TRANSFERMARKT_API_URL`, `OPENAI_API_KEY`.

## Session — Production login was still broken: admin backend on a dead Supabase project (2026-08-07)

The previous session's frontend fix (repointing `85percent-web`'s
`VITE_SUPABASE_URL`) shipped, but production login still failed for a
brand-new Supabase Auth user. Root cause was one layer deeper: **login is
proxied through the admin backend**, not done client-side. `LoginPage.tsx`
calls `POST /auth/login`, which runs `supabaseAnon.auth.signInWithPassword()`
server-side (`backend/routes/auth.ts`) — the browser's Supabase client only
receives the resulting tokens via `setSession()` afterward. So the project the
*admin* backend targets is what actually decides whether login works, and the
frontend fix never touched it.

**What was found**, from Vercel build logs alone (no secrets read):

- Every `85percent-admin` Production deploy for 3 days had failed the build
  gate. `admin.85percent.pro` was still serving an Aug 4 build.
- That Aug 4 build's own log showed the gate passing against the *old*
  hardcoded ref (`fkyexcddvogkngbbrefz`) — proof `SUPABASE_URL` on admin
  Production was the old, since-deleted Supabase project at build time. It
  hadn't been touched in 56 days, so it was still that value right now: the
  backend that verifies every password was pointed at a project with no DNS
  record. `SUPABASE_ANON_KEY` had been rotated 4 days ago (to the correct
  project) but `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` never were —
  exactly the split-migration case `validate-env.mjs`'s consistency check
  exists to catch, just not yet deployed.
- Separately, admin Production was missing 5 vars the gate had required since
  it was introduced (`54f6e3e`, Aug 3): `QSTASH_TOKEN`,
  `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`,
  `FOOTBALL_DATA_API_KEY`, `TRANSFERMARKT_API_URL`. Present as of the Aug 4
  build, gone since — most likely dropped during the Supabase reconciliation
  cleanup. This alone would have kept blocking every deploy even after fixing
  `SUPABASE_URL`.

**Validator fix** (`scripts/lib/validate-env.mjs`): audited each of the 5
missing vars against actual runtime call sites rather than blanket-relaxing
the gate.
- `QSTASH_TOKEN`/`QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY`/
  `TRANSFERMARKT_API_URL` → moved from `required` to `recommended`. Data Sync
  (squad/player imports) is local-only by design: it runs against an
  admin instance on the operator's machine talking to a Transfermarkt adapter
  on `localhost:8000` (`DATA_IMPORT_DISPATCH_MODE=local`), never against the
  deployed Vercel admin. Confirmed by reading `data-imports/config.ts` and
  `app/api/data-imports/task/route.ts`: both are read lazily inside
  feature-specific code paths, not at cold start, and the QStash route already
  degrades to a clean 503 rather than crashing when the signing keys are
  absent — so downgrading these to warnings cannot affect login or any other
  route.
- `FOOTBALL_DATA_API_KEY` → **kept required**. `GET /league-table`
  (`backend/routes/league-table.ts`), hit on every dashboard load behind
  normal auth, calls football-data.org directly as its live-data tier before
  falling back to a static table. This is a real, always-on production
  runtime dependency, not a background-job convenience.
- Added `scripts/lib/validate-env.test.mjs` cases for both: missing
  `FOOTBALL_DATA_API_KEY` still fails the gate; missing QStash/Transfermarkt
  vars pass with warnings, not errors.

**Production fix applied**: with tests (19 validator + 126 admin, all green)
and `pnpm build` passing first, committed to `dev` → fast-forwarded into
`main` → pushed (commit `f453e8f`). Then, with the user's explicit go-ahead,
set the 4 correct values on `85percent-admin` Production directly from
`apps/admin/.env.local`'s `SUPABASE_PROD_*` / `FOOTBALL_DATA_API_KEY` entries
(never retyped — piped straight from the file into `vercel env add` so they
wouldn't be duplicated across the session more than necessary):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`FOOTBALL_DATA_API_KEY`. Redeployed with `vercel --prod`.

### Verified

Build log for the new deployment (`dpl_5vdBQXK7...`) shows `Validated admin
environment for Vercel production.` with only the expected warnings
(OPENAI_API_KEY, QSTASH_*, TRANSFERMARKT_API_URL) — no errors. Deployment
`READY`, aliased to `admin.85percent.pro`. A bogus-credential probe against
the live `POST /api/auth/login` returned a clean `401` (proof the backend
now reaches a real Supabase project and gets a genuine auth rejection,
not a dead-host error).

### Still open

`85percent-admin` Production still has no `OPENAI_API_KEY` (Analyst feature
unavailable) and no `QSTASH_*`/`TRANSFERMARKT_API_URL` (Data Sync from the
*deployed* admin unavailable — expected, since that flow is local-only by
design). No live end-to-end login test with a real account was performed by
Claude; the user should confirm the originally-created test account can now
sign in.

## Session — Production onboarding catalog was down to 3 clubs; built a canonical seed system (2026-08-07)

### Root cause

`template_clubs` (the 44-club onboarding catalog: 20 Premier League + 24
Championship) was never a schema-migration or seed-script concern. Per the
original migration's own comment, it was "populated by the monthly
background sync worker... from the felipeall/transfermarkt-api scraper" —
i.e. by running Data Sync manually against whichever Supabase project was
live at the time. That only ever happened against Development.

When Production was reconciled to a new Supabase project (2026-08-06), the
catalog was never reproduced there. The following day's promotion migration
(`20260805193000_activate_2026_27_template_clubs`) ran an `UPDATE ...
WHERE name IN (41 names)` to move the existing catalog onto the 2026-27
season, plus an unconditional `INSERT ... ON CONFLICT` for the 3 newly
promoted clubs (Bolton Wanderers, Cardiff City, Lincoln City). Against a
Production database with zero pre-existing `template_clubs` rows, the
`UPDATE` matched nothing (a silent no-op — `UPDATE` on zero rows doesn't
error), while the `INSERT` succeeded — which is exactly why Production had
only those 3 Championship clubs and 0 Premier League clubs.

### Dev vs Prod, before any fix

| | Premier League | Championship | Total active | Roster items | Provider mappings |
|---|---|---|---|---|---|
| Expected | 20 | 24 | 44 | — | — |
| Dev | 20 | 24 | 44 | 1,322 (34 clubs) | 59 |
| Prod | 0 | 3 | 3 | 0 | 0 |

### Fix

Built a canonical, version-controlled reference-data system, kept separate
from schema migrations per the standing architecture rule ("schema
migrations and reference-data seeding are different concerns — that
conflation is what caused this outage"):

- `apps/admin/backend/data-imports/reference-data/template-clubs.ts` — the
  44-club catalog (id, name, league, logoUrl, footballDataClubId), sourced
  from Development (the only environment with a complete, correct catalog).
- `apps/admin/backend/data-imports/template-catalog.ts` — pure diff/verify
  logic, unit tested (14 tests): upserts by `name` (a real DB-unique
  constraint — exact matching, not fuzzy), so a same-named row that already
  exists (e.g. Production's Bolton Wanderers) keeps its own id and only gets
  metadata reconciled; a catalog id is only ever used to insert a genuinely
  new row. Clubs that fall out of the catalog (relegation) are deactivated,
  never deleted, so roster/import history survives.
- `apps/admin/backend/scripts/seed-templates.ts` / `verify-templates.ts` —
  idempotent CLIs, wired as `pnpm db:seed:templates:dev` /
  `:prod`(`:dry-run` variants default to no writes) and
  `pnpm db:verify:templates:dev` / `:prod`. Both touch only `template_clubs`
  and `external_source_mappings` — disjoint tables from `clubs` / `players`
  / `contracts` (real customer workspaces), so they structurally cannot read
  or write customer financial data. Neither touches
  `template_roster_items` (template squads) — that stays Data Sync's job,
  a separate, provider-scraped, versioned-by-import-run system.

Production dry run (`pnpm db:seed:templates:prod:dry-run`) confirms: 41
inserts, 0 updates, 0 deactivations, 3 unchanged, 44 provider-mapping
upserts. Not yet applied — awaiting explicit approval before writing to
Production, per instruction.

### Also fixed: onboarding empty-state messaging

`GET /onboarding/clubs` now reports `hasRoster` per club (catalog presence
and squad-sync are two different states — Production's incident was the
former; a club with no synced squad was never actually hidden, it just
looked identical to a fully-hydrated one). The empty-state copy previously
read "hasn't been synced, ask an administrator to run Data Sync" — wrong
advice for a catalog that doesn't exist at all, which is what Production
actually hit; reworded across all 4 locales (en/es/it/fr) to name it as a
server-side configuration gap instead. Unsynced clubs now carry a small
"Manual setup" badge rather than looking indistinguishable from synced ones.

### Verified

- `pnpm --filter @85percent/admin test` — 140/140 pass (includes the new
  14-test `template-catalog.test.ts`).
- `pnpm --filter @85percent/admin typecheck` / `build` — clean.
- `pnpm --filter @85percent/web typecheck` / `build` / `test` — clean.
- `pnpm db:verify:templates:dev` — PASS (44 active: 20 PL / 24
  Championship; 33/44 have a synced squad, reported separately from catalog
  membership as required).
- Pre-existing, unrelated: `pnpm --filter @85percent/admin test:onboarding`
  has one failing assertion ("Bolton Wanderers: realistic squad size, got
  0") — 10 Dev clubs (including the 3 promoted this month) have no synced
  template squad yet. Not caused by this session's changes; needs a Data
  Sync run against Dev, not a seed fix.

### Still open

Production seed not yet applied — the dry-run above is what
`db:seed:templates:prod --apply` would do once approved. After applying:
run `pnpm db:verify:templates:prod` and a manual onboarding smoke test.

### Production seed applied

`pnpm db:seed:templates:prod` — first attempt failed cleanly on the very
first insert (`updated_at` NOT NULL, no DB default; Prisma's `@updatedAt`
only stamps it at the ORM layer, and the script's raw REST insert didn't
set it — zero rows had been written at that point). Fixed by setting
`updated_at` explicitly on every insert/update/deactivate in
`seed-templates.ts`, re-verified as a no-op against Dev, then re-ran
against Prod successfully: 41 clubs inserted, 44 football-data.org mappings
created, 0 updates/deactivations needed (the pre-existing 3 already matched
canonical values).

`pnpm db:verify:templates:prod` → **PASS** — 44 active (20 PL / 24
Championship). Confirmed `GET /onboarding/clubs`'s exact query
(`is_active=true AND league=...`) returns 20 and 24 respectively with no
missing logos, matching what the *currently-deployed* endpoint will now
serve even before the `hasRoster` code change ships.

Squad coverage in Prod: 0/44 (expected — the seed intentionally never
touches `template_roster_items`; that's Data Sync's job, run locally
against Prod on request).

Still pending, in order per instruction: identify+propose the safe way to
populate Prod squads (next), then merge `dev` → `main` and deploy — held
until the seed was confirmed good, which it now is.

## Onboarding UX: honest SCR state + Financials as Step 2 (2026-08-07)

Production symptom: a brand-new user who'd just picked a club saw the
TopBar "CURRENT SCR" widget read **Unavailable / Retry** before they'd
ever had a chance to enter Financials — looked like a backend failure,
wasn't one.

### Root cause

`GET /club/financials` already returned the right shape: `404` for "no row
for this season yet", `500` for a genuine failure
(`apps/admin/backend/routes/club.ts:177,207`). But `apiFetch`
(`apps/web/src/lib/api.ts`) threw the same `ApiError` for any non-OK
response, and `ProtectedRoute.tsx` funneled every rejection into
`setFinancialsError()` — so 404 and 500 both landed on
`financialsStatus: 'error'`. `AppLayout.tsx`'s SCR widget already had a
correct `notConfigured` state and pill; it was just unreachable dead code,
since nothing ever fed it that input.

Fixed at the source, not visually:
- `ApiError` now carries `status` (`apps/web/src/lib/api.ts`).
- `ProtectedRoute` checks it: 404 → `setFinancials(null)` (the same
  success path a genuinely-empty season takes → the friendly
  "Set up financials" pill); anything else → `setFinancialsError()` (real
  `Unavailable` / `Retry`).

### Financials as onboarding Step 2

Added a second coach-mark, same pattern as the existing "Start here" club
picker, anchored to the Financials sidebar item. Eligibility is derived
from real domain state rather than a new persistence flag: shows when the
roster is non-empty (club chosen) and `financials === null` (no
`club_financials` row yet); disappears for good once financials are saved,
since `financials` then stays non-null — no localStorage/backend flag
needed. No schema change, no new backend field.

Two bugs found and fixed live in the browser after the first pass tested
green:
- The coach-mark was absolutely-positioned inside `<nav>`, which has
  `overflow-y-auto` — per the CSS overflow spec, setting one axis to
  non-`visible` forces the other axis to compute as `auto` too, so the
  "escape to the right" positioning got clipped by the nav's own scroll
  box. Fixed by portaling to `document.body` (same pattern as the SCR
  breakdown popover and the "change club" modal already in this file),
  positioned from a measured `getBoundingClientRect()`.
- The portal's vertical centering (`style.transform: 'translateY(-50%)'`)
  was silently overwritten — the same `motion.div` also animates `x` via
  framer-motion, which owns the `transform` property on anything it
  animates. Fixed by anchoring to the row's top edge directly (no
  transform) and offsetting the arrow by a fixed pixel amount instead.

### Verified

- `pnpm --filter @85percent/web test` — 14/14 pass, including a new
  `AppLayout.test.tsx` (7 tests, full-stack render against a real fetch
  mock) covering all 6 requested regression scenarios: no-club/no-error,
  financials-missing/neutral-state, financials-configured/normal-SCR,
  genuine-500/still-shows-Retry, refresh-doesn't-resurrect-a-completed-step,
  and both "Set up financials" CTAs navigating to `/financials`.
- `pnpm --filter @85percent/web typecheck` / `build` — clean.
- Admin untouched (no backend/schema change), so no admin test run needed.
- Manually confirmed in the browser (localhost:5173) against a real
  Championship club with a not-yet-configured season — this is where the
  two positioning bugs above were actually caught.
