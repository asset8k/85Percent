# Headroom — MVP 1.0 Implementation Plan

## Status Legend
- [ ] Not started
- [x] Complete
- [~] In progress

---

## Phase 0 — Project Bootstrap

- [x] **Step 0.1** — Initialize monorepo with Turborepo + pnpm workspaces
- [x] **Step 0.2** — Create workspace structure: `apps/web`, `apps/api`, `packages/shared`, `packages/engine`
- [x] **Step 0.3** — Root `package.json`, `turbo.json`, `tsconfig.base.json`, `.gitignore`
- [x] **Step 0.4** — Set up Prettier config at root

---

## Phase 1 — Shared Package (`packages/shared`)

- [x] **Step 1.1** — TypeScript types: `LeagueConfig`, `ClubFinancials`, `TransferInput`, `SCRResult`
- [x] **Step 1.2** — Zod schemas for all types (used for validation on both FE and BE)
- [x] **Step 1.3** — EFL Championship + Premier League `LeagueConfig` constants
- [x] **Step 1.4** — Utility: pence ↔ pounds display helpers, weekly wage conversion

---

## Phase 2 — Calculation Engine (`packages/engine`)

- [x] **Step 2.1** — `calculateThresholds(financials)` — Green/Red threshold computation
- [x] **Step 2.2** — `generateAmortisationSchedule()` — year-by-year table
- [x] **Step 2.3** — `calculateSCR(financials, transfer)` — full `SCRResult` output
- [x] **Step 2.4** — `calculateLevy()` — Amber zone levy formula
- [x] **Step 2.5** — `calculatePointsDeduction()` — Red zone points formula
- [x] **Step 2.6** — `calculateAllowanceUpdate()` — Feedback loop
- [x] **Step 2.7** — `determineStatus()` — green/amber/red classification
- [x] **Step 2.8** — Vitest unit tests — 39 tests, all passing

---

## Phase 3 — Database Schema

- [x] **Step 3.1** — Prisma schema: `clubs`, `users`, `club_financials`, `players`, `contracts`, `simulations`, `audit_logs`
- [x] **Step 3.2** — All monetary values as `BigInt` (pence)
- [x] **Step 3.3** — Supabase project setup instructions in README
- [ ] **Step 3.4** — RLS policy definitions (SQL) — manual step for Supabase dashboard

---

## Phase 4 — API Backend (`apps/api`)

- [x] **Step 4.1** — Fastify app setup: TypeScript, plugins (cors, helmet, rate-limit)
- [x] **Step 4.2** — Supabase client + auth middleware (validate JWT from Supabase)
- [x] **Step 4.3** — Club middleware (attach `club_id` + `role` to every request)
- [x] **Step 4.5** — Route: `GET /club/financials` — get current season financials
- [x] **Step 4.6** — Route: `PUT /club/financials` — update club season data (admin/cfo/analyst)
- [x] **Step 4.7** — Route: `POST /simulations` — run engine + save result
- [x] **Step 4.8** — Route: `GET /simulations` — list all simulations for club (paginated)
- [x] **Step 4.9** — Route: `GET /simulations/:id` — get single simulation
- [x] **Step 4.10** — Route: `PATCH /simulations/:id/label` — update simulation label
- [x] **Step 4.11** — Rate limiting (30 req/min on /simulations POST)
- [x] **Step 4.12** — AI service layer stub `/services/ai/` (empty, architecture placeholder)

---

## Phase 5 — Frontend (`apps/web`)

### 5.1 Foundation
- [x] **Step 5.1.1** — Vite + React 18 + TypeScript project setup
- [x] **Step 5.1.2** — Tailwind CSS config with slate-950 bg, green-500 accent, dark design tokens
- [x] **Step 5.1.3** — React Router v6, Zustand, React Hook Form, Zod, Recharts installed
- [x] **Step 5.1.4** — Global layout: sidebar (240px fixed), main content area with footer
- [x] **Step 5.1.5** — Design tokens wired in Tailwind config
- [x] **Step 5.1.6** — Monospace font (JetBrains Mono) for all financial figures
- [x] **Step 5.1.7** — Footer with legal disclaimer on every page (AppLayout)

### 5.2 Auth Screens
- [x] **Step 5.2.1** — Login page (email/password + magic link tabs)
- [x] **Step 5.2.2** — Supabase Auth client integration
- [x] **Step 5.2.3** — Auth store (Zustand) with session persistence
- [x] **Step 5.2.4** — ProtectedRoute wrapper with auto-redirect

