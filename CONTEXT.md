# Headroom — Football Financial Compliance Platform
## Claude Code Context Document

---

## 1. What We Are Building

**Headroom** is a B2B SaaS web application for professional football clubs. It is a financial compliance and transfer simulation platform — a "Decision Engine" that allows Club CFOs, Sporting Directors, and Finance Analysts to instantly simulate the financial and regulatory impact of player transfers before they happen.

The product solves one specific, expensive problem: professional football clubs are subject to strict, constantly evolving financial regulations. Getting them wrong results in points deductions, transfer embargoes, and financial fines. Today, clubs navigate these regulations using static Excel spreadsheets and expensive consulting firms. This product replaces both with instant, accurate, always-updated simulation software.

This is not an analytics platform. It is not a scouting tool. It is not general accounting software. It is a forward-looking compliance engine — it answers the question "what will happen to our regulatory position if we do this deal?" in seconds, not days.

---

## 2. Business Model

- **Type:** B2B SaaS, annual subscription
- **Billing cycle:** Annual contracts (clubs budget annually)
- **Pricing tiers:**
  - MVP 1.0 (Championship): £12,000–25,000/year per club
  - MVP 2.0 (Squad Dashboard + PL module): £20,000–35,000/year per club
  - MVP 3.0 (Enterprise): £35,000–60,000/year per club
- **Target ACV:** £15,000–40,000 scaling up to £60,000 at enterprise tier
- **Access model:** Invite-only at MVP 1.0. No public self-signup. Clubs are onboarded manually.

---

## 3. Target Users

### Primary (Phase 1 — MVP 1.0 and 2.0)
**EFL Championship clubs** — 24 clubs in England's second division. These clubs face a strict Squad Cost Ratio (SCR) limit of 85% of revenue starting 2026/27. They have smaller internal finance teams than Premier League clubs and are under intense regulatory pressure, especially those chasing promotion.

**End users within each club:**
- **Club CFO** — primary buyer, approves the subscription, uses it for board-level reporting
- **Sporting Director** — runs transfer simulations during negotiation windows
- **Head of Finance / Finance Analyst** — daily monitoring, data input, compliance tracking

### Secondary (Phase 2 — MVP 2.0 onwards)
**Premier League mid-table clubs** — clubs like Brentford, Fulham, Wolves, Bournemouth. Larger budgets (£30,000–50,000 ACV), more complex dual-jurisdiction needs (domestic SCR + UEFA Squad Cost Ratio). Clubs promoted from Championship using our tool continue as Premier League clients — this is a built-in retention mechanism.

### Future (Phase 3 — MVP 3.0)
- La Liga clubs (individual salary cap system — LCPD)
- Ligue 1 clubs (DNCG + UEFA dual jurisdiction)
- Football law firms and sports agencies (white-label)

---

## 4. The Regulatory Framework We Are Building Against

This section defines the exact rules the software must calculate. These are the legal source documents:

- **Premier League SCR + SSR:** https://www.premierleague.com/en/news/4467022/new-premier-league-financial-system-explained
- **EFL Championship SCR:** EFL Handbook 2026/27, Section 3 (to be published August 2026 — use EFL AGM statement from 15 May 2026 until then)

### 4.1 What Changed in May 2026 (Critical Context)

As of May 2026, both the EFL Championship and the Premier League are moving to Squad Cost Ratio (SCR) from the 2026/27 season. This replaces the old Profitability and Sustainability Rules (PSR). The old PSR system measured three-year rolling losses (£39M limit for Championship, £105M for PL). The new SCR system measures squad spending as a percentage of revenue, assessed seasonally. This means:

1. The **core calculation logic is identical** for both Championship and Premier League (85% ratio)
2. The **Premier League adds three additional SSR solvency tests** on top of SCR
3. Promoted clubs move from Championship SCR to PL SCR + SSR — same engine, different config
4. Old PSR cases are still being investigated. We do not need to build a PSR engine for forward-looking compliance, but we may need read-only PSR context displays later.

### 4.2 SCR Engine — The Core Calculation

This is the mathematical heart of the product. It must be a **pure, stateless TypeScript module** — no database calls, no API calls, no side effects. A pure function that takes inputs and returns a deterministic output every time.

#### The Formula
```
SCR Ratio = Total Squad Costs ÷ Football-Related Revenue
```

#### What Counts as Squad Costs (INCLUDE)
- Player wages — all contracted first-team players
- Head coach / manager wages
- Agent fees (on transfers and contract renewals)
- Transfer fee amortisation: `transfer_fee ÷ contract_length_in_years` per season
- Transfer fee impairment (if player value drops below purchase price due to injury, performance, or relegation)

#### What Does NOT Count as Squad Costs (EXCLUDE)
- Assistant coaches and coaching staff wages
- Administrative staff wages
- Commercial staff wages
- Academy costs (costs excluded, but academy income IS included in revenue)
- Women's team costs (costs excluded, but women's team income IS included in revenue)

#### What Counts as Football-Related Revenue (INCLUDE)
- Matchday revenue (tickets, hospitality)
- Commercial revenue (shirt sponsors, kit deals, merchandise)
- Central league payments (merit money, facility fees, solidarity payments)
- Domestic cup competition income (FA Cup, EFL Cup)
- European competition income (UEFA Champions League, Europa League, Conference League)
- FIFA Club World Cup income
- Net profit or loss on player sales (sell fee minus book value at time of sale)
- Net profit from non-football stadium events (concerts, events)

