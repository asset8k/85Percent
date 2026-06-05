import { create } from 'zustand'
import { api, type NotificationItem } from '@/lib/api'

/**
 * In-app notification store (MVP 2.1). Backs the TopBar bell. Holds the loaded
 * list + unread count, and exposes load / mark-read / mark-all / refresh
 * actions. `refresh` first asks the backend to derive any standing alerts
 * (compliance, contract expiries) for the active season, then reloads.
 */

interface NotificationsState {
  items: NotificationItem[]
  unreadCount: number
  loading: boolean
  loaded: boolean

  load: () => Promise<void>
  refresh: (season?: string) => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  reset: () => void
}

// Coalesces concurrent refreshes so overlapping callers (StrictMode's double
// mount, a season change landing during initial load, the 60s poll racing the
// first fetch) share one in-flight derive+reload instead of each triggering a
// separate POST /refresh — which would race the backend's dedup and double-
// insert the same standing alert. Module-scoped so it survives store recreation.
let refreshInFlight: Promise<void> | null = null

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  items: [],
  unreadCount: 0,
  loading: false,
  loaded: false,

  load: async () => {
    set({ loading: true })
    try {
      const res = await api.notifications.list()
      set({ items: res.notifications, unreadCount: res.unreadCount, loaded: true })
    } catch {
      // Silent — the bell simply shows no notifications if the fetch fails.
    } finally {
      set({ loading: false })
    }
  },

  refresh: async (season) => {
    // Share a single in-flight derive+reload across concurrent callers.
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = (async () => {
      try {
        await api.notifications.refresh(season)
      } catch {
        // Derivation failure is non-fatal; still reload whatever exists.
      }
      await get().load()
    })().finally(() => {
      refreshInFlight = null
    })
    return refreshInFlight
  },

  markRead: async (id) => {
    // Optimistic — flip locally, then persist.
    set((s) => {
      const wasUnread = s.items.find((n) => n.id === id && !n.isRead)
      return {
        items: s.items.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
      }
    })
    try {
      await api.notifications.markRead(id)
    } catch {
      // Re-sync on failure to avoid a stale optimistic state.
      await get().load()
    }
  },

  markAllRead: async () => {
    set((s) => ({ items: s.items.map((n) => ({ ...n, isRead: true })), unreadCount: 0 }))
    try {
      await api.notifications.markAllRead()
    } catch {
      await get().load()
    }
  },

  reset: () => set({ items: [], unreadCount: 0, loaded: false, loading: false }),
}))
