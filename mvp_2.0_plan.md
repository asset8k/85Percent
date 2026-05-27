# Headroom — MVP 2.0 Implementation Plan

> **Engineering execution spec — sequential, phase-gated**
> Stack: Vite/React 18 + Fastify 5 + Supabase (PostgreSQL + Auth). Monorepo via Turborepo + pnpm.
> Engine: `@headroom/engine` — pure TypeScript, imported directly in `apps/web`.
> Money: integer pence end-to-end. BigInt in DB → number at API boundary.

---

## Status Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete

---

## Headline Outcomes (MVP 2.0)

1. Club squad costs are computed from a **relational source of truth** (players + contracts), not a manual aggregate field.
2. CFOs can **upload a 25-man roster via CSV** with a staging-area validate-before-commit workflow.
3. The Scenario Builder supports **multi-action plans** (buy + sell + release combined) with real-time SCR recompute and named save/compare.
4. Premier League clubs can run **SCR + the 3 SSR tests**.
5. **RBAC** enforced across React Router and Fastify; **invites** use full OTP registration (no magic links).
6. **PDF + Excel exports** for board-ready reporting.

---

## Phase 1 — Relational Database Schema & RLS

**Goal:** Replace the manual `current_squad_costs` aggregate with a derived sum over real player contracts. Add full RLS isolation for every new table. Restructure `simulations` to support named multi-action scenarios.

### Schema changes

#### 1.1 — `players` table (new)
```prisma
model Player {
  id          String   @id @default(uuid())
  clubId      String   @map("club_id")
  name        String
  position    String?  // 'GK' | 'DEF' | 'MID' | 'FWD' (free text for now)
  nationality String?
  dateOfBirth DateTime? @map("date_of_birth")
  isActive    Boolean  @default(true) @map("is_active")  // false = archived (departed)
  archivedAt  DateTime? @map("archived_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  club      Club       @relation(fields: [clubId], references: [id])
  contracts Contract[]

  @@index([clubId, isActive])
  @@map("players")
}
```

#### 1.2 — `contracts` table (new)
```prisma
model Contract {
  id                  String   @id @default(uuid())
  playerId            String   @map("player_id")
  clubId              String   @map("club_id")
  transferFee         BigInt   @map("transfer_fee")          // pence
  annualWage          BigInt   @map("annual_wage")           // pence
  agentFee            BigInt   @map("agent_fee")             // pence
  startDate           DateTime @map("start_date")
  endDate             DateTime @map("end_date")
  contractLengthYears Decimal  @map("contract_length_years") // computed at insert
  bookValue           BigInt   @map("book_value")            // amortised remaining value, pence
  isActive            Boolean  @default(true) @map("is_active")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  player Player @relation(fields: [playerId], references: [id])
  club   Club   @relation(fields: [clubId], references: [id])

  @@index([clubId, isActive])
  @@index([playerId, isActive])
  @@map("contracts")
}
```

#### 1.3 — `club_financials` (modify)
- **DROP** column `current_squad_costs` (now derived from contracts + wages).
- Keep: `football_related_revenue`, `current_allowance_ratio`, `owner_equity_used_1yr`, `owner_equity_used_3yr`.
- Add: `season_start_date date`, `season_end_date date` (drives book-value amortisation math).

#### 1.4 — `scenarios` + `scenario_actions` (replaces flat simulations)

The MVP 1.0 `simulations` table is one-row-per-action. MVP 2.0 needs a parent "named scenario" with N child actions.

```prisma
model Scenario {
  id         String   @id @default(uuid())
  clubId     String   @map("club_id")
  createdBy  String   @map("created_by")
  season     String
  name       String   // "January Plan A"
  isIncluded Boolean  @default(false) @map("is_included") // part of Active Baseline
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  club    Club             @relation(fields: [clubId], references: [id])
  user    User             @relation(fields: [createdBy], references: [id])
  actions ScenarioAction[]

  @@index([clubId, season])
  @@map("scenarios")
}

model ScenarioAction {
  id          String   @id @default(uuid())
  scenarioId  String   @map("scenario_id")
  actionType  String   @map("action_type") // 'buy' | 'sell' | 'loan_in' | 'loan_out' | 'release'
  payload     Json     // delta input (same shape as MVP 1.0 TransferInput)
  playerId    String?  @map("player_id") // optional FK for sell/release of existing player
  orderIndex  Int      @default(0) @map("order_index")
  createdAt   DateTime @default(now()) @map("created_at")

  scenario Scenario @relation(fields: [scenarioId], references: [id], onDelete: Cascade)
  player   Player?  @relation(fields: [playerId], references: [id])

  @@index([scenarioId, orderIndex])
  @@map("scenario_actions")
}
```

