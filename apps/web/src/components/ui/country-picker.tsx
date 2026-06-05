/**
 * CountryPicker — searchable nationality combobox.
 *
 * Renders as a trigger button that matches the violet/light field style; opens
 * a popup with a search input and filtered list. Stores the canonical English
 * country name as a string (compatible with the existing `nationality` text
 * column). Pass null when cleared.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COUNTRIES, countryName, findCountry, type Country } from '@/lib/countries'
import { activeLocale } from '@/lib/locale'
import { Flag } from '@/components/ui/flag'
import { cn } from '@/lib/utils'

interface CountryPickerProps {
  value: string | null
  onChange: (next: string | null) => void
  placeholder?: string
  disabled?: boolean
}

export function CountryPicker({
  value,
  onChange,
  placeholder,
  disabled,
}: CountryPickerProps) {
  const { t, i18n } = useTranslation()
  const placeholderText = placeholder ?? t('picker.selectCountry')
  // Re-localize names when the interface language changes (i18n.language is a
  // dep so the memos below recompute on switch).
  const locale = useMemo(() => activeLocale(), [i18n.language])
  const label = useMemo(
    () => (c: Country) => countryName(c, locale),
    [locale],
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const matched = useMemo(() => findCountry(value), [value])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const handleDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // Focus the search input when opening
  useEffect(() => {
    if (open) {
      // Defer to next frame so the popup is in the DOM
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
    }
  }, [open])

  const filtered = useMemo<Country[]>(() => {
    const q = query.trim().toLowerCase()
    // Match the localized name as well as the canonical English name and code,
    // so searching works in the user's language and in English.
    const list = q
      ? COUNTRIES.filter(
          (c) =>
            label(c).toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q),
        )
      : COUNTRIES
    // Sort by localized name (locale-aware) so the order reads naturally in the
    // active language and the home nations slot in alphabetically.
    return [...list].sort((a, b) => label(a).localeCompare(label(b), locale))
  }, [query, label, locale])

  const triggerLabel = matched ? (
    <span className="flex items-center gap-2 min-w-0">
      <Flag code={matched.code} title={label(matched)} width={20} />
      <span className="truncate text-slate-900">{label(matched)}</span>
    </span>
  ) : value && value.trim() ? (
    // Legacy/free-text value that didn't match the canonical list — render as-is.
    <span className="truncate text-slate-900">{value}</span>
  ) : (
    <span className="text-slate-400">{placeholderText}</span>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white text-left',
          'flex items-center justify-between gap-2',
          'focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-60',
          open && 'border-violet-500 ring-1 ring-violet-500'
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 min-w-0 flex items-center gap-2 truncate">{triggerLabel}</span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {matched && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('picker.clearNationality')}
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange(null)
                }
              }}
              className="text-slate-400 hover:text-slate-700 rounded p-0.5 -m-0.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" /><path d="M6 6l12 12" />
              </svg>
            </span>
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('text-slate-400 transition-transform', open && 'rotate-180')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('picker.searchCountries')}
              className="w-full px-2.5 py-1.5 text-[13px] rounded-md border border-slate-200 bg-slate-50 focus:outline-none focus:bg-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-[13px] text-slate-500 text-center">
                {t('picker.noMatches')}
              </li>
            ) : (
              filtered.map((c) => {
                const selected = matched?.code === c.code
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c.name)
                        setOpen(false)
                      }}
                      className={cn(
                        'w-full px-3 py-1.5 text-[13px] text-left flex items-center gap-2.5 transition-colors',
                        selected
                          ? 'bg-violet-50 text-violet-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <Flag code={c.code} title={label(c)} width={20} />
                      <span className="flex-1 truncate">{label(c)}</span>
                      <span className="text-[11px] text-slate-400 num">{c.code.replace(/^GB_/, '')}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
