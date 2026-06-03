-- ===========================================================================
-- Headroom — RAG knowledge base (pgvector)
-- ===========================================================================
-- Apply this in the Supabase SQL editor (Dashboard → SQL → New query → Run),
-- the same way rls.sql is applied. It is idempotent — safe to re-run.
--
-- This powers the "Expert Co-pilot" AI feature. The `documents` table holds
-- semantically-chunked passages of the grounding source (the November 2025
-- Premier League financial-system explainer) plus their embeddings. The chat
-- route embeds the user's question with the SAME local model (all-MiniLM-L6-v2,
-- 384 dims) and calls match_documents() to retrieve the most relevant passages.
--
-- The deterministic SCR/FFP engine is NEVER involved here — retrieval only
-- feeds *language context* to the LLM; the maths stays in @headroom/engine.
-- ===========================================================================

-- 1. pgvector --------------------------------------------------------------
create extension if not exists vector;

-- 2. documents table -------------------------------------------------------
-- 384 dims = all-MiniLM-L6-v2 (sentence-transformers), the model used by both
-- the ingest script and the request-time query embedding. If you ever switch
-- embedding models, the dimension here MUST match the model's output size.
create table if not exists public.documents (
  id         uuid        primary key default gen_random_uuid(),
  content    text        not null,
  embedding  vector(384),
  source_url text        not null,
  created_at timestamptz not null default now()
);

-- Approximate-nearest-neighbour index for cosine distance. HNSW gives good
-- recall/latency for a small corpus; for a single document it's overkill but
-- harmless and future-proofs a growing knowledge base.
create index if not exists documents_embedding_hnsw
  on public.documents
  using hnsw (embedding vector_cosine_ops);

-- 3. similarity search RPC -------------------------------------------------
-- Returns the top `match_count` passages ranked by cosine similarity to the
-- query embedding. Called from apps/api/src/routes/chat.ts via supabase.rpc().
create or replace function public.match_documents(
  query_embedding vector(384),
  match_count     int default 5
)
returns table (
  id         uuid,
  content    text,
  source_url text,
  similarity float
)
language sql
stable
as $$
  select
    d.id,
    d.content,
    d.source_url,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.embedding is not null
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- 4. RLS -------------------------------------------------------------------
-- The knowledge base is identical for every tenant and is read ONLY by the API
-- using the service-role key (which bypasses RLS). Enabling RLS with no policy
-- means no anon/auth client key can ever read or write it — same lock-down used
-- for the onboarding template tables. Resolves the Supabase "RLS Disabled in
-- Public" advisor.
alter table public.documents enable row level security;

-- The RPC is SECURITY INVOKER by default; the service-role caller bypasses RLS,
-- so match_documents() works from the API while staying closed to client keys.
grant execute on function public.match_documents(vector, int) to service_role;