- Existing `simulations` table is **dropped** as part of the destructive refactor. MVP 1.0 history does not migrate forward (declared destructive by user).
- The `release` action type is new — removes a player's wage + amortisation from squad costs without a sale fee (player moves on free / contract terminated).

### Migration & RLS steps

- [ ] **1.5** — Update `apps/api/prisma/schema.prisma` with Player/Contract/Scenario/ScenarioAction models and the modified ClubFinancials.
- [ ] **1.6** — Generate migration: `pnpm --filter @headroom/api exec prisma migrate dev --name mvp2_relational_roster`. Inspect generated SQL.
- [ ] **1.7** — Hand-edit the migration to add explicit `DROP TABLE simulations CASCADE` before the Scenario/ScenarioAction creation. Confirm `club_financials.current_squad_costs` drop is in the diff.
- [ ] **1.8** — Apply migration to Supabase via `prisma migrate deploy` (or paste DDL into Supabase SQL editor if migrations are still manual).
- [ ] **1.9** — Extend `apps/api/prisma/rls.sql` with policies for the new tables:

```sql
ALTER TABLE public.players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "players: own club only"   ON public.players;
DROP POLICY IF EXISTS "contracts: own club only" ON public.contracts;
DROP POLICY IF EXISTS "scenarios: own club only" ON public.scenarios;
DROP POLICY IF EXISTS "scenario_actions: own club only" ON public.scenario_actions;

CREATE POLICY "players: own club only"
  ON public.players FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "contracts: own club only"
  ON public.contracts FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "scenarios: own club only"
  ON public.scenarios FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- scenario_actions inherit isolation via the scenario FK
CREATE POLICY "scenario_actions: via scenario club"
  ON public.scenario_actions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.scenarios s
    WHERE s.id = scenario_actions.scenario_id
      AND s.club_id = public.current_club_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.scenarios s
    WHERE s.id = scenario_actions.scenario_id
      AND s.club_id = public.current_club_id()
  ));
```

- [ ] **1.10** — Apply RLS in Supabase SQL editor. Verify with a manual test: log in as Club A, attempt `SELECT * FROM players` filtered with anon key against Club B's data — must return 0 rows.
- [ ] **1.11** — Update seed script `apps/api/prisma/seed.ts` to insert 4–6 sample players + contracts for the dev club so the dashboard has something to show in Phase 3.

### Acceptance criteria — Phase 1
- `pnpm --filter @headroom/api exec prisma generate` succeeds with no warnings.
- `current_squad_costs` column no longer exists in `club_financials`.
- Cross-club RLS test confirms isolation on all 9 tables.
- Seed produces a working dev environment with a roster.

---

## Phase 2 — Roster Management & The Smart CSV Mapper

**Goal:** A CFO can upload a 25-man squad CSV, see every validation error inline, fix them in the UI without re-uploading, then commit the corrected payload atomically. Also: standard CRUD for single-player edits, automatic book-value amortisation, contract-expiry flagging, and soft-delete archival.

### Backend — `apps/api/src/routes/roster.ts` (new)

#### 2.1 — `POST /roster/parse` (staging endpoint — does NOT write to DB)
- **Input:** `multipart/form-data` with one CSV file.
- **Behaviour:**
  1. Parse CSV with `papaparse` (header row required).
  2. Validate each row against `RosterRowSchema` (Zod).
  3. Compute `contractLengthYears` and initial `bookValue` from `transferFee + startDate + endDate`.
  4. Return `{ rows: ParsedRow[], errors: RowError[] }` where each `ParsedRow` has `{ rowIndex, ok: boolean, parsed: { name, position, transferFeePence, annualWagePence, agentFeePence, startDate, endDate, contractLengthYears, bookValuePence }, issues: string[] }`.
- **No DB writes.** This is the "Staging Area" — the UI keeps the payload in memory, lets the user fix errors, then submits to the commit endpoint.

Expected CSV columns (case-insensitive, trimmed):
```
name, position, transfer_fee_pounds, weekly_wage_pounds, agent_fee_pounds, contract_start, contract_end
```

