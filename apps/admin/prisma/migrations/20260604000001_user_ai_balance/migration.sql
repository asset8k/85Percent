-- AI credit balance (Compliance Analyst) — a hardcoded prepaid USD balance per
-- user, debited per query at Anthropic Sonnet token cost + a 10% margin. Top-ups
-- are manual (admin DB edit) until a payment gateway exists.
--
-- Additive + idempotent, so it is safe to run against the live Supabase database
-- more than once. NOT auto-applied by the runtime (the app uses the Supabase
-- client at runtime; Prisma only models the schema).

-- ── columns ──────────────────────────────────────────────────────────────
-- NUMERIC(10,4) keeps the balance exact (no floating-point drift) with room for
-- sub-cent per-query debits. Every user starts with $5.00.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_balance_usd"       NUMERIC(10,4) NOT NULL DEFAULT 5.00;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "total_ai_tokens_used" INTEGER       NOT NULL DEFAULT 0;

-- ── atomic debit ─────────────────────────────────────────────────────────
-- One round-trip that subtracts the query cost and adds the tokens consumed.
-- All arithmetic stays in Postgres NUMERIC, the result is ROUNDed to 4 dp and
-- floored at 0 — so a balance can never go negative or land on a noisy value
-- like 4.81999999. Returns the new balance.
CREATE OR REPLACE FUNCTION deduct_ai_balance(p_user_id text, p_cost numeric, p_tokens integer)
RETURNS numeric
LANGUAGE sql
AS $$
  UPDATE users
  SET ai_balance_usd       = GREATEST(0, ROUND(ai_balance_usd - GREATEST(0, p_cost), 4)),
      total_ai_tokens_used = total_ai_tokens_used + GREATEST(0, p_tokens)
  WHERE id = p_user_id
  RETURNING ai_balance_usd;
$$;
