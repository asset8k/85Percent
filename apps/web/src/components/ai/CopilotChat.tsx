/**
 * CopilotChat — the Compliance Analyst.
 *
 * A RAG-grounded assistant that explains SCR regulations and the figures the
 * Headroom engine has already computed. Two layouts share one conversation:
 *   • Drawer (default) — a right-hand slide-in for quick questions.
 *   • Fullscreen — an expanded workspace with a session sidebar for switching
 *     between saved conversations.
 *
 * History (sessions, titles, messages) is persisted on the backend per user;
 * the conversation auto-compacts (older turns summarised) when it nears a
 * conservative token budget, surfaced as a live "context" bar. Streaming,
 * markdown rendering, smooth stick-to-bottom scrolling. Inference is proxied
 * through Fastify /api/chat with the Supabase bearer token; the engine is never
 * called here.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChat, type Message } from 'ai/react'
import { AnimatePresence, motion } from 'framer-motion'
import { contextUsageRatio, shouldCompact, type ChatTurn } from '@headroom/shared'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/ai/Markdown'
import {
  SparkIcon,
  CloseIcon,
  PlusIcon,
  ExpandIcon,
  CollapseIcon,
  SendIcon,
  StopIcon,
  TrashIcon,
  BookIcon,
} from '@/components/ai/icons'
import { api } from '@/lib/api'
import { useCopilot } from '@/stores/copilot'
import { KNOWLEDGE_SOURCE_LABEL, parseContextLabel } from '@/lib/copilotContext'

// Attach the Supabase access token to every /api/chat request (fresh each call).
const authedFetch: typeof fetch = async (input, init) => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input as RequestInfo, { ...init, headers })
}

const EXAMPLE_PROMPTS = [
  'What is the Squad Cost Ratio and how is it calculated?',
  'What happens if we breach the 85% threshold?',
  'Explain the difference between the levy and points-deduction zones.',
]

/** Shared Analyst avatar — one consistent format everywhere in the chat. */
function AnalystAvatar({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'flex flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-white',
        compact ? 'h-7 w-7' : 'h-8 w-8',
        className,
      )}
    >
      <SparkIcon size={compact ? 12 : 13} />
    </span>
  )
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

// ── source chip — deep-links to the in-app Rules reference (not the website) ─
function SourceChip() {
  const navigate = useNavigate()
  const close = useCopilot((s) => s.close)
  return (
    <button
      onClick={() => {
        close()
        navigate('/rules')
      }}
      title="Open the SCR rules reference"
      className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100"
    >
      <BookIcon size={11} />
      Source: SCR rules
    </button>
  )
}

// ── message list (owns its scroll, sticks to bottom only when near bottom) ──
function MessageList({
  messages,
  isLoading,
  onExample,
  compacted,
}: {
  messages: Message[]
  isLoading: boolean
  onExample: (text: string) => void
  compacted: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Instant scroll (no smooth) so streaming tokens don't fight a long animation
  // — that was the "sticky/laggy" feel. Only auto-stick when the user is at the
  // bottom; if they scroll up to read, we leave them be.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, isLoading])

  const visible = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const showTyping = isLoading && visible[visible.length - 1]?.role === 'user'

  return (
    <div ref={ref} onScroll={onScroll} className="flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {compacted && visible.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="h-px flex-1 bg-slate-100" />
            <span className="flex items-center gap-1">
              <BookIcon size={11} /> Earlier conversation summarized
            </span>
            <span className="h-px flex-1 bg-slate-100" />
          </div>
        )}
        {visible.length === 0 && (
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
            <div className="flex items-center gap-2.5 text-slate-800">
              <AnalystAvatar />
              <p className="text-[14px] font-semibold">How can I help with compliance?</p>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
              I explain the SCR rules and the figures Headroom has calculated, grounded in the{' '}
              {KNOWLEDGE_SOURCE_LABEL}. Verify material decisions against the official 2026/27
              Handbook — I'm an analyst aid, not a legal advisor.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => onExample(p)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[12.5px] text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50/50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {visible.map((m) => {
          const contextLabel = m.role === 'user' ? parseContextLabel(m.content) : null
          if (contextLabel) {
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="flex justify-end"
              >
                <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-violet-700">
                  <SparkIcon size={12} />
                  Analyzing {contextLabel}
                </div>
              </motion.div>
            )
          }
          const isUser = m.role === 'user'
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
            >
              {isUser ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet-600 px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
                  {m.content}
                </div>
              ) : (
                <div className="flex max-w-[92%] gap-2.5">
                  <AnalystAvatar compact className="mt-0.5" />
                  <div className="min-w-0 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
                    {m.content.length > 0 ? <Markdown content={m.content} /> : (
                      <span className="text-[13px] text-slate-400">…</span>
                    )}
                    {m.content.length > 0 && <SourceChip />}
                  </div>
                </div>
              )}
            </motion.div>
          )
        })}

        {showTyping && (
          <div className="flex justify-start">
            <div className="flex gap-2.5">
              <AnalystAvatar compact className="mt-0.5" />
              <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── composer (auto-grow textarea, Enter to send, Shift+Enter newline) ──────
function Composer({
  input,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  usage,
  compacting,
  compacted,
  showRing,
}: {
  input: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
  usage: number
  compacting: boolean
  compacted: boolean
  showRing: boolean
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow up to a cap.
  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-3">
      <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-violet-400 focus-within:ring-1 focus-within:ring-violet-300">
        <textarea
          ref={taRef}
          value={input}
          onChange={onChange}
          rows={1}
          placeholder="Ask about SCR, a player, or a scenario…"
          className="flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!isLoading && input.trim()) onSubmit()
            }
          }}
        />
        {showRing && <ContextRing ratio={usage} compacting={compacting} compacted={compacted} />}
        {isLoading ? (
          <button
            onClick={onStop}
            aria-label="Stop"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600 transition-colors hover:bg-slate-300"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={input.trim().length === 0}
            aria-label="Send"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendIcon />
          </button>
        )}
      </div>
      <p className="mx-auto mt-1.5 max-w-2xl text-center text-[10.5px] text-slate-400">
        Compliance Analyst can be wrong — verify against the official Handbook. Not legal advice.
      </p>
    </div>
  )
}

