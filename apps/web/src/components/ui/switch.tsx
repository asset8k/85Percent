import { forwardRef, useState, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// Accessible toggle switch — UI Kit violet when on, slate when off. Uses a
// native button under the hood so keyboard / SR consumers get sensible
// behavior. Pair with the surrounding label or pass `aria-label` directly.
//
// The hover tooltip is rendered via a portal to document.body so it escapes
// any ancestor `overflow:hidden` (e.g. the rounded saved-scenario rows on the
// Scenarios page, which clip overflow to keep the violet accent bar inside
// the row's rounded corners).
export interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  /** Hover tooltip — rendered in a portal so ancestor overflow can't clip it. */
  tooltip?: string
  /** Accessibility label when no visible label is associated. */
  'aria-label'?: string
  className?: string
}

const SIZES = {
  sm: { track: 'w-7 h-4', thumb: 'w-3 h-3', translate: 'translate-x-3' },
  md: { track: 'w-9 h-5', thumb: 'w-4 h-4', translate: 'translate-x-4' },
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, disabled, size = 'md', tooltip, className, ...rest },
  ref,
) {
  const [hovered, setHovered] = useState(false)
  const innerRef = useRef<HTMLButtonElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)

  const setRef = (node: HTMLButtonElement | null) => {
    innerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node
  }

  // Compute the tooltip anchor on every hover transition. useLayoutEffect runs
  // before paint, so the tooltip lands in the right spot on the first frame
  // rather than flickering.
  useLayoutEffect(() => {
    if (hovered && tooltip && innerRef.current) {
      const r = innerRef.current.getBoundingClientRect()
      setCoords({ top: r.top, right: window.innerWidth - r.right })
    } else if (!hovered) {
      setCoords(null)
    }
  }, [hovered, tooltip])

  const dims = SIZES[size]

  return (
    <span
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={setRef}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={rest['aria-label']}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) onChange(!checked)
        }}
        className={cn(
          'relative inline-flex items-center rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 focus:ring-offset-white',
          dims.track,
          checked ? 'bg-violet-600' : 'bg-slate-300',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'inline-block rounded-full bg-white shadow-sm transform transition-transform duration-150 ease-out',
            dims.thumb,
            checked ? dims.translate : 'translate-x-0.5',
          )}
        />
      </button>
      {tooltip && coords && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top - 8,
            right: coords.right,
            transform: 'translateY(-100%)',
            maxWidth: 240,
          }}
          className="pointer-events-none z-[1000] whitespace-normal rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg leading-snug"
        >
          {tooltip}
          <span
            className="absolute right-3 top-full block w-0 h-0"
            style={{
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid #0f172a', // slate-900
            }}
          />
        </div>,
        document.body,
      )}
    </span>
  )
})
