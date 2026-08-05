-- ============================================================================
-- 85Percent — BASELINE SCHEMA (migration 1 of 2)
-- ----------------------------------------------------------------------------
-- Full relational schema, generated from the live DEV database
-- (`prisma migrate diff --from-empty --to-url <dev> --script`), so it is an
-- exact mirror of what Prisma + the raw RAG SQL have provisioned in dev —
-- including the AI/RAG tables (documents and chat_*) that live outside
-- prisma/schema.prisma.
--
-- Apply order: this file FIRST (tables), then the *_security_lockdown.sql
-- migration (RLS + policies + current_club_id()).
--
-- NOTE ON SOURCE OF TRUTH: the relational schema is owned by Prisma
-- (apps/admin/prisma). This baseline exists so the Supabase CLI can bootstrap a
-- brand-new EMPTY project (the prod project) in one `supabase db push`. For an
-- existing Prisma-migrated DB (like dev), DO NOT run this — use
-- `prisma migrate deploy`. See DEPLOYMENT_SOP.md.
-- ============================================================================

-- pgvector powers the documents.embedding column (RAG retrieval). Must exist
-- before the tables are created. pgcrypto provides gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."Currency" AS ENUM ('GBP', 'EUR', 'USD');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."TemplateLeague" AS ENUM ('PREMIER_LEAGUE', 'CHAMPIONSHIP');