// ── context ring (compaction indicator, lives inside the composer) ──────────
// A small text-free circular gauge that fills as the conversation's token budget
// fills — the same idea as the context ring in the Claude Code / Cursor editors.
// Hovering reveals a tooltip with the exact usage. The chat auto-compacts near
// full (the user never compacts manually) and the ring drops back toward empty.
function ContextRing({
  ratio,
  compacting,
  compacted,
}: {
  ratio: number
  compacting: boolean
  compacted: boolean
}) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  const size = 18
  const stroke = 2.5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.min(1, Math.max(0, ratio)))
  const color = compacting ? '#a78bfa' : ratio < 0.6 ? '#7c3aed' : ratio < 0.85 ? '#f59e0b' : '#ef4444'
  const tip = compacting ? 'Compacting context…' : `Chat context · ${pct}%${compacted ? ' · compacted' : ''}`

  return (
    <div className="group relative flex h-8 w-6 flex-shrink-0 items-center justify-center">
      <motion.div
        className="flex items-center justify-center"
        style={{ width: size, height: size }}
        animate={compacting ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
        transition={compacting ? { duration: 1, repeat: Infinity } : { duration: 0.2 }}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </svg>
      </motion.div>
      {/* Hover tooltip */}
      <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg group-hover:block">
        {tip}
      </div>
    </div>
  )
}

