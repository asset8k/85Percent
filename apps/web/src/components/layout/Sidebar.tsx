import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useScrollLock } from '@/lib/useScrollLock'
import { Wordmark } from '@/components/ui/Wordmark'
import { useClubStore } from '@/stores/club'
import { useCan } from '@/lib/role'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { resolveProductCapabilities, visibleNavigation, type NavigationItemId } from '@/lib/navigation'
import { Skeleton } from '@/components/ui/skeleton'

const navIcons: Record<NavigationItemId, React.ReactNode> = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18V8" /><path d="M10 18V4" /><path d="M16 18V11" /><path d="M3 21h18" /></svg>
  ),
  roster: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
  ),
  scenarios: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="M5 9l7-7 7 7" /><path d="M19 15l-7 7-7-7" /></svg>
  ),
  leagueTable: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18" /><path d="M3 12h18" /><path d="M3 19h18" /><path d="M8 5v14" /></svg>
  ),
  calendar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="1.5" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></svg>
  ),
  rules: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
  ),
  financials: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M18 7c0-5.333-8-5.333-8 0" /><path d="M10 7v14" /><path d="M6 21h12" /><path d="M6 13h10" /></svg>
  ),
  ssrTests: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 4v6c0 5-3.5 9-9 10-5.5-1-9-5-9-10V6l9-4z" /><path d="M9 12l2 2 4-4" /></svg>
  ),
}

