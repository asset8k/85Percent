/**
 * copilot store — state for the Compliance Analyst chat: open/fullscreen UI flags,
 * a one-shot context-injection channel, and **server-backed session history**.
 *
 * Session metadata (id + title + updatedAt) is loaded from the API
 * (`/chat/sessions`); messages are persisted server-side by the chat route and
 * fetched on demand into the `useChat` hook. New chats live locally (a generated
 * uuid) until their first message is sent, at which point the backend persists
 * the session and `refreshSessions()` picks it up.
 *
 * Trigger rule: `open(context)` continues the CURRENT session (creating one only
 * if none exists) — it never silently starts a new session.
 */

import { create } from 'zustand'
import { api } from '@/lib/api'
import { buildContextInjection, type CopilotContext } from '@/lib/copilotContext'

export interface SessionMeta {
  id: string
  title: string
  updatedAt: number
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

interface CopilotState {
  isOpen: boolean
  isFullscreen: boolean
  sessions: SessionMeta[]
  activeId: string | null
  pendingInjection: string | null
  /** Running summary of the active session's compacted (older) turns. */
  activeSummary: string | null
  /**
   * Sessions that exist only in this tab — created by `newSession()` and not yet
   * persisted (the backend writes a session on its first message). Asking the
   * API for one of these can only ever 404, so consumers skip the fetch instead
   * of firing a request they know will fail. Ids drop off this list as soon as
   * `refreshSessions()` sees them come back from the server.
   */
  localSessionIds: string[]

  open: (context?: CopilotContext) => void
  close: () => void
  toggle: () => void
  setFullscreen: (v: boolean) => void

  /** Load session list from the backend (merges a local-only new chat on top). */
  refreshSessions: () => Promise<void>
  /** Create a fresh local session (persisted on first message). Returns its id. */
  newSession: () => string
  switchSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  ensureActiveSession: () => string
  consumeInjection: () => string | null
  setActiveSummary: (summary: string | null) => void
  /** True while `id` has never been persisted server-side. */
  isLocalSession: (id: string) => boolean
}

export const useCopilot = create<CopilotState>((set, get) => ({
  isOpen: false,
  isFullscreen: false,
  sessions: [],
  activeId: null,
  pendingInjection: null,
  activeSummary: null,
  localSessionIds: [],

  open: (context) => {
    get().ensureActiveSession()
    set({ isOpen: true, pendingInjection: context ? buildContextInjection(context) : null })
  },
  // Closing always drops fullscreen so the next open is the small drawer.
  close: () => set({ isOpen: false, isFullscreen: false }),
  toggle: () => {
    if (!get().isOpen) get().ensureActiveSession()
    set((s) => ({ isOpen: !s.isOpen, isFullscreen: s.isOpen ? false : s.isFullscreen }))
  },
  setFullscreen: (v) => set({ isFullscreen: v }),

  refreshSessions: async () => {
    try {
      const { sessions } = await api.chat.sessions()
      const list: SessionMeta[] = sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: Date.parse(s.updatedAt) || Date.now(),
      }))
      set((state) => {
        const ids = new Set(list.map((x) => x.id))
        // Preserve a local-only active session (a new chat not yet persisted).
        const localActive =
          state.activeId && !ids.has(state.activeId)
            ? state.sessions.find((x) => x.id === state.activeId)
            : undefined
        const merged = localActive ? [localActive, ...list] : list
        const activeId = state.activeId ?? merged[0]?.id ?? null
        // Anything the server now knows about is no longer local-only.
        const localSessionIds = state.localSessionIds.filter((id) => !ids.has(id))
        return { sessions: merged, activeId, localSessionIds }
      })
    } catch {
      // Leave existing state — the chat still works without the sidebar list.
    }
  },

  newSession: () => {
    const meta: SessionMeta = { id: uuid(), title: 'New chat', updatedAt: Date.now() }
    set((s) => ({
      sessions: [meta, ...s.sessions],
      activeId: meta.id,
      pendingInjection: null,
      activeSummary: null,
      localSessionIds: [...s.localSessionIds, meta.id],
    }))
    return meta.id
  },

  switchSession: (id) => set({ activeId: id }),

  deleteSession: async (id) => {
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const activeId = s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId
      return { sessions, activeId, localSessionIds: s.localSessionIds.filter((x) => x !== id) }
    })
    try {
      await api.chat.remove(id)
    } catch {
      // Local-only (never persisted) or already gone — nothing to do.
    }
  },

  renameSession: async (id, title) => {
    const clean = title.trim() || 'New chat'
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: clean } : x)) }))
    try {
      await api.chat.rename(id, clean)
    } catch {
      // Best-effort.
    }
  },

  ensureActiveSession: () => {
    const { activeId, sessions } = get()
    if (activeId) return activeId // existing or a just-created local id
    const existing = sessions[0]
    if (existing) {
      set({ activeId: existing.id })
      return existing.id
    }
    return get().newSession()
  },

  consumeInjection: () => {
    const inj = get().pendingInjection
    if (inj !== null) set({ pendingInjection: null })
    return inj
  },

  setActiveSummary: (summary) => set({ activeSummary: summary }),

  isLocalSession: (id) => get().localSessionIds.includes(id),
}))
