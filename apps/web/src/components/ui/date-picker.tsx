/**
 * DatePicker — typeable DD/MM/YYYY input + popover calendar.
 *
 * Wire value is an ISO YYYY-MM-DD string (or empty). The trigger renders as a
 * masked text input (UK-style DD/MM/YYYY) with a calendar icon button on the
 * right that opens the popover. Typing into the input auto-formats and commits
 * a valid date to the parent; the popover is a month grid with month/year jog
 * controls. All date math runs in UTC so the displayed day never drifts across
 * timezones (see Phase 2.4 date-precision notes). The popover positions
 * itself above the trigger when there isn't room below.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface DatePickerProps {
  value: string                 // ISO YYYY-MM-DD or '' for unset
  onChange: (next: string) => void
  required?: boolean
  disabled?: boolean
  placeholder?: string
  // Optional bounds (inclusive). YYYY-MM-DD. If omitted, no bound.
  min?: string
  max?: string
  // Year range shown in the year jump dropdown. Defaults to [1950, currentYear+10].
  minYear?: number
  maxYear?: number
}

function parseISO(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!match) return null
  const y = Number(match[1]), m = Number(match[2]) - 1, d = Number(match[3])
  const dt = new Date(Date.UTC(y, m, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m ||
    dt.getUTCDate() !== d
  ) return null
  return { y, m, d }
}

function toISO(y: number, m: number, d: number): string {
  const mm = String(m + 1).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

// ISO YYYY-MM-DD → display DD/MM/YYYY. Returns '' for invalid input.
function isoToDisplay(s: string): string {
  const parsed = parseISO(s)
  if (!parsed) return ''
  return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m + 1).padStart(2, '0')}/${parsed.y}`
}

// Display DD/MM/YYYY → ISO YYYY-MM-DD. Returns null if the date doesn't exist
// (e.g. 31/02/2025) or the format is wrong / incomplete.
function displayToISO(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  if (!m) return null
  const d = Number(m[1]), mo = Number(m[2]) - 1, y = Number(m[3])
  const dt = new Date(Date.UTC(y, mo, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo ||
    dt.getUTCDate() !== d
  ) return null
  return toISO(y, mo, d)
}

// Decide whether a candidate digit-only prefix is still on a path to a valid,
// in-range date. Used by `maskTyped` to reject impossible digits at the source.
//
// Day-part:   01..31         (rejected the moment the 2nd day digit lands on >31)
// Month-part: 01..12         (rejected the moment the 2nd month digit lands on >12)
// Year-part:  bound to [minYear, maxYear] when those are passed in. Only the
//             full 4-digit year is checked — partial prefixes are permissive so
//             you can still type "20" on the way to "2025".
function isFeasiblePrefix(digits: string, minYear?: number, maxYear?: number): boolean {
  if (digits.length >= 2) {
    const day = Number(digits.slice(0, 2))
    if (day < 1 || day > 31) return false
  }
  if (digits.length >= 4) {
    const month = Number(digits.slice(2, 4))
    if (month < 1 || month > 12) return false
  }
  if (digits.length === 8) {
    const year = Number(digits.slice(4, 8))
    if (minYear !== undefined && year < minYear) return false
    if (maxYear !== undefined && year > maxYear) return false
  }
  return true
}

// Mask raw input to DD/MM/YYYY as the user types. Walks digit-by-digit, dropping
// any digit that would push the day, month or year out of range. Slashes are
// inserted after positions 2 and 4. Backspace works naturally — re-formatting
// shorter digit strings collapses the slashes.
function maskTyped(raw: string, minYear?: number, maxYear?: number): string {
  const out: string[] = []
  for (const ch of raw) {
    if (!/\d/.test(ch)) continue
    if (out.length >= 8) break
    out.push(ch)
    if (!isFeasiblePrefix(out.join(''), minYear, maxYear)) out.pop()
  }
  const digits = out.join('')
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

// Day-of-week for Date.UTC(y,m,d), normalised to Monday-first (0..6).
function mondayDow(y: number, m: number, d: number): number {
  const js = new Date(Date.UTC(y, m, d)).getUTCDay()  // 0=Sun..6=Sat
  return (js + 6) % 7                                  // 0=Mon..6=Sun
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

export function DatePicker({
  value,
  onChange,
  required,
  disabled,
  placeholder = 'Select date',
  min,
  max,
  minYear,
  maxYear,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<'below' | 'above'>('below')
  const [focused, setFocused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => parseISO(value), [value])
  const today = useMemo(() => {
    const now = new Date()
    return { y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate() }
  }, [])

  // Text shown in the masked input. Held locally so partial input (e.g. "01/")
  // doesn't get clobbered by every external value sync. Reconciles with the
  // canonical `value` whenever the user blurs out, or when `value` changes
  // while the input isn't focused.
  const [text, setText] = useState(() => isoToDisplay(value))
  useEffect(() => {
    if (!focused) setText(isoToDisplay(value))
  }, [value, focused])

  // Cursor — the month/year currently displayed in the calendar grid.
  // Falls back to today when the value is empty/invalid.
  const [cursor, setCursor] = useState<{ y: number; m: number }>(
    () => parsed ?? today
  )

  // When `value` is reset externally, sync the cursor to it on next open.
  useEffect(() => {
    if (open) setCursor(parsed ?? today)
  }, [open, parsed, today])

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

  // Decide whether to open the popover above the trigger (when there's more
  // room above than below — common for DOB pickers near the bottom of a modal).
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const POPOVER_HEIGHT = 360  // approximate; close enough for picking a side
    setPosition(spaceBelow < POPOVER_HEIGHT && rect.top > POPOVER_HEIGHT ? 'above' : 'below')
  }, [open])

  const minISO = min ?? null
  const maxISO = max ?? null

  // Default the year jump range to include the today year and reasonable
  // football-domain bounds (player DOBs can be 35+ years ago).
  const yearRange = useMemo(() => {
    const lo = minYear ?? Math.min(today.y - 60, parsed ? parsed.y - 5 : today.y - 60)
    const hi = maxYear ?? Math.max(today.y + 10, parsed ? parsed.y + 5 : today.y + 10)
    const years: number[] = []
    for (let y = lo; y <= hi; y++) years.push(y)
    return years
  }, [minYear, maxYear, today.y, parsed])

  const isBeforeMin = (iso: string) => (minISO ? iso < minISO : false)
  const isAfterMax  = (iso: string) => (maxISO ? iso > maxISO : false)
  const isOutOfRange = (iso: string) => isBeforeMin(iso) || isAfterMax(iso)

  // Build a 6-row grid of (day, isCurrentMonth) starting on a Monday.
  const grid = useMemo(() => {
    const cells: Array<{ y: number; m: number; d: number; current: boolean }> = []
    const firstDow = mondayDow(cursor.y, cursor.m, 1)
    const dim = daysInMonth(cursor.y, cursor.m)
    // Leading days from previous month
    if (firstDow > 0) {
      const prevMonth = cursor.m === 0 ? 11 : cursor.m - 1
      const prevYear = cursor.m === 0 ? cursor.y - 1 : cursor.y
      const prevDim = daysInMonth(prevYear, prevMonth)
      for (let i = firstDow - 1; i >= 0; i--) {
        cells.push({ y: prevYear, m: prevMonth, d: prevDim - i, current: false })
      }
    }
    // Current month
    for (let d = 1; d <= dim; d++) {
      cells.push({ y: cursor.y, m: cursor.m, d, current: true })
    }
    // Trailing days from next month — fill up to 42 cells (6 rows × 7 days)
    let trailingDay = 1
    while (cells.length < 42) {
      const nextMonth = cursor.m === 11 ? 0 : cursor.m + 1
      const nextYear  = cursor.m === 11 ? cursor.y + 1 : cursor.y
      cells.push({ y: nextYear, m: nextMonth, d: trailingDay, current: false })
      trailingDay++
    }
    return cells
  }, [cursor])

  const goPrev = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
  const goNext = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))

  // Year-level bounds for the typed-input clamp. Day (≤31) and month (≤12) are
  // hard-capped unconditionally; year is bounded only when `min`/`max` are set
  // on the field. DOB passes `max={todayISO}` so the user can't type a future
  // birth year; contract dates leave both unset so a 2030 end date is typable.
  const typedMinYear = min ? Number(min.slice(0, 4)) : undefined
  const typedMaxYear = max ? Number(max.slice(0, 4)) : undefined

  // Commit a fully-typed (and in-range) date from the masked input.
  // Out-of-range or invalid partial input is left in the local text buffer;
  // blur reconciles back to the canonical value.
  const handleInputChange = (raw: string) => {
    const next = maskTyped(raw, typedMinYear, typedMaxYear)
    setText(next)
    const iso = displayToISO(next)
    if (iso !== null && !isOutOfRange(iso)) {
      onChange(iso)
    } else if (next === '' && !required) {
      onChange('')
    }
  }

  const handleInputBlur = () => {
    setFocused(false)
    const iso = displayToISO(text)
    if (iso !== null && !isOutOfRange(iso)) {
      onChange(iso)
      setText(isoToDisplay(iso))
    } else if (text.trim() === '') {
      if (!required) onChange('')
      setText('')
    } else {
      // Invalid/partial — snap back to the canonical value
      setText(isoToDisplay(value))
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Hidden native input keeps form validation working with `required` */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          value={value}
          onChange={() => undefined}
          required={required}
          className="absolute opacity-0 pointer-events-none w-px h-px"
        />
      )}
      <div
        ref={triggerRef}
        className={cn(
          'w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white',
          'flex items-center gap-2',
          'transition-colors',
          (focused || open) && 'border-violet-500 ring-1 ring-violet-500',
          disabled && 'opacity-60'
        )}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          placeholder={placeholder ? `${placeholder} (DD/MM/YYYY)` : 'DD/MM/YYYY'}
          disabled={disabled}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleInputBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleInputBlur()
            } else if (e.key === 'ArrowDown' && !open) {
              e.preventDefault()
              setOpen(true)
            }
          }}
          aria-label="Date (DD/MM/YYYY)"
          className={cn(
            'flex-1 min-w-0 bg-transparent border-0 outline-none num tracking-[0.01em]',
            'text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed'
          )}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen((o) => !o)
            // Take focus off the text input so the popover gets keyboard nav
            inputRef.current?.blur()
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Open calendar"
          className={cn(
            'flex-shrink-0 p-1 -m-1 rounded-md text-slate-400 hover:text-violet-700 hover:bg-violet-50',
            'focus:outline-none focus:text-violet-700 focus:bg-violet-50 transition-colors',
            'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400'
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Choose date"
          className={cn(
            'absolute z-30 left-0 bg-white border border-slate-200 rounded-xl shadow-xl p-3 w-[280px]',
            position === 'below' ? 'top-full mt-1' : 'bottom-full mb-1'
          )}
        >
          {/* Header — month + year jog */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous month"
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="flex items-center gap-1.5">
              <select
                value={cursor.m}
                onChange={(e) => setCursor((c) => ({ ...c, m: Number(e.target.value) }))}
                className="text-[13px] font-medium text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-violet-500 rounded px-1 py-0.5"
                aria-label="Month"
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
              <select
                value={cursor.y}
                onChange={(e) => setCursor((c) => ({ ...c, y: Number(e.target.value) }))}
                className="text-[13px] font-medium text-slate-800 num bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-violet-500 rounded px-1 py-0.5"
                aria-label="Year"
              >
                {yearRange.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={goNext}
              aria-label="Next month"
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Day-of-week labels */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAY_LABELS.map((d) => (
              <div key={d} className="meta-label text-center py-1.5 text-[10px]">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((cell, i) => {
              const iso = toISO(cell.y, cell.m, cell.d)
              const selected = parsed && parsed.y === cell.y && parsed.m === cell.m && parsed.d === cell.d
              const isToday = today.y === cell.y && today.m === cell.m && today.d === cell.d
              const outside = !cell.current
              const disabledCell = isOutOfRange(iso)
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabledCell}
                  onClick={() => {
                    onChange(iso)
                    setOpen(false)
                  }}
                  className={cn(
                    'h-8 w-full text-[12px] num rounded-md transition-colors flex items-center justify-center',
                    !selected && !disabledCell && 'hover:bg-violet-50 hover:text-violet-900',
                    outside && !selected ? 'text-slate-300' : 'text-slate-700',
                    selected && 'bg-violet-600 text-white font-semibold hover:bg-violet-700',
                    isToday && !selected && 'ring-1 ring-violet-300 text-violet-700 font-medium',
                    disabledCell && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-slate-300'
                  )}
                  aria-label={iso}
                  aria-selected={!!selected}
                >
                  {cell.d}
                </button>
              )
            })}
          </div>

          {/* Footer — quick actions */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                const iso = toISO(today.y, today.m, today.d)
                if (!isOutOfRange(iso)) {
                  onChange(iso)
                  setOpen(false)
                } else {
                  setCursor({ y: today.y, m: today.m })
                }
              }}
              className="text-[11px] font-medium text-violet-600 hover:text-violet-700"
            >
              Today
            </button>
            {value && !required && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