`RosterRowSchema` (in `packages/shared/src/schemas.ts`):
- `name` — non-empty string ≤ 80 chars
- `position` — enum `'GK' | 'DEF' | 'MID' | 'FWD'` (case-insensitive)
- `transfer_fee_pounds` — number ≥ 0
- `weekly_wage_pounds` — number > 0 (converted to annual via × 52)
- `agent_fee_pounds` — number ≥ 0
- `contract_start` / `contract_end` — ISO date, end > start, end ≤ start + 7 years

#### 2.2 — `POST /roster/commit`
- **Input:** `{ rows: ParsedRow[] }` (full validated payload from the staging UI).
- **Behaviour:** Single Postgres transaction. For each row: insert player → insert contract with `is_active=true` and computed `bookValue`. Reject the whole batch if any row fails.
- **Output:** `{ playersCreated: number, contractsCreated: number }`.
- **Role guard:** CFO + Admin + Finance Analyst.

#### 2.3 — Standard CRUD endpoints
- `GET /roster` — list active players with their active contract joined. Includes `monthsToExpiry` (computed server-side from today + endDate).
- `POST /roster/player` — create a single player + contract manually. Body validated by `ManualPlayerSchema`.
- `PATCH /roster/player/:id` — update player fields (name, position).
- `PATCH /roster/contract/:id` — update contract fields. Recomputes `bookValue` based on new dates/fee.
- `POST /roster/player/:id/archive` — soft delete: set `players.is_active=false`, `archived_at=now()`, and set the active contract's `is_active=false`. **Never hard-delete.** Audit trail requirement.
- `GET /roster/archived` — list archived players (for audit/history view).

#### 2.4 — Book value amortisation utility

Add to `packages/engine/src/amortisation.ts`:
```typescript
export function currentBookValuePence(
  transferFeePence: bigint | number,
  startDate: Date,
  endDate: Date,
  asOf: Date = new Date()
): number {
  const totalMonths = monthsBetween(startDate, endDate)
  const remainingMonths = Math.max(0, monthsBetween(asOf, endDate))
  if (totalMonths === 0) return 0
  const fee = typeof transferFeePence === 'bigint' ? Number(transferFeePence) : transferFeePence
  return Math.floor(fee * (remainingMonths / totalMonths))
}
```
- Called on every contract insert/update server-side.
- Called nightly via a scheduled task (Phase 5+) to refresh `bookValue` as time passes. **MVP 2.0 deferral:** the nightly refresh is optional — `bookValue` can be recomputed on read in the GET endpoint if scheduling is not yet set up.

#### 2.5 — Backend test stubs
- Unit-test `currentBookValuePence` for: full contract length, mid-contract, expired, free transfer (fee=0), partial month rounding.
- **Leap-year / mid-month edge cases (mandatory):** Date math for book-value depreciation gets tricky with leap years and mid-month transfers. The test suite MUST include explicit cases for:
  - Transfer signed on **2024-02-29** (leap day) with a 4-year contract ending 2028-02-28 — verify `monthsBetween` returns exactly 48 and book value at every February anniversary lands on the expected straight-line value with zero drift.
  - Transfer signed on **2025-02-28** (non-leap) with a 3-year contract ending 2028-02-28 — verify identical month count regardless of leap status.
  - Mid-month transfer (e.g. start = 2026-03-15, end = 2028-03-15) — verify fractional month handling matches the spec (we use whole-month rounding, NOT day-precision; document this explicitly in the test name).
  - `asOf` falling exactly on the contract end date → book value must be 0, not negative.
  - `asOf` one day before contract start → book value must equal full `transferFee`, not pro-rated.
- Integration-test `/roster/parse` with a fixture CSV containing 2 valid + 3 invalid rows; assert `errors` array structure.

### Frontend — `apps/web/src/pages/RosterPage.tsx` (new)

#### 2.6 — Layout
Two-tab page:
- **Tab 1: "Squad"** — table of active players with columns: Name, Position, Annual Wage (mono), Book Value (mono), Contract End, Months to Expiry. Click a row → drawer with edit form.
- **Tab 2: "Archived"** — read-only history.

#### 2.7 — CSV Upload UX (the "Smart Mapper")
1. User clicks **Upload CSV** → file picker.
2. Client POSTs to `/roster/parse`.
3. UI renders a **staging table**: one row per CSV row. Valid rows shown green; invalid rows shown red with inline error chips per field.
4. User edits invalid cells inline (controlled inputs bound to in-memory state). As they edit, client-side Zod revalidates the row; chip clears when valid.
5. **Commit** button disabled until every row is valid. On click → POST `/roster/commit` with the corrected payload.
6. On success → close staging modal, toast `"Imported N players"`, refresh squad tab.

