-- ===========================================================================
-- Headroom — Compliance Analyst chat history (backend-persisted)
-- ===========================================================================
-- Apply in the Supabase SQL editor (or via `prisma db execute`), like rls.sql /
-- rag.sql. Idempotent — safe to re-run.
--
-- Chat history is PER USER within a club. The service-role API enforces the
-- user_id filter; RLS here is the club-scoped backstop (mirrors every other
-- tenant table) so no anon/auth key can read across clubs.
--
-- NOTE: ids are TEXT (not uuid) to match the rest of the schema — Prisma maps
-- `String @default(uuid())` to text, and current_club_id() returns text, so the
-- RLS comparisons must be text = text.
-- ===========================================================================

create table if not exists public.chat_sessions (
  id         text        primary key,            -- client-generated uuid string
  club_id    text        not null,
  user_id    text        not null,
  title      text        not null default 'New chat',
  summary    text,                                -- running summary of compacted turns
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Additive for already-created tables.
alter table public.chat_sessions add column if not exists summary text;
create index if not exists chat_sessions_user_idx
  on public.chat_sessions (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id         text        primary key default (gen_random_uuid())::text,
  session_id text        not null references public.chat_sessions(id) on delete cascade,
  role       text        not null check (role in ('user', 'assistant')),
  content    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx
  on public.chat_messages (session_id, created_at);

-- RLS — club-scoped backstop (uses the existing current_club_id() helper, text).
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_sessions: own club only" on public.chat_sessions;
create policy "chat_sessions: own club only"
  on public.chat_sessions for all
  using  (club_id = public.current_club_id())
  with check (club_id = public.current_club_id());

drop policy if exists "chat_messages: via session club" on public.chat_messages;
create policy "chat_messages: via session club"
  on public.chat_messages for all
  using (exists (
    select 1 from public.chat_sessions s
    where s.id = chat_messages.session_id and s.club_id = public.current_club_id()
  ))
  with check (exists (
    select 1 from public.chat_sessions s
    where s.id = chat_messages.session_id and s.club_id = public.current_club_id()
  ));