-- CreateEnum
CREATE TYPE "public"."TemplatePosition" AS ENUM ('GK', 'DEF', 'MID', 'FWD');

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previous_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chat_messages" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chat_sessions" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."club_financials" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "football_related_revenue" BIGINT NOT NULL,
    "current_allowance_ratio" DECIMAL(65,30) NOT NULL,
    "owner_equity_used_1yr" BIGINT,
    "owner_equity_used_3yr" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "season_start_date" TIMESTAMP(3),
    "season_end_date" TIMESTAMP(3),
    "squad_costs_mode" TEXT NOT NULL DEFAULT 'derived',
    "manual_squad_costs" BIGINT,

    CONSTRAINT "club_financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."clubs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "logo_url" TEXT,
    "base_currency" "public"."Currency" NOT NULL DEFAULT 'GBP',
    "currency_is_custom" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contracts" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "transfer_fee" BIGINT NOT NULL,
    "annual_wage" BIGINT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "contract_length_years" DECIMAL(65,30) NOT NULL,
    "agent_fee" BIGINT NOT NULL,
    "book_value" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phase_type" TEXT NOT NULL DEFAULT 'INITIAL',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "superseded_at" TIMESTAMP(3),
    "carried_book_value" BIGINT,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."demo_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "full_name" TEXT,
    "work_email" TEXT NOT NULL,
    "club" TEXT,
    "role" TEXT,
    "message" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content" TEXT NOT NULL,
    "embedding" vector(384),
    "source_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invites" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "can_edit_roster" BOOLEAN NOT NULL DEFAULT false,
    "can_edit_scenarios" BOOLEAN NOT NULL DEFAULT false,
    "is_workspace_admin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."league_table_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" TEXT NOT NULL,
    "competition" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "standings" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_table_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."manager_contracts" (
    "id" TEXT NOT NULL,
    "manager_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "compensation_fee" BIGINT NOT NULL,
    "annual_wage" BIGINT NOT NULL,
    "agent_fee" BIGINT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "contract_length_years" DECIMAL(65,30) NOT NULL,
    "book_value" BIGINT NOT NULL,
    "phase_type" TEXT NOT NULL DEFAULT 'INITIAL',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."managers" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "nationality" TEXT,

    CONSTRAINT "managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "user_id" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL DEFAULT 'INFO',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."players" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "nationality" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "squad_number" INTEGER,
    "joined_date" TIMESTAMP(3),

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scenario_actions" (
    "id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "player_id" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scenarios" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_included" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ssr_equity" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "total_liabilities" BIGINT NOT NULL,
    "adjusted_assets" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssr_equity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ssr_liquidity" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "liquid_assets" BIGINT NOT NULL,
    "liquid_liabilities" BIGINT NOT NULL,
    "squad_market_value" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssr_liquidity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ssr_working_capital" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "year_month" TEXT NOT NULL,
    "adjusted_cashflow" BIGINT NOT NULL,
    "qualifying_funds" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssr_working_capital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."template_clubs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "league" "public"."TemplateLeague" NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."template_roster_items" (
    "id" TEXT NOT NULL,
    "template_club_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "nationality" TEXT,
    "position" "public"."TemplatePosition",
    "is_manager" BOOLEAN NOT NULL DEFAULT false,
    "estimated_transfer_fee" BIGINT,
    "contract_start" TIMESTAMP(3),
    "contract_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "squad_number" INTEGER,
    "contract_start_from_extension" BOOLEAN NOT NULL DEFAULT false,
    "joined_date" TIMESTAMP(3),

    CONSTRAINT "template_roster_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totp_secret" TEXT,
    "is_totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "title" TEXT,
    "can_edit_roster" BOOLEAN NOT NULL DEFAULT false,
    "can_edit_scenarios" BOOLEAN NOT NULL DEFAULT false,
    "is_workspace_admin" BOOLEAN NOT NULL DEFAULT false,
    "ai_balance_usd" DECIMAL(10,4) NOT NULL DEFAULT 5.00,
    "total_ai_tokens_used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_session_idx" ON "public"."chat_messages"("session_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "chat_sessions_user_idx" ON "public"."chat_sessions"("user_id" ASC, "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "club_financials_club_id_season_key" ON "public"."club_financials"("club_id" ASC, "season" ASC);

-- CreateIndex
CREATE INDEX "contracts_club_id_is_active_idx" ON "public"."contracts"("club_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE INDEX "contracts_player_id_is_active_idx" ON "public"."contracts"("player_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE INDEX "contracts_player_id_is_current_idx" ON "public"."contracts"("player_id" ASC, "is_current" ASC);

-- CreateIndex
CREATE INDEX "demo_requests_created_at_idx" ON "public"."demo_requests"("created_at" DESC);

-- CreateIndex
CREATE INDEX "documents_embedding_hnsw" ON "public"."documents"("embedding" ASC);

-- CreateIndex
CREATE INDEX "invites_email_accepted_at_idx" ON "public"."invites"("email" ASC, "accepted_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_key" ON "public"."invites"("token" ASC);

-- CreateIndex
CREATE INDEX "league_table_snapshots_active_idx" ON "public"."league_table_snapshots"("league_id" ASC, "is_active" ASC, "fetched_at" DESC);

-- CreateIndex
CREATE INDEX "manager_contracts_club_id_idx" ON "public"."manager_contracts"("club_id" ASC);

-- CreateIndex
CREATE INDEX "manager_contracts_manager_id_is_current_idx" ON "public"."manager_contracts"("manager_id" ASC, "is_current" ASC);

-- CreateIndex
CREATE INDEX "managers_club_id_is_active_idx" ON "public"."managers"("club_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE INDEX "notifications_club_id_created_at_idx" ON "public"."notifications"("club_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "public"."notifications"("user_id" ASC, "is_read" ASC);

-- CreateIndex
CREATE INDEX "players_club_id_is_active_idx" ON "public"."players"("club_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE INDEX "scenario_actions_scenario_id_order_index_idx" ON "public"."scenario_actions"("scenario_id" ASC, "order_index" ASC);

-- CreateIndex
CREATE INDEX "scenarios_club_id_season_idx" ON "public"."scenarios"("club_id" ASC, "season" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ssr_equity_club_id_season_key" ON "public"."ssr_equity"("club_id" ASC, "season" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ssr_liquidity_club_id_season_key" ON "public"."ssr_liquidity"("club_id" ASC, "season" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ssr_working_capital_club_id_season_year_month_key" ON "public"."ssr_working_capital"("club_id" ASC, "season" ASC, "year_month" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "template_clubs_name_key" ON "public"."template_clubs"("name" ASC);

-- CreateIndex
CREATE INDEX "template_roster_items_template_club_id_idx" ON "public"."template_roster_items"("template_club_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."club_financials" ADD CONSTRAINT "club_financials_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contracts" ADD CONSTRAINT "contracts_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contracts" ADD CONSTRAINT "contracts_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invites" ADD CONSTRAINT "invites_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manager_contracts" ADD CONSTRAINT "manager_contracts_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manager_contracts" ADD CONSTRAINT "manager_contracts_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."managers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."managers" ADD CONSTRAINT "managers_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."players" ADD CONSTRAINT "players_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scenario_actions" ADD CONSTRAINT "scenario_actions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scenario_actions" ADD CONSTRAINT "scenario_actions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scenarios" ADD CONSTRAINT "scenarios_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scenarios" ADD CONSTRAINT "scenarios_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ssr_equity" ADD CONSTRAINT "ssr_equity_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ssr_liquidity" ADD CONSTRAINT "ssr_liquidity_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ssr_working_capital" ADD CONSTRAINT "ssr_working_capital_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."template_roster_items" ADD CONSTRAINT "template_roster_items_template_club_id_fkey" FOREIGN KEY ("template_club_id") REFERENCES "public"."template_clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