export function Sidebar() {
  const { t } = useTranslation()
  const { bootstrapStatus, clubId, clubName, leagueId, clubLogoUrl } = useClubStore()
  const navigate = useNavigate()
  const can = useCan()
  const [changeOpen, setChangeOpen] = useState(false)
  // Freeze page scroll while the "change club/league" modal is open.
  useScrollLock(changeOpen)

  // First-run nudge: a CFO whose workspace has no squad yet is pointed at the
  // Workspace switcher to pick a club (which pre-fills the squad). Hides itself
  // once a squad exists, or when the user dismisses it.
  const [squadEmpty, setSquadEmpty] = useState<boolean | null>(null)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  useEffect(() => {
    if (!clubId || !can.switchLeague) { setSquadEmpty(null); return }
    let cancelled = false
    api.roster.list()
      .then((r) => { if (!cancelled) setSquadEmpty(r.players.length === 0) })
      .catch(() => { if (!cancelled) setSquadEmpty(false) })
    return () => { cancelled = true }
  }, [clubId, can.switchLeague])
  const showClubNudge = squadEmpty === true && can.switchLeague && !nudgeDismissed && !changeOpen

  const capabilities = resolveProductCapabilities(leagueId ?? '', can)
  const visibleNavItems = visibleNavigation(capabilities)

  const leagueLabel = leagueId === 'premier-league' ? t('chrome.leaguePremier') : t('chrome.leagueChampionship')

  if (bootstrapStatus !== 'ready') return <SidebarLoading />

  // Club crest (or initials fallback) — reused in the clickable + static rows.
  const clubAvatar = clubLogoUrl ? (
    <span className="inline-flex items-center justify-center w-7 h-7 flex-shrink-0">
      <img
        src={clubLogoUrl}
        alt={clubName ? `${clubName} crest` : 'Club crest'}
        className="w-7 h-7 object-contain"
        onError={(e) => {
          // Fall back to initials if the crest URL 404s.
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          const sib = e.currentTarget.nextElementSibling as HTMLElement | null
          if (sib) sib.style.display = 'inline-flex'
        }}
      />
      <span className="hidden items-center justify-center w-7 h-7 rounded-md bg-violet-600 text-white text-[11px] font-semibold">
        {clubName ? clubName.substring(0, 2).toUpperCase() : 'CL'}
      </span>
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-violet-600 text-white text-[11px] font-semibold flex-shrink-0">
      {clubName ? clubName.substring(0, 2).toUpperCase() : 'CL'}
    </span>
  )

  return (
    <aside className="w-[240px] flex-shrink-0 h-screen border-r border-slate-200 bg-white flex flex-col sticky top-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-slate-100">
        <Wordmark size={31.5} markScale={1.25} gap={6} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {visibleNavItems.map(({ id, to, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'group relative w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'text-violet-700'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-violet-600" />
                )}
                <span className={cn(isActive ? 'text-violet-600' : 'text-slate-400 group-hover:text-slate-600')}>
                  {navIcons[id]}
                </span>
                <span>{t(labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Workspace */}
      <div className="relative px-5 py-4 border-t border-slate-100">
        {/* First-run coachmark — points down at the workspace switcher. */}
        <AnimatePresence>
          {showClubNudge && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-4 right-4 bottom-full mb-2 z-20"
            >
              <div className="relative rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/25 p-3.5">
                <button
                  onClick={() => { setNudgeDismissed(true) }}
                  aria-label={t('chrome.nudge.dismiss')}
                  className="absolute top-2 right-2 text-white/60 hover:text-white transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                  <span aria-hidden>👋</span> {t('chrome.nudge.startHere')}
                </div>
                <p className="mt-1 text-[12px] leading-snug text-violet-100 pr-3">
                  {t('chrome.nudge.body')}
                </p>
                <button
                  onClick={() => { setNudgeDismissed(true); navigate('/onboarding') }}
                  className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  {t('chrome.nudge.choose')}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
                  </svg>
                </button>
                {/* Arrow pointing down to the workspace switcher */}
                <span className="absolute -bottom-1.5 left-6 w-3 h-3 rotate-45 bg-violet-600" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="meta-label mb-2">{t('chrome.workspace')}</div>
        {can.switchLeague ? (
          <button
            onClick={() => setChangeOpen(true)}
            title={t('chrome.changeClub')}
            className={cn(
              'group flex w-full items-center gap-2.5 -mx-1 px-1 py-1 rounded-lg text-left hover:bg-slate-50 transition-colors',
              showClubNudge && 'ring-2 ring-violet-400 ring-offset-1 bg-violet-50/60',
            )}
          >
            {clubAvatar}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-slate-900 truncate">{clubName ?? t('chrome.yourClub')}</div>
              <div className="text-[11px] text-slate-400">{leagueLabel}</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-2.5">
            {clubAvatar}
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate-900 truncate">{clubName ?? t('chrome.yourClub')}</div>
              <div className="text-[11px] text-slate-400">{leagueLabel}</div>
            </div>
          </div>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {changeOpen && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overscroll-contain"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setChangeOpen(false)}
            >
              <motion.div
                className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 pt-5 pb-2 flex items-center gap-3">
                  {clubAvatar}
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{t('chrome.changeModal.title')}</h3>
                    <p className="text-[12px] text-slate-400 truncate">{t('chrome.changeModal.currently', { name: clubName ?? t('chrome.yourClub') })}</p>
                  </div>
                </div>
                <div className="px-5 pb-4">
                  <p className="text-[13px] text-slate-600 leading-relaxed">
                    {t('chrome.changeModal.bodyPrefix')}
                    <span className="font-medium text-slate-800">{t('chrome.changeModal.bodyBold')}</span>
                    {t('chrome.changeModal.bodySuffix')}
                  </p>
                </div>
                <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
                  <Button variant="ghost" onClick={() => setChangeOpen(false)}>{t('common.cancel')}</Button>
                  <Button
                    onClick={() => {
                      setChangeOpen(false)
                      navigate('/onboarding')
                    }}
                  >
                    {t('chrome.changeModal.confirm')}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </aside>
  )
}

function SidebarLoading() {
  return (
    <aside className="w-[240px] flex-shrink-0 h-screen border-r border-slate-200 bg-white flex flex-col sticky top-0" aria-busy="true" aria-label="Loading workspace navigation">
      <div className="h-16 flex items-center px-5 border-b border-slate-100">
        <Wordmark size={31.5} markScale={1.25} gap={6} />
      </div>
      <nav className="flex-1 py-4 space-y-1" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 px-5 py-2.5">
            <Skeleton className="h-[18px] w-[18px]" />
            <Skeleton className="h-3.5" style={{ width: index === 3 ? 96 : 72 }} />
          </div>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-slate-100" aria-hidden="true">
        <Skeleton className="h-3 w-20 mb-3" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-7 w-7 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>
    </aside>
  )
}