### 5.3 Club Onboarding (Admin)
- [x] **Step 5.3.1** — Club setup form: revenue, squad costs, allowance, owner equity
- [x] **Step 5.3.2** — Live threshold preview (Green + Red) as user types
- [x] **Step 5.3.3** — Form validation (Zod + React Hook Form)

### 5.4 Transfer Simulator (core)
- [x] **Step 5.4.1** — Input form: transfer fee, contract length, weekly wage, agent fee, player sale toggle
- [x] **Step 5.4.2** — Weekly → annual wage conversion (× 52) via `weeklyWageToAnnualPence`
- [x] **Step 5.4.3** — Zod form validation before API call
- [x] **Step 5.4.4** — API call to `POST /simulations`
- [x] **Step 5.4.5** — SCRResultPanel: amortisation, agent fee spread, total annual cost
- [x] **Step 5.4.6** — StatusBadge: current SCR (before) + projected SCR (after)
- [x] **Step 5.4.7** — Headroom displays: distance to Green Threshold and Red Threshold in £
- [x] **Step 5.4.8** — Levy display (Amber zone) with AlertTriangle icon
- [x] **Step 5.4.9** — Points deduction display (Red zone) with TrendingDown icon
- [x] **Step 5.4.10** — AmortisationTable: year-by-year breakdown
- [x] **Step 5.4.11** — ComplianceGauge: Recharts bar chart with reference lines at 85% / Red Threshold
- [x] **Step 5.4.12** — Simulation label input + saved simulation link

### 5.5 Simulation History
- [x] **Step 5.5.1** — Table: date, label, transfer fee, projected SCR, status, created by
- [x] **Step 5.5.2** — Click-through to full simulation detail view (SCRResultPanel reuse)
- [x] **Step 5.5.3** — Label edit on detail view, pagination structure

### 5.6 PDF Export
- [x] **Step 5.6.1** — jsPDF + jspdf-autotable PDF generation
- [x] **Step 5.6.2** — Content: club name, date, all inputs, full result, amortisation schedule
- [x] **Step 5.6.3** — Footer disclaimer on every page of PDF

### 5.7 Compliance Calendar
- [x] **Step 5.7.1** — 10 EFL Championship compliance events for 2026/27
- [x] **Step 5.7.2** — Read-only timeline display with type badges

---

## Phase 6 — Integration & Polish

- [ ] **Step 6.1** — End-to-end flow test: login → setup → simulate → history → export
- [ ] **Step 6.2** — RLS policies applied in Supabase dashboard
- [ ] **Step 6.3** — Initial club + user seed via Supabase admin
- [ ] **Step 6.4** — Prisma migration run against live DB
- [ ] **Step 6.5** — Deploy API to Railway, web to Vercel

---

## Phase 7 — Visual Redesign

- [x] **Step 7.1** — Replace dark slate/green theme with light white/violet theme
- [x] **Step 7.2** — New CSS design system: `.num`, `.meta-label`, `.gauge-track`, `.zone`, `.toggle`, `.spin`
- [x] **Step 7.3** — Replace Recharts ComplianceGauge with pure CSS/SVG gauge
- [x] **Step 7.4** — Redesign all UI primitives (Card, Button, Badge, Input, Label, Separator)
- [x] **Step 7.5** — Redesign AppLayout + Sidebar (sticky white sidebar, TopBar with SCR pill)
- [x] **Step 7.6** — Redesign all pages (Login, Simulator, History, Calendar, Settings)
- [x] **Step 7.7** — Typecheck clean (0 errors)

---

## Current Status

**Last completed:** Phase 7 — Complete visual redesign applied, 0 TypeScript errors

**Next step:** Step 6.1 — End-to-end flow test: login → setup → simulate → history → export

**Blocking:** None — Supabase credentials are in place, servers can be started with `pnpm dev`

---

## Key Decisions Log

| Decision | Rationale |
|----------|-----------|
| pnpm workspaces + Turborepo | Monorepo standard for this stack |
| All money in pence (integers) | Avoid float precision errors in financial calculations |
| Engine is pure functions only | Deterministic, testable, audit-safe |
| Supabase for auth + DB | Zero infrastructure burden in year one |
| shadcn/ui components | Owned components, built on Radix (accessible) |
| Recharts for compliance gauge | React-native, lightweight, customisable |
