-- Admin panel support tables (operational; not part of the Prisma domain model,
-- mirroring how chat.sql / rag.sql live as standalone SQL). Idempotent + additive,
-- safe to run against the live Supabase DB repeatedly. RLS enabled with NO policy
-- so only the service-role key (used by the API + admin panel) can touch them.

create extension if not exists pgcrypto;

-- ── league table snapshots ─────────────────────────────────────────────────
-- Each admin "update league table" run stores a snapshot here. The app's
-- /league-table route serves the newest ACTIVE snapshot per league (falling back
-- to a live fetch, then the bundled seed). Gives real update + make-active +
-- full history with timestamps.
create table if not exists league_table_snapshots (
  id          uuid        primary key default gen_random_uuid(),
  league_id   text        not null,          -- 'premier-league' | 'efl-championship'
  competition text        not null,
  season      text        not null,
  source      text        not null,          -- 'live' | 'fallback'
  standings   jsonb       not null,          -- LeagueTableRow[]
  is_active   boolean     not null default true,
  fetched_at  timestamptz not null default now()
);
create index if not exists league_table_snapshots_active_idx
  on league_table_snapshots (league_id, is_active, fetched_at desc);

alter table league_table_snapshots enable row level security;

-- ── balance top-up ──────────────────────────────────────────────────────────
-- Float-safe additive top-up of a user's AI credit. Arithmetic stays in NUMERIC
-- and is rounded to 4 dp (no drift). Returns the new balance.
create or replace function admin_topup_balance(p_user_id text, p_amount numeric)
returns numeric
language sql
as $$
  update users
  set ai_balance_usd = greatest(0, round(ai_balance_usd + p_amount, 4))
  where id = p_user_id
  returning ai_balance_usd;
$$;