// ── header (shared by drawer + fullscreen) ─────────────────────────────────
function Header({
  fullscreen,
  onNew,
  onToggleFullscreen,
  onClose,
}: {
  fullscreen: boolean
  onNew: () => void
  onToggleFullscreen: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
      <div className="flex items-center gap-2.5">
        <AnalystAvatar className="shadow-sm shadow-violet-600/20" />
        <div>
          <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-slate-900">
            Compliance Analyst
          </h2>
          <p className="text-[11px] leading-tight text-slate-400">Grounded in PL rules · not legal advice</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <IconBtn onClick={onNew} title="New chat"><PlusIcon /></IconBtn>
        <IconBtn onClick={onToggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
        </IconBtn>
        <IconBtn onClick={onClose} title="Close"><CloseIcon /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      {children}
    </button>
  )
}

// ── session sidebar (fullscreen only) ──────────────────────────────────────
function SessionSidebar({ onPick }: { onPick: (id: string) => void }) {
  const { sessions, activeId, newSession, deleteSession } = useCopilot()
  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <aside className="flex w-72 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50/60">
      <div className="p-3">
        <button
          onClick={() => newSession()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-violet-700"
        >
          <PlusIcon size={15} /> New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          History
        </p>
        {ordered.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-slate-400">No conversations yet.</p>
        )}
        {ordered.map((s) => (
          <div
            key={s.id}
            className={cn(
              'group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors',
              s.id === activeId ? 'bg-violet-100/70' : 'hover:bg-slate-100',
            )}
          >
            <button onClick={() => onPick(s.id)} className="min-w-0 flex-1 text-left">
              <p
                className={cn(
                  'truncate text-[13px] font-medium',
                  s.id === activeId ? 'text-violet-900' : 'text-slate-700',
                )}
              >
                {s.title}
              </p>
              <p className="text-[10.5px] text-slate-400">{timeAgo(s.updatedAt)}</p>
            </button>
            <button
              onClick={() => deleteSession(s.id)}
              title="Delete chat"
              aria-label="Delete chat"
              className="flex-shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-white hover:text-red-500 group-hover:opacity-100"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}

// ── main component ─────────────────────────────────────────────────────────
export function CopilotChat() {
  const {
    isOpen,
    isFullscreen,
    activeId,
    activeSummary,
    close,
    setFullscreen,
    newSession,
    switchSession,
    refreshSessions,
    setActiveSummary,
  } = useCopilot()

  const { messages, input, handleInputChange, handleSubmit, append, setMessages, stop, isLoading } =
    useChat({
      api: '/api/chat',
      fetch: authedFetch,
      // When a turn completes the backend has persisted it — refresh the sidebar
      // so the new/updated session (and its derived title) appears.
      onFinish: () => void refreshSessions(),
    })

  const [compacting, setCompacting] = useState(false)
  const appendedInjection = useRef<string | null>(null)
  // Per-request body — the active session id (so the backend persists the turn)
  // and the running compaction summary (folded into the system prompt).
  const sendOpts = () => ({
    body: {
      sessionId: useCopilot.getState().activeId,
      summary: useCopilot.getState().activeSummary,
    },
  })

  // Load the session list once on mount.
  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  // LOAD the active session's messages from the backend when the session
  // changes. A brand-new (unsaved) session returns null → empty conversation.
  // Depends ONLY on activeId so it never clobbers a live stream.
  useEffect(() => {
    let cancelled = false
    if (!activeId) {
      setMessages([])
      setActiveSummary(null)
      return
    }
    void api.chat.session(activeId).then((detail) => {
      if (cancelled) return
      const loaded: Message[] = detail
        ? detail.messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))
        : []
      setMessages(loaded)
      setActiveSummary(detail?.summary ?? null)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // INJECTION — when opened with serialized engine state, append it to the
  // CURRENT session (continuing it) for an immediate breakdown. Ref-guarded so
  // it fires exactly once per injection, even under StrictMode's double-effect.
  useEffect(() => {
    if (!isOpen) return
    const injection = useCopilot.getState().pendingInjection
    if (!injection || appendedInjection.current === injection) return
    appendedInjection.current = injection
    useCopilot.getState().consumeInjection()
    // Defer so the active-session load (setMessages) flushes first.
    setTimeout(() => void append({ role: 'user', content: injection }, sendOpts()), 80)
  }, [isOpen, append])

  // AUTO-COMPACTION — when the conversation nears the conservative token budget,
  // fold older turns into a server-side summary and keep only the recent ones.
  // Runs only when idle (not streaming, not already compacting). The shared
  // `shouldCompact` guard prevents re-triggering immediately after a compaction.
  useEffect(() => {
    if (isLoading || compacting || !activeId) return
    const turns: ChatTurn[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    if (!shouldCompact(turns, useCopilot.getState().activeSummary ?? '')) return

    const sid = activeId
    setCompacting(true)
    void api.chat
      .compact(sid)
      .then((res) => {
        // Ignore if the user switched sessions while we were compacting.
        if (useCopilot.getState().activeId !== sid) return
        useCopilot.getState().setActiveSummary(res.summary)
        setMessages(res.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })))
      })
      .catch(() => {
        /* best-effort — leave the conversation intact on failure */
      })
      .finally(() => setCompacting(false))
  }, [messages, isLoading, compacting, activeId, setMessages])

  const submit = () => {
    if (!input.trim()) return
    useCopilot.getState().ensureActiveSession()
    handleSubmit(undefined, sendOpts())
  }
  const onExample = (text: string) => {
    useCopilot.getState().ensureActiveSession()
    void append({ role: 'user', content: text }, sendOpts())
  }
  const handleNew = () => {
    stop()
    newSession()
  }
  const handlePickSession = (id: string) => {
    if (id === activeId) return
    stop()
    switchSession(id)
  }

  const header = (
    <Header
      fullscreen={isFullscreen}
      onNew={handleNew}
      onToggleFullscreen={() => setFullscreen(!isFullscreen)}
      onClose={close}
    />
  )
  const usageTurns: ChatTurn[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const usage = contextUsageRatio(usageTurns, activeSummary ?? '')

  const body = (
    <>
      <MessageList
        messages={messages}
        isLoading={isLoading}
        onExample={onExample}
        compacted={!!activeSummary}
      />
      <Composer
        input={input}
        onChange={handleInputChange}
        onSubmit={submit}
        onStop={stop}
        isLoading={isLoading}
        usage={usage}
        compacting={compacting}
        compacted={!!activeSummary}
        showRing={usageTurns.length > 0}
      />
    </>
  )

  return (
    <AnimatePresence>
      {isOpen && isFullscreen && (
        <motion.div
          key="fullscreen"
          className="fixed inset-0 z-50 flex bg-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <SessionSidebar onPick={handlePickSession} />
          <div className="flex min-w-0 flex-1 flex-col">
            {header}
            {body}
          </div>
        </motion.div>
      )}

      {isOpen && !isFullscreen && (
        <motion.div
          key="backdrop"
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={close}
        />
      )}
      {isOpen && !isFullscreen && (
        <motion.aside
          key="drawer"
          className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          role="dialog"
          aria-label="Compliance Analyst"
        >
          {header}
          {body}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

/** Floating launcher — opens the Analyst (continues the active session). */
export function CopilotLauncher() {
  const { isOpen, toggle } = useCopilot()
  if (isOpen) return null
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => toggle()}
      className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-600 to-violet-700 pl-4 pr-5 py-3 text-[14px] font-semibold text-white shadow-lg shadow-violet-600/30 transition-transform hover:scale-[1.03]"
      aria-label="Open Compliance Analyst"
    >
      <SparkIcon size={16} />
      Analyst
    </motion.button>
  )
}