#### The Three Compliance Thresholds
```
Green Threshold = 85% of Football-Related Revenue     → Fully compliant
Amber Zone      = Between Green and Red Threshold      → Financial levy, no points deduction
Red Threshold   = Green Threshold × (1 + Allowance %) → Points deduction triggered
```

#### The Allowance and Feedback Loop
Every club starts with a 30% allowance. This means:
```
Initial Red Threshold = 85% × 1.30 = 115% of revenue
```

The Feedback Loop adjusts the allowance each season:
- **Negative Feedback Loop:** If a club's SCR exceeds 85% in the end-of-season Accounts Confirmation Test, the allowance for the following season is reduced by the same percentage as the breach.
  - Example: Club's SCR = 100%. Breach = 15%. Next season allowance = 30% − 15% = 15%. New Red Threshold = 85% × 1.15 = 97.75%
- **Positive Feedback Loop:** If a club is compliant in a season, their allowance recovers by 10% (up to 30% max).
- Unused spending capacity does NOT carry forward to future seasons.
- Allowance cannot go below 0%.

#### Levy Calculation (Amber Zone)
```
Levy = MIN(in_season_overspend, end_of_season_overspend) × overspend_percentage

Example:
  Club overspent by £250,000
  SCR ratio = 89%
  Overspend % = 89% - 85% = 4% = 0.04
  Levy = £250,000 × 0.04 = £10,000
```

#### Points Deduction Formula (Red Zone)
```
Points deduction = 6 + FLOOR((spend_above_red_threshold) ÷ £6,500,000)

Minimum deduction: 6 points
+1 point for every £6.5M spent above the Red Threshold
Deduction imposed in the same season the breach occurred
```

#### SCR Assessment Calendar (encode these dates in the compliance calendar)
| Date | Event |
|------|-------|
| Pre-season (July/August) | Clubs and league agree estimated revenues → sets Green and Red Thresholds for the season |
| 1 October | First in-season monitoring checkpoint |
| 1 March | **Main SCR Compliance Test** (post-winter transfer window) |
| June (post-season) | Accounts Confirmation Test — actual vs estimated figures reconciled |
| October (following season) | Follow-up check for clubs that were above 85% in June |
| 7 July (PL only) | SSR assessments — Working Capital, Liquidity, Positive Equity |
| 31 October (PL promoted clubs) | Liquidity + Positive Equity tests for newly promoted clubs |

### 4.3 Championship-Specific Rules (differences from PL)

The core 85% SCR formula is identical. The differences are:

