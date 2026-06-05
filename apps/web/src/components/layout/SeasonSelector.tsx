import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  useSeasonStore,
  seasonLabel,
  MIN_SEASON_START,
  MAX_SEASON_START,
} from '@/stores/season'

/**
 * TopBar season switcher. Steps the active fiscal season forward/back and lets
 * the user jump to any planned season from a dropdown. Selection drives the
 * financial config that loads, the calendar dates, and the SCR "as-of" math.
 *
 * Styled to match the SCR pill (rounded-full, slate border, framer fade) so it
 * reads as part of the same TopBar control cluster — no custom design language.
 */
export function SeasonSelector() {
  const { t } = useTranslation()
  const { startYear, setStartYear } = useSeasonStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Build the list of selectable seasons (launch season → planning horizon).
  const seasons: number[] = []
  for (let y = MIN_SEASON_START; y <= MAX_SEASON_START; y++) seasons.push(y)

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
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('chrome.season.selectAria')}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border whitespace-nowrap transition-colors ${
          open ? 'border-slate-300 ring-2 ring-slate-200/60' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="meta-label text-slate-400">{t('chrome.season.label')}</span>
        <span className="num text-[13px] text-slate-900 font-medium">{seasonLabel(startYear)}</span>
        <motion.svg
          width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"
          animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}
        >
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={t('chrome.season.listAria')}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 mt-2 w-44 z-50 rounded-xl bg-white shadow-[0_18px_40px_-12px_rgba(15,23,42,0.18),0_4px_10px_-6px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 overflow-hidden"
          >
            <div className="px-3 pt-2.5 pb-1.5 meta-label text-slate-400 border-b border-slate-100">
              {t('chrome.season.active')}
            </div>
            <ul className="py-1 max-h-64 overflow-y-auto">
              {seasons.map((y) => {
                const active = y === startYear
                return (
                  <li key={y}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => { setStartYear(y); setOpen(false) }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors ${
                        active ? 'bg-violet-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className={`num text-[13px] ${active ? 'text-violet-700 font-medium' : 'text-slate-700'}`}>
                        {seasonLabel(y)}
                      </span>
                      {active && (
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-600">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
