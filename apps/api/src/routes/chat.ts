/**
 * Chat route — the Compliance Analyst's inference + history endpoints.
 *
 *   POST   /chat                 — RAG-grounded, streamed Claude response
 *   GET    /chat/sessions        — the caller's chat sessions (newest first)
 *   GET    /chat/sessions/:id    — one session's messages
 *   PATCH  /chat/sessions/:id    — rename a session
 *   DELETE /chat/sessions/:id    — delete a session (cascades messages)
 *
 * History is persisted PER USER (chat_sessions / chat_messages, see chat.sql).
 * The streamed turn is saved server-side in the AI SDK `onFinish` callback —
 * we store only the new user message + the assistant reply (the client sends the
 * full history each call, but the earlier turns are already persisted).
 *
 * The deterministic SCR/FFP engine is never touched here — retrieval feeds the
 * LLM language context only.
 */

import type { FastifyInstance } from 'fastify'
import { planCompaction, type ChatTurn } from '@85percent/shared'
import { authMiddleware } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'
import { getClubOwnerId } from '../lib/clubOwner.js'
import { embedText } from '../lib/embeddings.js'
import {
  llm,
  buildSystemPrompt,
  buildSummaryPrompt,
  deriveTitle,
  type RetrievedPassage,
} from '../services/ai/index.js'
import type { ChatMessage, ChatFinishResult } from '../services/ai/index.js'
import { calculateQueryCost } from '../utils/aiPricing.js'

/**
 * A query is refused once the balance can no longer cover even a trivial turn.
 * One cent is the floor — below it we treat the balance as depleted.
 */
const MIN_BALANCE_USD = 0.01

interface IncomingMessage {
  role?: string
  content?: string
}
interface ChatBody {
  messages?: IncomingMessage[]
  sessionId?: string
  /** Running summary of compacted earlier turns (folded into the system prompt). */
  summary?: string
  /** Interface language (e.g. 'es') so the analyst replies in the user's language. */
  language?: string
}