#### 2.8 — Expiry warning chip
- Computed client-side: `monthsToExpiry = differenceInMonths(contractEndDate, today)`.
- If `monthsToExpiry <= 6` → render amber chip `"Expires in 6 mo"` next to the player name.
- If already expired → red chip `"Contract expired — auto-archive?"` with a one-click archive button.

#### 2.9 — Manual add/edit/archive
- "Add Player" button → modal with same `ManualPlayerSchema` form.
- Row drawer → edit player + contract; **Archive** button at the bottom with confirm dialog (this one DOES need confirm — it's irreversible for the audit trail).

### Acceptance criteria — Phase 2
- A CSV with 25 rows where 3 have invalid wages can be fixed inline and committed in a single round-trip.
- Book values are correct to the penny for full-contract, mid-contract, and free-transfer cases.
- Archiving a player keeps their row queryable but excludes them from active squad cost sums.

---

## Phase 3 — Dashboard & Multi-Action Scenario Builder

**Goal:** Replace the single-transfer simulator with a dashboard view that aggregates real squad costs, plus a stacked Scenario Builder workspace.

### Engine work — `packages/engine/`

#### 3.1 — `calculateSquadCosts(contracts, asOf)` (new pure function)
Sum across all active contracts:
```
squadCostsPence = Σ contract.annualWage
                + Σ floor(contract.transferFee / contractLengthYears)        // amortisation
                + Σ floor(contract.agentFee / contractLengthYears)           // annualised agent fee
```
- Returns `{ totalSquadCostsPence, breakdown: Array<{ playerId, wage, amortisation, annualisedAgentFee, total }> }`.
- The breakdown drives the dashboard table.

> **Agent fee labelling — important UX note.** In reality, some agent fees are paid 100% upfront in year 1 while others are amortised across the contract. For SCR regulatory purposes the standard is to amortise (straight-line over contract length), and that's what the engine does. Because this can surprise CFOs whose own internal P&L books the fee upfront, every UI surface that shows this number MUST label it **"Annualised Agent Fee"** (not just "Agent Fee") and include a hover tooltip: *"For SCR purposes, agent fees are spread evenly across the contract length, regardless of when the fee is paid."* Surfaces requiring this label: dashboard breakdown table column header, player drawer detail row, PDF export column, Excel `Annual Agent Fee` column, scenario builder cost-breakdown rows.

#### 3.2 — Refactor `calculateSCR` to accept derived squad costs
- Current MVP 1.0 signature takes `ClubFinancials.currentSquadCosts` as input.
- MVP 2.0: caller computes `squadCosts` from `calculateSquadCosts(activeContracts)` and passes it in. Engine signature unchanged; only the data source moves from a DB column to a derived sum.

#### 3.3 — `applyScenarioActions(baseline, actions[])` (new)
- Input: baseline `{ squadCostsPence, revenuePence }`, ordered array of `ScenarioAction`.
- For each action, applies a delta:
  - `buy` → costs += wage + amortisation + agent spread
  - `sell` → costs -= released wage + released amortisation; revenue += net sale profit (proceeds − bookValue)
  - `loan_in` → costs += wage portion + loan fee amortised
  - `loan_out` → costs -= wage covered by receiving club; revenue += loan fee received
  - `release` → costs -= wage + amortisation (no revenue change)
- Output: `{ projectedSquadCostsPence, projectedRevenuePence }` → fed into `calculateSCR`.
- Pure function. Adds 6–10 new unit tests to `packages/engine/tests/engine.test.ts`.

### Dashboard page — `apps/web/src/pages/DashboardPage.tsx` (new, replaces `/simulator` as home)

#### 3.4 — Top section: aggregate SCR card
- Total Squad Costs (£, mono, large)
- SCR % (mono, large)
- Green/Red gauge — re-use the existing `ComplianceGauge` component
- Status pill (green/amber/red)

#### 3.5 — Player-level breakdown table
- Columns: Name | Position | Annual Wage | Annual Amortisation | **Annualised Agent Fee** | Total Annual Cost | Contract Expiry
- The "Annualised Agent Fee" header carries the tooltip described in 3.1.
- All number columns sortable. Default sort: Total Annual Cost descending.
- Filter chips: All / Expiring ≤ 6mo / By position
- Row click → opens player detail drawer (reused from Phase 2)

### Scenario Builder — `apps/web/src/pages/ScenariosPage.tsx` (new, replaces `/simulator`)

#### 3.6 — Workspace layout
Two-column:
- **Left (sticky):** "Active Plan" — ordered list of actions. Each action is a draggable card (use `@dnd-kit/sortable`). Actions can be reordered, deleted, or marked `is_included=false` to exclude from the projection.
- **Right:** Result panel — projected SCR card, before/after gauge, breakdown of every action's contribution.

#### 3.7 — Adding actions
- "Add Action" dropdown: Buy / Sell / Loan In / Loan Out / Release.
- **Buy / Loan In** → blank form (same fields as MVP 1.0 simulator).
- **Sell / Loan Out / Release** → searchable picker over current active roster; selected player pre-fills name + auto-fills `bookValue`, `annualWage`, remaining amortisation. User adjusts the sale-specific fields (proceeds, etc.).

#### 3.8 — Real-time recompute
- Engine runs **client-side on every state change** — no API call. Already proven pattern from MVP 1.0 Active Baseline.
- Debounce: none needed; engine is sub-millisecond.

#### 3.9 — Save / Compare
- **Save Scenario** button → modal asks for a name → POST `/scenarios` with `{ name, season, actions: [...] }`.
- Saved scenarios listed in a left-rail dropdown: "Load…" lets the user swap the workspace contents.
- **Compare** button → modal pick "Scenario A" + "Scenario B" → side-by-side cards showing each scenario's projected SCR, total cost impact, status. Delta column highlights the difference.

#### 3.10 — Backend routes — `apps/api/src/routes/scenarios.ts` (new, replaces `simulations.ts`)
- `POST /scenarios` — create scenario + insert ordered actions in a transaction.
- `GET /scenarios` — list (paginated) with action counts.
- `GET /scenarios/:id` — full scenario with actions joined.
- `PATCH /scenarios/:id` — rename or toggle `is_included`.
- `DELETE /scenarios/:id` — hard delete (cascades to actions); writes to `audit_logs`.

### Acceptance criteria — Phase 3
- Dashboard SCR matches sum of `calculateSquadCosts` for the seeded roster to the penny.
- Building a "sell A + sign B + release C" scenario shows the correct net SCR change.
- Saving and reloading "January Plan A" produces an identical projection.
- Side-by-side compare displays both scenarios without re-fetching the engine.

---

## Phase 4 — Premier League Module & SSR Tests

**Goal:** A PL club can run SCR using PL config and pass/fail the three SSR tests. Promoted clubs get an adjusted-revenue uplift calculator.

### 4.1 — League config switching
- `clubs.league_id` already exists. UI: a one-time setting on Club Setup (CFO-only) — Championship vs Premier League.
- `LEAGUE_CONFIGS['premier-league']` already in `packages/shared/src/configs.ts`. Verify it carries `hasSSRTests: true` and no `ownerEquityTopUpLimit`.
- Engine: no changes — config-driven already.

### 4.2 — SSR storage tables (new)

```prisma
model SsrWorkingCapital {
  id              String   @id @default(uuid())
  clubId          String   @map("club_id")
  season          String
  yearMonth       String   @map("year_month")    // '2026-07' .. '2027-06'
  adjustedCashflow BigInt  @map("adjusted_cashflow")
  qualifyingFunds  BigInt  @map("qualifying_funds")
  createdAt       DateTime @default(now()) @map("created_at")

  club Club @relation(fields: [clubId], references: [id])

  @@unique([clubId, season, yearMonth])
  @@map("ssr_working_capital")
}

model SsrLiquidity {
  id                  String   @id @default(uuid())
  clubId              String   @map("club_id")
  season              String
  liquidAssets        BigInt   @map("liquid_assets")
  liquidLiabilities   BigInt   @map("liquid_liabilities")
  squadMarketValue    BigInt   @map("squad_market_value")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id])

  @@unique([clubId, season])
  @@map("ssr_liquidity")
}

model SsrEquity {
  id                String   @id @default(uuid())
  clubId            String   @map("club_id")
  season            String
  totalLiabilities  BigInt   @map("total_liabilities")
  adjustedAssets    BigInt   @map("adjusted_assets")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id])

  @@unique([clubId, season])
  @@map("ssr_equity")
}
```
- Apply same RLS pattern (`club_id = public.current_club_id()`).

### 4.3 — Engine additions — `packages/engine/src/ssr.ts` (new module)

```typescript
export interface WorkingCapitalInput { adjustedCashflow: number; qualifyingFunds: number }
export interface WorkingCapitalResult { monthlyHeadroomPence: number; passing: boolean }

export const WORKING_CAPITAL_MINIMUM_PENCE = 12_500_000_00  // £12.5M
export const LIQUIDITY_STRESS_TEST_PENCE   = 85_000_000_00  // £85M

export function evaluateWorkingCapital(input: WorkingCapitalInput): WorkingCapitalResult {
  const headroom = input.adjustedCashflow + input.qualifyingFunds - WORKING_CAPITAL_MINIMUM_PENCE
  return { monthlyHeadroomPence: headroom, passing: headroom >= 0 }
}

export interface LiquidityInput { liquidAssets: number; liquidLiabilities: number; squadMarketValue: number }
export function evaluateLiquidity(input: LiquidityInput) {
  // Liquid Assets includes 40% of squad market value
  const totalAssets = input.liquidAssets + Math.floor(input.squadMarketValue * 0.4)
  const headroom = totalAssets - input.liquidLiabilities - LIQUIDITY_STRESS_TEST_PENCE
  return { liquidityHeadroomPence: headroom, passing: headroom >= 0 }
}

export interface EquityInput { totalLiabilities: number; adjustedAssets: number; season: string }
export function evaluateEquity(input: EquityInput) {
  const ratio = input.adjustedAssets === 0 ? Infinity : input.totalLiabilities / input.adjustedAssets
  const threshold = seasonEquityThreshold(input.season) // 0.90 → 0.85 → 0.80
  return { ratio, threshold, passing: ratio <= threshold }
}

function seasonEquityThreshold(season: string): number {
  if (season === '2026-27') return 0.90
  if (season === '2027-28') return 0.85
  return 0.80
}
```
- Add 9+ unit tests covering pass/fail edges and the three season thresholds.

### 4.4 — API routes — `apps/api/src/routes/ssr.ts` (new)
- `GET /ssr/working-capital?season=2026-27` — list 12 monthly rows.
- `PUT /ssr/working-capital` — upsert one month (body: `{ season, yearMonth, adjustedCashflow, qualifyingFunds }`).
- `GET / PUT /ssr/liquidity` — single row per season.
- `GET / PUT /ssr/equity` — single row per season.
- All routes guarded: only available when `club.league_id === 'premier-league'`. Otherwise 404.

### 4.5 — UI — `apps/web/src/pages/SSRPage.tsx` (new, PL only)
- Three sub-pages or tabs: Working Capital / Liquidity / Positive Equity.
- **Working Capital:** 12-month grid (Jul → Jun). Each cell is a `NumericInput` for adjusted cashflow + qualifying funds; right column shows monthly headroom and a green/red pill. Bottom summary: number of failing months.
- **Liquidity:** three input fields + computed Liquidity Headroom card. Pass/fail banner.
- **Positive Equity:** two input fields + ratio readout + threshold-tier indicator (which season tier applies + how much margin).
- Sidebar nav: SSR link visible only when `club.leagueId === 'premier-league'`.

### 4.6 — Adjusted revenue calculator for promoted clubs
- New utility `calculatePromotedClubRevenueUplift(championshipRevenue, factor)`:
  - Default `factor = 4.5` (rough average uplift from Championship → PL; document as an editable assumption).
- UI: a panel on Club Setup, shown only when `leagueId === 'premier-league'` AND a "Just promoted from Championship?" toggle is on.
- Output: estimated PL-year-1 revenue used to seed `football_related_revenue`. The CFO can override.

### Acceptance criteria — Phase 4
- A PL club seeded with the example numbers from `CONTEXT.md` Section 4.4 produces the correct pass/fail for all three SSR tests.
- A Championship club has no SSR routes exposed (404) and no SSR nav item.
- Promoted-club uplift produces sensible defaults but is fully editable.

---

## Phase 5 — Auth, RBAC, and Tamper-Evident Auditing

**Goal:** Invited users complete full OTP registration (no magic links). Three roles enforced at API + UI. Every mutating action ends up in `audit_logs`.

### 5.1 — Invite flow (Supabase + custom invites table)

#### Schema
```prisma
model Invite {
  id        String   @id @default(uuid())
  clubId    String   @map("club_id")
  email     String
  role      String   // 'cfo' | 'sporting_director' | 'finance_analyst'
  invitedBy String   @map("invited_by")
  token     String   @unique
  expiresAt DateTime @map("expires_at")
  acceptedAt DateTime? @map("accepted_at")
  createdAt DateTime @default(now()) @map("created_at")

  club Club @relation(fields: [clubId], references: [id])

  @@index([email, acceptedAt])
  @@map("invites")
}
```
- RLS: `club_id = public.current_club_id()`. Service role bypasses for the public-facing accept endpoint.

#### Flow
1. **Send invite (CFO action):**
   - UI: Settings → Team → "Invite" button → modal asks email + role.
   - API: `POST /invites` (CFO-only) → insert invite row with `token = randomUUID()` + 7-day expiry → call Supabase email (use the Auth dashboard's custom email template, or Resend if more flexibility needed). Email contains: `${FRONTEND_URL}/signup?invite=${token}`.
2. **Accept invite (invitee action):**
   - User visits link → frontend reads `?invite=` query param → calls `GET /invites/lookup?token=...` to fetch the invite's email + club name (validation only, no auth required).
   - Sign-up form is pre-filled with email (locked field). User sets password.
   - Standard MVP 1.0 OTP flow runs: `signUp()` → 8-digit OTP → `verifyOtp({ type: 'signup' })`.
   - On first successful auth, middleware sees a new auth user without a `public.users` row AND the email matches an open invite → links the new auth ID to the invite's `club_id` + `role`, sets `invites.accepted_at = now()`.
3. **Middleware update — `apps/api/src/middleware/auth.ts`:**
   - Replace the "always create a new club" branch with: check `invites` table by email first. If a non-expired, not-yet-accepted invite exists, attach to that club with that role. Otherwise fall back to creating a fresh club (the "founder" case).

### 5.2 — RBAC

#### Role matrix
| Capability | CFO | Sporting Director | Finance Analyst |
|---|---|---|---|
| View dashboard, scenarios, calendar | ✓ | ✓ | ✓ |
| Edit club financial settings (revenue, allowance, equity) | ✓ | – | – |
| Manage roster (CSV upload, add/edit/archive players) | ✓ | – | ✓ |
| Create / save / delete scenarios | ✓ | ✓ | ✓ |
| Toggle scenario `is_included` (Active Baseline) | ✓ | ✓ | – |
| Invite + remove users | ✓ | – | – |
| Export PDFs / Excel | ✓ | ✓ | ✓ |
| SSR data entry (PL) | ✓ | – | ✓ |

#### API enforcement
- New helper `requireRole(...roles)` Fastify hook in `apps/api/src/middleware/roles.ts`.
- Apply per route: e.g. `fastify.put('/club/financials', { preHandler: [authMiddleware, requireRole('cfo')] }, handler)`.
- Returns `403 Forbidden` on mismatch; never `404` (avoids info leak about which routes exist).

#### Frontend enforcement
- Extend `ProtectedRoute` to accept an optional `roles?: UserRole[]` prop. Redirect to `/dashboard` with a toast if mismatched.
- `useRole()` hook reads from the auth store; UI hides buttons the user can't use (don't just disable — hide).

### 5.3 — Audit trail
- Existing `audit_logs` table already exists. Extend usage:
  - Every roster mutation (player create/update/archive, contract update) → audit row.
  - Every scenario save / delete / `is_included` toggle → audit row.
  - Every invite created / accepted / revoked → audit row.
  - Every SSR data update → audit row.
- Add helper `writeAuditLog(prisma, { userId, clubId, table, recordId, action, prevValue, newValue })` in `apps/api/src/lib/audit.ts`. Failures log a warning but never fail the primary request.
- New route `GET /audit?from=...&to=...&user=...` (CFO-only) for the Settings → Activity Log view. Paginated, append-only.

### Acceptance criteria — Phase 5
- Inviting a user with role `finance_analyst` → they receive email → complete OTP signup → land in the inviter's club with the correct role, no magic link involved at any step.
- A Sporting Director hitting `PUT /club/financials` gets a `403`.
- The Activity Log page lists 30+ entries after a normal day of usage with no gaps.

---

## Phase 6 — PDF and Excel Exports

**Goal:** Three exports that look professional enough to land in a board pack.

### 6.1 — Library choices

| Format | Library | Where it runs |
|---|---|---|
| PDF (squad report, scenario comparison) | `jspdf` + `jspdf-autotable` (already in `apps/web`) | Client-side |
| Excel (amortisation schedules) | `xlsx` (SheetJS Community Edition, MIT) | Client-side |

Rationale: keep server stateless and avoid file storage. All exports use already-fetched data; no extra API calls needed.

### 6.2 — Squad financial report (PDF)
- Trigger: button on the Dashboard page → `exportSquadPDF(club, financials, contracts, breakdown)`.
- Structure:
  1. Cover block: club name + crest placeholder, season, generation timestamp, footer disclaimer.
  2. Executive Summary table: revenue, total squad costs, SCR %, status, headroom to green, headroom to red.
  3. Compliance gauge — render the existing CSS gauge to canvas via `html2canvas`, drop image into PDF.
  4. Player breakdown table (autotable): one row per active player with Name | Position | Wage | Amortisation | Agent | Total.
  5. Expiring contracts callout (players with `monthsToExpiry ≤ 6`).
  6. Footer disclaimer on every page (reuse MVP 1.0 footer wording).

### 6.3 — Amortisation schedules (Excel)
- Trigger: "Export Amortisation" button on Roster page → `exportAmortisationXLSX(club, contracts)`.
- One workbook, one sheet per player (named `<Surname>_<ContractEnd>`), plus an `Index` sheet linking to each.
- Each sheet: 8 columns × N rows where N = contract years.
  - Season | Annual Amortisation | Cumulative Amortised | Remaining Book Value | Annual Wage | Annual Agent Fee | Total Annual SCR Impact | Contract Active?
- Add a `Summary` sheet aggregating yearly totals across all players.

### 6.4 — Scenario comparison (PDF)
- Trigger: from the Compare modal in Scenarios → `exportComparisonPDF(scenarioA, scenarioB, club)`.
- One page per scenario + a third page for the delta:
  - Scenario A: name, action list (table), projected SCR card, status.
  - Scenario B: same.
  - Delta page: ΔCosts (£), ΔRevenue (£), ΔSCR (pp), Δstatus.

### 6.5 — Common module — `apps/web/src/lib/exports/`
- `pdfBase.ts` — shared helpers: `addHeader(doc, club)`, `addFooter(doc, pageNum)`, `gbpCell(pence)`, color palette consistent with MVP 1.0 PDF.
- `excelBase.ts` — shared helpers: number formats (£#,##0), header styles, freezing panes.

### Acceptance criteria — Phase 6
- PDFs render correctly in Chrome's built-in viewer AND in macOS Preview (no missing fonts).
- Excel file opens cleanly in both Microsoft Excel and Numbers without warnings.
- All three exports respect monetary precision (no float drift).

---

## Cross-Cutting: Tests, Typecheck, and Quality Gates

Run at the end of every phase before merging:
- `pnpm --filter @headroom/engine test` — engine tests (target: 60+ tests by end of MVP 2.0, up from 39).
- `pnpm --filter @headroom/api typecheck` — zero errors.
- `pnpm --filter @headroom/web typecheck` — zero errors.
- Manual E2E walk-through against a fresh seed: invite → accept → upload CSV → fix errors → commit → build scenario → save → compare → export PDF.

---

## Out of Scope for MVP 2.0 (explicit deferrals)

These were considered and **deferred to MVP 3.0** or later:
- Interactive compliance calendar with deadline notifications.
- Anonymised benchmarking layer.
- AI / LLM contract parsing.
- Accounting software integrations (Xero, Sage, SAP).
- La Liga, Ligue 1, UEFA FSR modules.
- Mobile-optimised layouts.
- Nightly job to refresh `book_value` (on-read recompute is acceptable for now).

---

## Phase Dependency Graph

```
Pre-Flight ──► Phase 1 (DB) ──┬──► Phase 2 (Roster + CSV) ──► Phase 3 (Dashboard + Scenarios)
                              │                                        │
                              └──► Phase 4 (PL + SSR) ◄────────────────┘
                                              │
                                              ▼
                                      Phase 5 (Auth + RBAC + Audit)
                                              │
                                              ▼
                                      Phase 6 (Exports)
```

Phase 4 can run in parallel with Phase 3 once Phase 1 is complete (different surface area). Phase 5 should wait until Phase 3 is functional (audit hooks need real mutations to log). Phase 6 wraps everything.

---

## Definition of Done — MVP 2.0

- A fresh club, invited via email, can be onboarded entirely through OTP signup.
- CFO uploads a 25-man CSV, fixes 3 invalid rows inline, commits.
- Dashboard shows correct total squad costs and SCR derived from real contracts.
- CFO builds a 3-action scenario, saves as "January Plan A", builds a second as "Plan B", compares side-by-side, exports the comparison as PDF.
- PL club passes the three SSR tests using sample data.
- Sporting Director cannot edit club financials at API or UI level.
- All actions appear in the Activity Log.
- Engine tests ≥ 60 passing; typecheck clean across all packages.
