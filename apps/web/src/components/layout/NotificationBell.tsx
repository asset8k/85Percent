import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useNotificationsStore } from '@/stores/notifications'
import { useSeasonStore, seasonKey } from '@/stores/season'
import { formatDate } from '@/lib/locale'
import type { NotificationItem, NotificationType } from '@/lib/api'

/**
 * TopBar notification bell + popover (MVP 2.1).
 *
 * Shows a count badge for unread alerts; the popover lists them with
 * type-coded icons (INFO=blue, WARNING=amber, CRITICAL=red) and a
 * "Mark all as read" action. Styling mirrors the SeasonSelector / SCR popover
 * so the control cluster stays consistent — no bespoke design language.
 */

const TYPE_META: Record<NotificationType, { ring: string; bg: string; fg: string; dot: string }> = {
  INFO:     { ring: 'ring-blue-100',  bg: 'bg-blue-50',  fg: 'text-blue-600',  dot: 'bg-blue-500' },
  WARNING:  { ring: 'ring-amber-100', bg: 'bg-amber-50', fg: 'text-amber-600', dot: 'bg-amber-500' },
  CRITICAL: { ring: 'ring-red-100',   bg: 'bg-red-50',   fg: 'text-red-600',   dot: 'bg-red-500' },
}

// Map a notification to an in-app destination, or null if it isn't actionable.
// Contract-expiry alerts route to the Roster so the user can act on renewals.
function notificationLink(item: NotificationItem): string | null {
  if (/expiring/i.test(item.title)) return '/roster'
  return null
}

function relativeTime(iso: string, t: TFunction): string {
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return t('chrome.notifications.time.justNow')
  if (min < 60) return t('chrome.notifications.time.minutes', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('chrome.notifications.time.hours', { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return t('chrome.notifications.time.days', { n: day })
  return formatDate(iso, { day: '2-digit', month: 'short' })
}

function TypeIcon({ type }: { type: NotificationType }) {
  const meta = TYPE_META[type]
  return (
    <span className={`flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full ring-1 ${meta.bg} ${meta.ring} ${meta.fg}`}>
      {type === 'CRITICAL' ? (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      ) : type === 'WARNING' ? (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
        </svg>
      ) : (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" />
        </svg>
      )}
    </span>
  )
}

function NotificationRow({ item, actionable, onClick }: { item: NotificationItem; actionable: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 ${
        item.isRead ? '' : 'bg-violet-50/40'
      }`}
    >
      <TypeIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[13px] truncate ${item.isRead ? 'text-slate-600 font-normal' : 'text-slate-900 font-medium'}`}>
            {item.title}
          </span>
          {!item.isRead && <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-violet-500" />}
        </div>
        <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">{item.message}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-slate-400 num">{relativeTime(item.createdAt, t)}</span>
          {actionable && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-violet-600 group-hover:text-violet-700">
              {t('chrome.notifications.viewRoster')}
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
              </svg>
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function NotificationBell() {
  const { t } = useTranslation()
  const { items, unreadCount, loaded, load, refresh, markRead, markAllRead } = useNotificationsStore()
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Clicking a notification marks it read, then follows its link (if any).
  const handleSelect = (item: NotificationItem) => {
    if (!item.isRead) markRead(item.id)
    const link = notificationLink(item)
    if (link) {
      setOpen(false)
      navigate(link)
    }
  }

  // Derive + load on mount and whenever the active season changes (compliance
  // alerts are season-specific). Then poll quietly so the badge stays fresh.
  useEffect(() => {
    refresh(seasonKey(seasonStartYear))
    const t = setInterval(() => load(), 60_000)
    return () => clearInterval(t)
  }, [seasonStartYear, refresh, load])

  // ESC + outside-click dismiss
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? t('chrome.notifications.ariaUnread', { count: unreadCount }) : t('chrome.notifications.aria')}
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
          open ? 'border-slate-300 bg-slate-50 ring-2 ring-slate-200/60' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none num ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t('chrome.notifications.aria')}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 mt-2 w-[380px] z-50 rounded-xl bg-white shadow-[0_18px_40px_-12px_rgba(15,23,42,0.18),0_4px_10px_-6px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-slate-900">{t('chrome.notifications.title')}</span>
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-violet-100 text-violet-700 text-[11px] font-medium num">
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="text-[12px] font-medium text-violet-600 hover:text-violet-700"
                >
                  {t('chrome.notifications.markAllRead')}
                </button>
              )}
            </div>

            <div className="max-h-[400px] overflow-y-auto overscroll-contain divide-y divide-slate-100">
              {!loaded ? (
                <div className="px-4 py-10 text-center text-[13px] text-slate-400">{t('common.loading')}</div>
              ) : items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-50 text-slate-300 mb-2">
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </div>
                  <p className="text-[13px] text-slate-500">{t('chrome.notifications.emptyTitle')}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{t('chrome.notifications.emptyHint')}</p>
                </div>
              ) : (
                items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    actionable={notificationLink(item) !== null}
                    onClick={() => handleSelect(item)}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