const MATCH_COUNT = 5

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // ─────────────────────────────────────────────────── session history (CRUD)
  app.get('/chat/sessions', async (request, reply) => {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, title, updated_at')
      .eq('user_id', request.userId)
      .eq('club_id', request.clubId)
      .order('updated_at', { ascending: false })
    if (error) {
      request.log.error({ err: error }, 'chat: list sessions failed')
      return reply.status(503).send({ error: 'Could not load chat history' })
    }
    return reply.send({
      sessions: (data ?? []).map((s) => ({ id: s.id, title: s.title, updatedAt: s.updated_at })),
    })
  })

  app.get('/chat/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { data: session } = await supabase
      .from('chat_sessions')
      .select('id, title, summary')
      .eq('id', id)
      .eq('user_id', request.userId)
      .maybeSingle()
    if (!session) return reply.status(404).send({ error: 'Session not found' })

    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('id, role, content')
      .eq('session_id', id)
      .order('created_at', { ascending: true })
    if (error) {
      request.log.error({ err: error }, 'chat: load session messages failed')
      return reply.status(503).send({ error: 'Could not load chat' })
    }
    return reply.send({
      id: session.id,
      title: session.title,
      summary: (session.summary as string | null) ?? null,
      messages: messages ?? [],
    })
  })

  app.patch('/chat/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { title } = (request.body ?? {}) as { title?: string }
    const clean = (title ?? '').trim().slice(0, 80)
    if (!clean) return reply.status(400).send({ error: 'Title required' })
    const { error } = await supabase
      .from('chat_sessions')
      .update({ title: clean, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', request.userId)
    if (error) return reply.status(503).send({ error: 'Rename failed' })
    return reply.send({ ok: true })
  })

  app.delete('/chat/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { error } = await supabase
      .from('chat_sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', request.userId)
    if (error) return reply.status(503).send({ error: 'Delete failed' })
    return reply.send({ ok: true })
  })

  // ───────────────────────────────────────────── POST /chat/compact
  // Fold the older turns of a session into its running summary, delete those
  // rows, and return the compacted state. Keeps the context window (and cost)
  // bounded as a conversation grows. Tight rate limit — it makes an LLM call.
  app.post(
    '/chat/compact',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { sessionId } = (request.body ?? {}) as { sessionId?: string }
      if (!sessionId) return reply.status(400).send({ error: 'sessionId required' })

      const { data: session } = await supabase
        .from('chat_sessions')
        .select('id, summary')
        .eq('id', sessionId)
        .eq('user_id', request.userId)
        .maybeSingle()
      if (!session) return reply.status(404).send({ error: 'Session not found' })

      const { data: rows, error } = await supabase
        .from('chat_messages')
        .select('id, role, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
      if (error) return reply.status(503).send({ error: 'Could not load chat' })

      const messages = (rows ?? []) as { id: string; role: 'user' | 'assistant'; content: string }[]
      const priorSummary = (session.summary as string | null) ?? null
      const plan = planCompaction(messages)

      // Nothing meaningful to fold in — return current state unchanged.
      if (plan.toSummarize.length === 0) {
        return reply.send({
          summary: priorSummary,
          messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
        })
      }

      const { system, user } = buildSummaryPrompt(
        plan.toSummarize.map((m): ChatTurn => ({ role: m.role, content: m.content })),
        priorSummary,
      )

      let newSummary: string
      try {
        newSummary = await llm.complete({ system, user, maxTokens: 400 })
      } catch (err) {
        request.log.error({ err }, 'chat: summarise failed')
        return reply.status(503).send({ error: 'Compaction failed' })
      }

      // Persist the new summary and drop the summarised rows (keep the recent).
      await supabase
        .from('chat_sessions')
        .update({ summary: newSummary, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
      const removeIds = plan.toSummarize.map((m) => m.id)
      if (removeIds.length > 0) {
        await supabase.from('chat_messages').delete().in('id', removeIds)
      }

      return reply.send({
        summary: newSummary,
        messages: plan.keep.map((m) => ({ id: m.id, role: m.role, content: m.content })),
      })
    },
  )

  // ─────────────────────────────────────────────────────────── POST /chat
  app.post(
    '/chat',
    // Tighter limit than the global 100/min — inference is the expensive path.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = request.body as ChatBody
      const incoming = Array.isArray(body?.messages) ? body.messages : []
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null
      const summary = typeof body?.summary === 'string' ? body.summary : null
      const language = typeof body?.language === 'string' ? body.language : null

      const messages: ChatMessage[] = incoming
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        )
        .map((m) => ({ role: m.role, content: m.content }))

      if (messages.length === 0) {
        return reply.status(400).send({ error: 'No messages provided' })
      }

      // ── Shared balance owner ───────────────────────────────────────────
      // AI credits are a per-workspace pool, not per user: a guest member draws
      // on (and debits) the club OWNER's balance, never their own. Resolve the
      // owner once here and reuse it for the pre-check below and the debit in
      // onFinish. Falls back to the acting user if the owner can't be resolved.
      let balanceOwnerId = request.userId
      try {
        balanceOwnerId = (await getClubOwnerId(request.clubId)) ?? request.userId
      } catch (err) {
        request.log.error({ err }, 'chat: club owner lookup failed')
        return reply.status(503).send({ error: 'Could not verify AI balance' })
      }

      // ── AI credit pre-check ────────────────────────────────────────────
      // Refuse before spending a single token if the workspace balance is
      // depleted. 402 Payment Required is the signal the frontend keys off to
      // lock the composer until an admin tops the balance back up.
      const { data: balanceRow, error: balanceErr } = await supabase
        .from('users')
        .select('ai_balance_usd')
        .eq('id', balanceOwnerId)
        .maybeSingle()
      if (balanceErr) {
        request.log.error({ err: balanceErr }, 'chat: balance lookup failed')
        return reply.status(503).send({ error: 'Could not verify AI balance' })
      }
      const balanceUsd = balanceRow ? Number(balanceRow.ai_balance_usd) : 0
      if (!(balanceUsd > MIN_BALANCE_USD)) {
        return reply
          .status(402)
          .send({ error: 'AI balance depleted. Please contact your workspace admin to top up.' })
      }

      const lastUser = [...messages].reverse().find((m) => m.role === 'user')

      // Retrieve against the most recent user turn.
      let passages: RetrievedPassage[] = []
      if (lastUser && lastUser.content.trim().length > 0) {
        try {
          const queryEmbedding = await embedText(lastUser.content)
          const { data, error } = await supabase.rpc('match_documents', {
            query_embedding: JSON.stringify(queryEmbedding),
            match_count: MATCH_COUNT,
          })
          if (error) {
            request.log.warn({ err: error }, 'chat: match_documents failed — answering without RAG context')
          } else if (Array.isArray(data)) {
            passages = data as RetrievedPassage[]
          }
        } catch (err) {
          request.log.warn({ err }, 'chat: retrieval threw — answering without RAG context')
        }
      }

      const system = buildSystemPrompt(passages, { summary, language })
      const { userId, clubId } = request

      // Once the stream completes: (1) persist the turn to history and (2) debit
      // the workspace AI balance for the tokens it consumed. Both are best-effort
      // — failures here are logged but never break the already-delivered response.
      // History is per-user (the acting user's id), but the debit hits the shared
      // owner balance resolved above.
      const onFinish = async ({ text, usage }: ChatFinishResult) => {
        // (1) Persist the completed turn — strictly under the acting user's id so
        // a guest's chat history stays private to the guest (never the owner's).
        if (sessionId && lastUser) {
          const { data: existing } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', userId)
            .maybeSingle()

          if (!existing) {
            await supabase.from('chat_sessions').insert({
              id: sessionId,
              club_id: clubId,
              user_id: userId,
              title: deriveTitle(lastUser.content),
            })
          } else {
            await supabase
              .from('chat_sessions')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', sessionId)
          }

          await supabase.from('chat_messages').insert([
            { session_id: sessionId, role: 'user', content: lastUser.content },
            { session_id: sessionId, role: 'assistant', content: text },
          ])
        }

        // (2) Debit the balance. Cost = Sonnet token cost + 10% margin. The
        // arithmetic and rounding happen atomically in Postgres NUMERIC via the
        // deduct_ai_balance() function, so the stored balance never drifts.
        const cost = calculateQueryCost(usage.promptTokens, usage.completionTokens)
        const tokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)
        if (cost > 0 || tokens > 0) {
          const { error: debitErr } = await supabase.rpc('deduct_ai_balance', {
            p_user_id: balanceOwnerId,
            p_cost: cost,
            p_tokens: tokens,
          })
          if (debitErr) request.log.error({ err: debitErr }, 'chat: balance debit failed')
        }
      }

      reply.hijack()
      try {
        llm.streamChat({ system, messages, onFinish }).pipeToResponse(reply.raw)
      } catch (err) {
        request.log.error({ err }, 'chat: failed to start stream')
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'Content-Type': 'application/json' })
        }
        const message = err instanceof Error ? err.message : 'Analyst unavailable'
        reply.raw.end(JSON.stringify({ error: message }))
      }
    },
  )
}
