/**
 * Select — 85Percent UI Kit dropdown.
 *
 * A styled replacement for the native `<select>` (whose arrow and padding can't
 * be controlled consistently across browsers). Renders a trigger button in the
 * violet/light field style and an absolutely-positioned listbox popup, matching
 * the look of `CountryPicker`. Each option may carry a `leading` node (an icon,
 * a `<Flag>`, a currency glyph) shown both in the trigger and the list.
 *
 * Generic over the option value so callers keep their string-literal unions
 * (e.g. `Currency`, `Language`) end-to-end.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  /** Optional leading visual (flag, glyph, icon) rendered before the label. */
  leading?: ReactNode
}

interface SelectProps<T extends string = string> {
  value: T
  onChange: (next: T) => void
  options: SelectOption<T>[]
  disabled?: boolean
  /** Applied to the root — use for width, e.g. `w-[260px]`. */
  className?: string
  placeholder?: string
  ariaLabel?: string
}

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  disabled,
  className,
  placeholder,
  ariaLabel,
}: SelectProps<T>) {
  const { t } = useTranslation()
  const placeholderText = placeholder ?? t('picker.select')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape — same affordance as CountryPicker.
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

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'w-full pl-3 pr-2.5 py-2 text-[14px] rounded-lg border border-slate-200 bg-white text-left',
          'flex items-center justify-between gap-2',
          'focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-60',
          open && 'border-violet-500 ring-1 ring-violet-500'
        )}
      >
        <span className="flex-1 min-w-0 flex items-center gap-2 truncate">
          {selected ? (
            <>
              {selected.leading}
              <span className="truncate text-slate-900">{selected.label}</span>
            </>
          ) : (
            <span className="text-slate-400">{placeholderText}</span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('text-slate-400 transition-transform flex-shrink-0', open && 'rotate-180')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {options.map((o) => {
              const isSel = o.value === value
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                    className={cn(
                      'w-full px-3 py-1.5 text-[13px] text-left flex items-center gap-2.5 transition-colors',
                      isSel ? 'bg-violet-50 text-violet-900' : 'text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    {o.leading}
                    <span className="flex-1 truncate">{o.label}</span>
                    {isSel && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-violet-600 flex-shrink-0"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