- **Owner equity top-up:** Championship clubs can receive up to **£33M in owner funding over a three-year rolling period**, with a maximum of **£15M in any single season**. This top-up counts towards revenue for SCR purposes (it supplements the club's income).
- **No SSR tests:** Championship clubs are not subject to the three SSR solvency tests (Working Capital, Liquidity, Positive Equity). Those are PL-only.
- **Revenue context:** Championship club revenues are significantly lower than PL. The engine must clearly show absolute pound values, not just percentages, so a club earning £15M/year understands their Green Threshold is £12.75M in squad costs.
- **Monitoring cadence:** EFL monitors compliance in real-time with a Club Financial Reporting Unit (CFRU). The engine should flag whenever a simulated action would require a mid-season report.

### 4.4 Premier League SSR Tests (PL only — MVP 2.0)

These three tests are assessed on **7 July** each year. Promoted clubs are assessed on **31 October** for tests (ii) and (iii).

#### Test 1 — Working Capital Test (short-term, monthly)
```
For each calendar month in the season:
  Adjusted Cashflow Figure + Qualifying Working Capital Funds ≥ £12,500,000

Qualifying Working Capital Funds include:
  - Undrawn credit facilities
  - Receivables accessible within 28 days
  - Other funds accessible within 28 days
```

#### Test 2 — Liquidity Test (medium-term, covers 2 seasons ahead)
```
Liquidity Headroom = Liquid Assets − Liquid Liabilities − £85,000,000 ≥ 0

Where:
  Liquid Assets include: 40% of squad market value (not book value)
  The £85M Stress Test simulates: relegation, loss of major sponsor, broadcaster contract loss
```

#### Test 3 — Positive Equity Test (long-term, annual)
```
Positive Equity Ratio = Total Liabilities ÷ Adjusted Assets

Thresholds:
  2026/27 season: must be ≤ 90%
  2027/28 season: must be ≤ 85%
  2028/29 onwards: must be ≤ 80%

Adjusted Assets include: full squad market value OR net book value of players (whichever is higher)
Total Liabilities include: ALL balance sheet liabilities, including shareholder loans and external debt
```

SSR non-compliance does not trigger automatic points deductions. It triggers monitoring, required business plan submission, and potential spending restrictions until the club returns to compliance.

### 4.5 UEFA Squad Cost Ratio (future layer — note for architecture)

Premier League clubs competing in European competitions (Champions League, Europa League, Conference League) face UEFA's own SCR on top of the domestic PL SCR. UEFA's limit is **70% of revenue** (vs PL's 85%). This is assessed on a calendar year basis (not seasonal). Nine PL clubs are currently subject to this. Architecture should anticipate a UEFA layer that wraps around the PL engine — do not hard-code PL rules in a way that makes adding a UEFA layer difficult. This is an MVP 3.0 feature.

---

## 5. Technology Stack

### 5.1 Frontend

| Technology | Choice | Reason |
|------------|--------|--------|
| Framework | **React 18 + TypeScript** | Industry standard for complex data-driven B2B apps. TypeScript is non-negotiable — financial calculations where a type error causes a compliance error. |
| Build tool | **Vite** | Fast HMR, modern ESM, significantly faster than CRA |
| UI component library | **shadcn/ui** | Components we own (copied into codebase, not installed as a black box). Built on Radix UI primitives (fully accessible). Perfect for data-dense B2B CFO dashboards. |
| Styling | **Tailwind CSS** | Works seamlessly with shadcn. Utility-first, consistent spacing, no CSS file sprawl. |
| Charts & visualisation | **Recharts** | React-native, handles financial ratio gauges, bar charts, timeline visualisations. Lightweight. |
| Form handling | **React Hook Form + Zod** | Performance-first form handling. Zod for schema validation — every transfer input validated before the calculation engine runs. |
| State management | **Zustand** | Lightweight, no boilerplate. Sufficient for MVP 1.0. No Redux — overkill at this stage. |
| Routing | **React Router v6** | Standard SPA routing. |

### 5.2 Backend

| Technology | Choice | Reason |
|------------|--------|--------|
| Runtime | **Node.js + TypeScript** | Same language as frontend. One language across the stack = faster development, easier hiring. |
| Framework | **Fastify** | Significantly faster than Express. Built-in schema validation (JSON Schema). Better TypeScript support than Express. Request validation is critical for a financial calculation API. |
| API style | **REST** | Straightforward for MVP 1.0 and 2.0. GraphQL not needed until MVP 3.0 with complex nested queries. |
| Validation | **Zod** (shared with frontend) | Share validation schemas between frontend and backend using a `/packages/shared` monorepo folder. |

### 5.3 Database

| Technology | Choice | Reason |
|------------|--------|--------|
| Database | **PostgreSQL** | Relational data is the right model. Clubs → Squads → Players → Contracts → Simulations are inherently relational. |
| Hosted via | **Supabase** | Managed Postgres + built-in auth + row-level security + realtime subscriptions. Zero infrastructure management in year one. Row-level security is critical: Club A must never see Club B's data. |
| ORM | **Prisma** | Type-safe database client. Schema as source of truth. Migrations built in. Works perfectly with Supabase Postgres. |
| Upgrade path | When enterprise clients require data residency (UK hosting, ISO 27001), migrate to **AWS RDS (Postgres)** with zero schema changes. Supabase → RDS is a clean migration path. |

### 5.4 Authentication

| Phase | Technology |
|-------|-----------|
| MVP 1.0 + 2.0 | **Supabase Auth** — email/password, magic links, session management. Free, built-in, no config. |
| MVP 3.0 | **Clerk** or **Auth0** — when enterprise clubs require SAML SSO, Active Directory integration, or multi-org management. |

Multi-tenancy: every database row that belongs to a club must have a `club_id` foreign key. Supabase Row Level Security (RLS) policies enforce that a logged-in user can only access rows belonging to their club. This is enforced at the database level, not just the API level.

### 5.5 Hosting & Infrastructure

| Service | Technology | Reason |
|---------|-----------|--------|
| Frontend hosting | **Vercel** | Zero config, instant deploys, preview URLs for every pull request, edge CDN globally |
| Backend hosting | **Railway** | Simple container hosting, one-click Postgres if not using Supabase, automatic deploys from GitHub, no DevOps burden in year one |
| Upgrade path | **AWS** (ECS + RDS + CloudFront) | When enterprise SLAs, data residency requirements, or ISO 27001 certification is needed |

### 5.6 Project Structure (Monorepo)

```
Headroom/
├── apps/
│   ├── web/                    # React frontend (Vite)
│   └── api/                    # Fastify backend
├── packages/
│   ├── shared/                 # Shared TypeScript types, Zod schemas, validation
│   ├── engine/                 # SCR calculation engine (pure functions, no side effects)
│   └── ui/                     # Shared shadcn/ui components (if needed)
├── prisma/
│   └── schema.prisma           # Database schema
└── package.json                # Turborepo workspace config
```

Use **Turborepo** for monorepo build orchestration.

### 5.7 Testing

| Type | Tool | What to test |
|------|------|-------------|
| Unit tests | **Vitest** | Every single function in `/packages/engine`. The SCR engine must have 100% test coverage. Every known edge case (agent fee treatment, impairment scenarios, promoted club revenue adjustment) must be a test case. |
| Integration tests | **Vitest + Supertest** | API endpoints — test that inputs produce correct database state and correct calculation outputs |
| End-to-end tests | **Playwright** | Critical user flows: login → input transfer → see compliance result → export PDF |

---

## 6. The Calculation Engine — Architecture Rules

This is the most important architectural decision in the entire codebase.

The SCR calculation engine lives in `/packages/engine` and follows these absolute rules:

1. **Pure functions only.** Every function takes explicit inputs and returns outputs. No database calls, no API calls, no `fetch`, no side effects of any kind.
2. **Deterministic.** The same inputs always produce the same outputs. No randomness, no date-dependent logic unless the date is explicitly passed as a parameter.
3. **Fully typed.** Every input and output has a TypeScript interface. No `any`.
4. **Fully tested.** Every function has unit tests. Every edge case from the regulatory documents is a named test case.
5. **League-configurable.** The engine takes a `LeagueConfig` object that defines the thresholds, allowances, and rules for a specific league. Adding a new league (La Liga, Ligue 1) means adding a new config object, not changing engine logic.

### Core Engine Interface (design target)

```typescript
// packages/engine/types.ts

export interface LeagueConfig {
  leagueId: string;                    // 'efl-championship' | 'premier-league' | 'la-liga'
  greenThresholdRatio: number;         // 0.85 for SCR
  initialAllowanceRatio: number;       // 0.30 (gives Red Threshold of 1.15 × green)
  feedbackLoopDecrement: number;       // same as breach %
  feedbackLoopIncrement: number;       // 0.10 per compliant season
  ownerEquityTopUpLimit?: {            // Championship-only
    threeYearRollingMax: number;       // £33,000,000
    singleSeasonMax: number;           // £15,000,000
  };
  pointsDeductionBasePoints: number;   // 6
  pointsDeductionPerUnit: number;      // £6,500,000
  hasSSRTests: boolean;                // false for Championship, true for PL
}

export interface ClubFinancials {
  clubId: string;
  season: string;                      // '2026-27'
  leagueConfig: LeagueConfig;
  footballRelatedRevenue: number;      // total annual revenue in £
  currentSquadCosts: number;           // current total squad costs in £
  currentAllowanceRatio: number;       // club's current allowance (starts at 0.30)
  ownerEquityUsedThreeYear?: number;   // Championship only — how much of £33M used
}

export interface TransferInput {
  transferFee: number;                 // in £
  contractLengthYears: number;         // integer
  annualWage: number;                  // in £ per year (convert from weekly if needed)
  agentFee: number;                    // in £ one-off
  playerSaleProceeds?: number;         // if selling a player simultaneously
  playerSaleBookValue?: number;        // book value of player being sold (for net P&L calc)
}

export interface SCRResult {
  // Current position (before transfer)
  currentSCRRatio: number;
  currentGreenThreshold: number;       // in £
  currentRedThreshold: number;         // in £
  currentStatus: 'green' | 'amber' | 'red';

  // Transfer impact
  annualAmortisation: number;          // transferFee ÷ contractLengthYears
  annualAgentFeeImpact: number;        // agentFee ÷ contractLengthYears (spread over contract)
  totalAnnualCostImpact: number;       // amortisation + annual wage + agent fee spread

  // Projected position (after transfer)
  projectedSquadCosts: number;
  projectedSCRRatio: number;
  projectedStatus: 'green' | 'amber' | 'red';
  headroomRemaining: number;           // £ distance from Green Threshold (negative = breach)
  redThresholdHeadroom: number;        // £ distance from Red Threshold (negative = points deduction)

  // Sanctions (if applicable)
  projectedLevy?: number;              // if amber zone
  projectedPointsDeduction?: number;   // if red zone

  // Amortisation schedule
  amortisationSchedule: Array<{
    season: string;
    amortisationAmount: number;
    remainingBookValue: number;
  }>;
}
```

---

## 7. Database Schema (Target)

```sql
-- Clubs (one row per club)
clubs
  id              uuid PRIMARY KEY
  name            varchar
  short_name      varchar
  league_id       varchar        -- 'efl-championship' | 'premier-league'
  created_at      timestamptz
  updated_at      timestamptz

-- Users (one or more per club)
users
  id              uuid PRIMARY KEY (links to Supabase auth.users)
  club_id         uuid REFERENCES clubs(id)
  role            varchar        -- 'cfo' | 'sporting_director' | 'finance_analyst' | 'admin'
  full_name       varchar
  email           varchar
  created_at      timestamptz

-- Club Financials (one per club per season)
club_financials
  id              uuid PRIMARY KEY
  club_id         uuid REFERENCES clubs(id)
  season          varchar        -- '2026-27'
  football_related_revenue    bigint   -- in pence (avoid float precision issues)
  current_squad_costs         bigint   -- in pence
  current_allowance_ratio     decimal  -- e.g. 0.30
  owner_equity_used_1yr       bigint   -- Championship only
  owner_equity_used_3yr       bigint   -- Championship only
  created_at      timestamptz
  updated_at      timestamptz

-- Players (squad roster)
players
  id              uuid PRIMARY KEY
  club_id         uuid REFERENCES clubs(id)
  name            varchar
  position        varchar
  nationality     varchar
  date_of_birth   date
  created_at      timestamptz

-- Contracts (one active contract per player)
contracts
  id              uuid PRIMARY KEY
  player_id       uuid REFERENCES players(id)
  club_id         uuid REFERENCES clubs(id)
  transfer_fee    bigint         -- in pence (0 if free transfer or academy)
  annual_wage     bigint         -- in pence per year
  contract_start  date
  contract_end    date
  contract_length_years  decimal
  agent_fee       bigint         -- in pence
  book_value      bigint         -- current amortised value
  is_active       boolean
  created_at      timestamptz

-- Simulations (every scenario run by a user — full audit trail)
simulations
  id              uuid PRIMARY KEY
  club_id         uuid REFERENCES clubs(id)
  created_by      uuid REFERENCES users(id)
  season          varchar
  label           varchar        -- user-given name e.g. "Buy Striker X scenario"
  transfer_input  jsonb          -- snapshot of TransferInput at time of simulation
  club_financials_snapshot jsonb -- snapshot of ClubFinancials at time of simulation
  scr_result      jsonb          -- snapshot of SCRResult
  created_at      timestamptz

-- NOTE: Store all monetary values as integers in pence/smallest currency unit.
-- Never use float for money. Convert to pounds only for display.
```

---

## 8. MVP Stages — Detailed Feature Specifications

### MVP 1.0 — Single Transfer Stress Tester
**Timeline:** Months 1–10 from build start
**Target:** 5–8 paying Championship clubs
**Price:** £12,000–15,000/year
**League:** EFL Championship only

This is a lightweight, invite-only web application. Its sole purpose is to answer one question: "If we sign this player on these terms, what happens to our SCR compliance position?" Speed of answer and accuracy of calculation are the only things that matter at this stage.

#### Screens and Features

**1. Authentication**
- Email + password login (Supabase Auth)
- Magic link login option
- No self-signup. Accounts are created by admin.
- Session persistence (stay logged in for 7 days)
- Single club per account — a user sees only their club's data

**2. Club Setup / Onboarding (admin only)**
- Input club's current season financial data:
  - Football-related revenue (£)
  - Current total squad costs (£)
  - Current allowance percentage (default 30% for new clubs)
  - Owner equity top-up used this season (£) and rolling 3-year total (£)
- These figures set the Green Threshold and Red Threshold for the season
- Display calculated thresholds clearly after input

**3. Transfer Simulator (core feature)**
Input form with the following fields:
- Transfer fee (£)
- Contract length (years — integer or half-year)
- Weekly wage (£/week — convert to annual in the engine: × 52)
- Agent fee (£ one-off)
- Toggle: "Simultaneously selling a player?" → if yes, input sale proceeds and player book value

On submit, the engine runs and displays:

**Result panel:**
- Annual amortisation amount (transfer fee ÷ contract years)
- Annual agent fee spread (agent fee ÷ contract years)
- Total annual cost impact (amortisation + annual wage + agent fee spread)
- Current SCR ratio (before transfer) with status badge (green/amber/red)
- Projected SCR ratio (after transfer) with status badge
- Headroom remaining to Green Threshold (in £ and %)
- Headroom remaining to Red Threshold (in £ and %)
- If amber: estimated levy amount
- If red: estimated points deduction and levy
- Full amortisation schedule table (year by year breakdown for the contract length)

**Visual compliance gauge:**
- A horizontal bar showing the spectrum from 0% to 120%
- Markers at 85% (Green Threshold) and at the club's Red Threshold
- A needle or indicator showing current position and projected position after the transfer
- Colour coded: green zone, amber zone, red zone

**4. Simulation History**
- List of all simulations run by the club (all users)
- Columns: date, label, transfer fee, projected SCR, status, created by
- Click any simulation to view the full result again
- Option to give each simulation a custom label ("Summer window — Striker option A")

**5. Export**
- Export any simulation result as a PDF report
- PDF includes: club name, date, all inputs, full result breakdown, amortisation schedule
- Footer disclaimer: "This report is produced by Headroom for decision-support purposes only. It does not constitute legal or financial advice. Clubs should seek independent legal counsel before completing any transfer."

**6. Compliance Calendar (read-only)**
- Display key EFL Championship compliance dates for the current season
- 1 October: Monitoring checkpoint
- 1 March: Main SCR Compliance Test
- End of June: Accounts Confirmation Test
- Transfer window dates (Summer: June 14 – September 1 / Winter: January 1–31 — confirm exact EFL dates each season)
- Simple list view. No interactivity at MVP 1.0.

#### What MVP 1.0 Deliberately Does NOT Include
- Squad-level dashboard (that is MVP 2.0)
- CSV player roster upload (MVP 2.0)
- Multi-user collaboration or roles (MVP 2.0)
- Premier League SCR module (MVP 2.0)
- SSR tests (MVP 2.0)
- API integrations with accounting software (MVP 3.0)
- NLP contract parsing (MVP 3.0)
- AI features (MVP 3.0)
- Benchmarking data (MVP 2.0)

---

### MVP 2.0 — Squad Financial Dashboard
**Timeline:** Months 11–20 from build start
**Target:** 20–30 total clubs (Championship + first PL clients)
**Price:** £20,000–35,000/year
**League:** EFL Championship + Premier League
**Fundraising trigger:** Seed round when ARR reaches £500K

This version transforms the product from a single-transfer tool into a full squad financial management platform. The CFO can now see the entire club's financial position in one view, run multi-player scenarios, and manage compliance across the full season.

#### New Features in 2.0

**1. Squad Roster Management**
- CSV upload of 25-man squad with fields: player name, position, transfer fee, contract start, contract end, weekly wage, agent fee
- Manual add/edit/remove individual players
- Automatic book value calculation for each player based on remaining contract
- Flag players whose contracts expire within 6 months (free transfer planning)
- Archive players who leave (maintain history for audit purposes)

**2. Squad-Level Compliance Dashboard (home screen)**
- Total squad costs (wages + amortisation + agent fees) displayed in £ and as SCR % of revenue
- Visual gauge showing total squad position vs Green and Red Thresholds
- Colour-coded status for the entire squad: green / amber / red
- Breakdown table: each player's individual annual cost impact on SCR
- Sort by: name, position, cost impact, contract expiry

**3. Scenario Builder (drag-and-drop)**
- "What if" workspace where the user can:
  - Add a proposed incoming transfer
  - Mark a player as "sell" and input sale proceeds
  - Mark a player as "release" (remove their costs from SCR with no transfer income)
  - Combine multiple actions in one scenario ("sell Player A for £5M, release Player B, sign Player C for £8M — net impact?")
- Real-time SCR recalculation as the user builds the scenario
- Save named scenarios ("January window plan A", "January window plan B")
- Compare two scenarios side by side

**4. Multi-User Access and Roles**
- CFO role: full access, can create/delete users, approve scenarios
- Sporting Director role: can run simulations and scenarios, read-only on financials
- Finance Analyst role: full access to data entry, cannot change club financial settings
- Invite users by email. They receive a magic link to set up their account.
- All actions logged with user attribution (full audit trail)

**5. Premier League Module**
- Same SCR engine with PL config (85% threshold, PL revenue definitions, no owner equity top-up)
- Three SSR dashboards (Working Capital, Liquidity, Positive Equity)
  - Working Capital: input monthly projected cash + working capital facilities. Show monthly headroom vs £12.5M minimum.
  - Liquidity Test: input liquid assets, liquid liabilities, squad market value. Calculate Liquidity Headroom vs the £85M stress test.
  - Positive Equity: input total liabilities and adjusted assets (including squad market value). Calculate ratio vs 90%/85%/80% threshold tiers.
- SSR status displayed on dashboard with clear warnings when approaching thresholds
- Promoted clubs: calculator for their adjusted revenue (PL revenue uplift estimates applied)

**6. Compliance Calendar (interactive)**
- Full interactive calendar view of all compliance dates
- For each deadline, show the club's current projected status (will we be compliant by this date?)
- Email notifications for upcoming deadlines (7 days before, 1 day before)
- Allow users to add internal notes to calendar events

**7. Benchmarking Layer (anonymised)**
- Once 10+ clubs are on the platform, show anonymised benchmarks
- "Championship clubs at your revenue level have a median SCR of X%"
- "Your wage-to-revenue ratio vs Championship average"
- All data anonymised — no club can identify another club's data
- Opt-in per club. Clubs that contribute data see the benchmarks. Clubs that don't, don't.

**8. PDF and Excel Export**
- Export full squad financial report as PDF (board-ready format)
- Export amortisation schedules for all players as Excel spreadsheet
- Export scenario comparisons as PDF

---

### MVP 3.0 — Enterprise Compliance OS
**Timeline:** Months 21–36 from build start
**Target:** 50+ clubs (UK + La Liga entry)
**Price:** £35,000–60,000/year
**Fundraising trigger:** Series A at approximately £2M ARR

This is the enterprise-grade version. It is funded by the Seed round. Do not attempt to build MVP 3.0 features during MVP 1.0 or 2.0. Every feature listed here requires either ML infrastructure, enterprise security review, legal validation, or all three.

#### New Features in 3.0

**1. AI-Powered Contract Parser (LLM integration)**
- Upload a PDF player contract
- An LLM (Claude API via Anthropic) extracts: weekly wage, bonus clauses (appearance, goals, clean sheets, promotion), sell-on percentage, release clause value, contract length, agent fee, image rights payments
- Extracted data is presented to the user for review and confirmation before being saved
- The user confirms or corrects each extracted field — the AI is an accelerator, not the final authority
- Structured data is saved directly into the player's contract record
- This is the first LLM integration in the product — architecture must be ready for this from day one (see Section 9)

**2. Automated Regulatory Document Ingestion**
- A background pipeline that monitors the Premier League Handbook, EFL Handbook, and UEFA regulations for changes
- When a change is detected (e.g., threshold adjustment, new rule added), an internal alert is raised for review
- After human review and confirmation, the new rule config is deployed to the engine
- This is NOT fully automated — human review is mandatory before any rule change is deployed. The liability risk of an automated rule update is too high.

**3. Accounting Software Integration**
- Read-only API connections to:
  - **Xero** — pull actual wage payments, verify against contract data
  - **Sage** — same
  - **SAP (lite)** — for larger PL clubs
- Integration is read-only at launch. The tool never writes to accounting software.
- Financial data syncs automatically each month. Discrepancies between accounting data and contract data are flagged for review.
- This feature requires enterprise security review, penetration testing, and SOC 2 compliance preparation.

**4. La Liga Module**
- Individual salary cap (LCPD — Límite de Coste de la Plantilla Deportiva) calculation
- Each club receives a unique cap from La Liga based on projected revenues minus non-sporting expenses
- Published twice per season (pre-season and January)
- The engine must handle: variable caps per club, mid-season cap updates, different definitions of "squad costs" vs SCR
- Documentation is in Spanish — requires regulatory research partnership with a Spanish sports law firm

**5. UEFA FSR Layer**
- For PL clubs in European competition: add UEFA Squad Cost Ratio (70% limit) on top of domestic PL SCR
- UEFA assesses on a calendar year basis (not seasonal like PL)
- Show clubs their position under both PL SCR and UEFA SCR simultaneously — the dual-jurisdiction view
- This requires legal partnership with a UEFA regulations specialist to validate calculation methodology

**6. Full Audit Trail and Regulatory Export**
- Every simulation, scenario, and compliance check is stored permanently
- Exportable in a format suitable for submission to the EFL or Premier League during a compliance inquiry
- Digital timestamps and user attribution on every action
- Tamper-evident log (append-only, no deletions permitted)

**7. Automated Breach Alerts**
- Real-time monitoring of squad costs throughout the season
- Alert triggers: "Your SCR ratio will breach 85% if you sign another player before January 31"
- Alert channels: in-app notification, email, optional SMS
- Alert severity levels: info (approaching amber), warning (in amber), critical (approaching red)

**8. White-Label Option**
- Large football law firms and sports agencies can license the platform under their own brand
- Separate branding config per white-label client
- Revenue share model: 70/30 (Headroom/partner)

---

## 9. AI and LLM Architecture — Future-Proofing from Day One

LLM features are not in MVP 1.0 or 2.0. However, the architecture must be designed from day one to accommodate them without major refactoring. Here is what to anticipate:

### Planned LLM Features (MVP 3.0 and beyond)

1. **Contract PDF Parser** — Claude API parses player contracts to extract financial terms
2. **Compliance Explainer** — "Explain in plain English why this transfer puts us in the amber zone" — LLM explains the calculation result in non-technical language for board presentations
3. **Transfer Recommendation Engine** — Given a club's current SCR position and squad structure, suggest the optimal sell price or contract terms to stay compliant
4. **Regulatory Change Summariser** — When the EFL or PL updates their handbook, an LLM summarises what changed and what the impact is for each club
5. **Scenario Narrative Generator** — Automatically write a board-level narrative around a saved scenario ("If we execute Plan B in January, here is our projected financial position and regulatory risk")

### Architecture Requirements for LLM Readiness

- **Keep the calculation engine pure and separate.** LLMs must call the engine as a tool — they must never do the maths themselves. The engine output is deterministic and auditable; LLM output is not. LLMs are for language, explanation, and extraction. The engine is for numbers.
- **Design an AI service layer** (`/apps/api/src/services/ai/`) from day one — even if it is empty in MVP 1.0. When LLM features are added in MVP 3.0, they slot into this service layer without touching the engine or the API routes.
- **Use the Anthropic Claude API** (`claude-sonnet-4-20250514` or later) as the primary LLM provider. Do not build against OpenAI or Google as primary — Anthropic's document understanding and structured output capabilities are best suited for contract parsing.
- **Every LLM call must go through a human confirmation step** before any extracted data is saved to the database. LLMs make mistakes. In a financial compliance tool, a mistake can be very expensive.
- **Log all LLM inputs and outputs** for debugging, audit, and model improvement purposes.

---

## 10. Design System and Visual Language

The product is used by CFOs and Finance Directors at professional football clubs. The aesthetic must communicate precision, professionalism, and trust. It is not a consumer app. It is not flashy or gamified. It is a financial instrument.

### Design Principles

1. **Data density over whitespace** — CFOs want to see numbers, not large empty spaces. Pack meaningful information into every screen without clutter.
2. **Compliance status is always visible** — the current SCR status (green/amber/red) should be visible on every screen, not buried on a sub-page.
3. **Numbers are the hero** — typography and layout must make financial figures easy to scan and compare. Monospace fonts for all numbers.
4. **Conservative and trustworthy** — dark or neutral colour palette. The accent colour is green (compliance = green = safe). Avoid anything that looks playful or consumer-facing.
5. **Clarity under pressure** — CFOs use this tool during transfer windows at 11pm. Every screen must be immediately understandable without reading instructions.

### Colour Palette (Tailwind classes)

```
Background:      slate-950 (#0b0e17)
Surface:         slate-900 / white 4% opacity cards
Border:          slate-800 (subtle) / slate-700 (emphasis)
Text primary:    slate-100
Text secondary:  slate-400
Text muted:      slate-600

Status — Green (compliant):   green-500 (#22c55e)    background: green-500/12
Status — Amber (levy zone):   amber-500 (#f59e0b)    background: amber-500/12
Status — Red (points risk):   red-500 (#ef4444)      background: red-500/10

Accent (interactive):         green-500
Accent hover:                 green-400
Links:                        blue-400
Charts:                       green-500, amber-500, red-500, blue-500, slate-500
```

### Typography

```
Headings:    Georgia or system serif — professional, editorial weight
Body:        system-ui / Inter — clean, readable at small sizes
Numbers:     'Courier New' / JetBrains Mono — monospace for all financial figures
Labels:      Uppercase, letter-spaced, 10–11px — used for field labels and section headers
```

### Component Conventions (shadcn/ui)

- **Cards:** rounded-xl, border border-slate-800, bg-slate-900 — all data sections live in cards
- **Badges:** pill-shaped status indicators — green/amber/red with matching background tint
- **Tables:** no zebra striping. Subtle row borders. Monospace numbers. Right-aligned number columns.
- **Forms:** label above input, always. No placeholder-as-label. Zod validation errors shown inline below the input, in red-400.
- **Buttons:** primary = green-600, hover green-500. Secondary = slate-700 border. Destructive = red-600.
- **Charts:** recharts with custom styling matching the colour palette. No chart junk (no unnecessary gridlines, no 3D effects).

### Layout

- Max content width: 1280px, centred
- Sidebar navigation (fixed left, 240px wide) for logged-in app
- Top bar: club name, current SCR status badge, user avatar
- Main content area: right of sidebar, full height
- Mobile: the app is desktop-first. It is used on laptops and monitors, not phones. Minimum supported viewport: 1024px. We do not need a mobile-optimised layout at MVP 1.0 or 2.0.

---

## 11. League Expansion Roadmap

The engine is built league-agnostic from day one. A `LeagueConfig` object defines all thresholds and rules for a given league. Adding a new league means:
1. Research the league's financial regulations
2. Write a new `LeagueConfig` object
3. Write unit tests for that league's edge cases
4. Add the league to the database and UI league selector
5. No changes to core engine logic

### Planned Expansion Order

| Phase | League | Regulatory System | Timeline |
|-------|--------|------------------|----------|
| 1 (now) | EFL Championship | SCR 85%, £33M top-up | MVP 1.0 |
| 2 | Premier League | SCR 85% + SSR 3 tests | MVP 2.0 |
| 3 | La Liga | LCPD individual caps | MVP 3.0 |
| 4 | Ligue 1 | DNCG solvency + UEFA | Post Series A |
| 5 | Serie A | FIGC + UEFA | Post Series A |
| Future | Bundesliga, Eredivisie, Liga Portugal | Various | TBD |

---

## 12. Security and Compliance Requirements

- **Multi-tenancy isolation:** Club A cannot access Club B's data under any circumstances. Enforced via Supabase RLS at the database level and validated in API middleware.
- **Encryption at rest:** Supabase encrypts all data at rest by default.
- **Encryption in transit:** HTTPS only. No HTTP endpoints.
- **No logging of sensitive financial data** to console or external logging services. Log request metadata only.
- **Monetary values stored as integers** (pence / smallest currency unit) throughout the system. Never use JavaScript `float` or database `float` for money. Use `bigint` in the database and `number` (integer pence) in TypeScript, converting to pounds only for display.
- **Audit log:** Every write operation (create, update, delete) is logged to an append-only audit table with: timestamp, user_id, club_id, table_name, record_id, action, previous_value, new_value.
- **Rate limiting:** All API endpoints rate-limited via Fastify rate-limit plugin. Calculation endpoints: max 30 requests/minute per user.

---

## 13. Key Constraints and Non-Negotiables

1. **The calculation engine is pure.** No exceptions. No database calls inside the engine.
2. **Money is always stored and calculated as integers** (pence). Display conversion happens at the presentation layer only.
3. **Every simulation is saved.** Never throw away a calculation result. The audit trail is a product feature and a legal protection.
4. **Every screen shows the legal disclaimer.** Footer on every page: "Headroom is a decision-support tool. It does not constitute legal or financial advice."
5. **The league config is data-driven, never hard-coded.** Regulatory thresholds live in a config object, not in if-statements. When the EFL changes the threshold from 85% to 80%, it is a config update, not a code change.
6. **LLMs never do arithmetic.** When AI features are added, LLMs call the engine as a tool. The engine does the maths. The LLM explains, summarises, and extracts. Never let an LLM calculate an SCR ratio.

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| SCR | Squad Cost Ratio — total squad costs as a percentage of football-related revenue |
| SSR | Sustainability and Systemic Resilience — three PL solvency tests |
| PSR | Profitability and Sustainability Rules — old PL/EFL rule, replaced by SCR from 2026/27 |
| Green Threshold | 85% of revenue — the primary compliance limit |
| Red Threshold | Green Threshold × (1 + allowance %) — points deduction triggered above this |
| Allowance | % headroom above Green Threshold before Red Threshold, starts at 30% |
| Feedback Loop | Mechanism by which the allowance shrinks each season a club breaches 85% |
| Amortisation | Transfer fee spread across contract years for accounting/compliance purposes |
| Impairment | Reduction in player book value below original transfer fee |
| ACV | Annual Contract Value — yearly subscription revenue per club |
| ARR | Annual Recurring Revenue — total yearly subscription revenue across all clubs |
| EFL | English Football League — governs Championship, League One, League Two |
| CFRU | Club Financial Reporting Unit — EFL body that monitors club finances in real-time |
| LCPD | La Liga individual salary cap (Límite de Coste de la Plantilla Deportiva) |
| DNCG | French financial regulator for professional football clubs |
| UEFA FSR | UEFA Financial Sustainability Regulations — includes UEFA's own 70% SCR |
