export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#6d28d9" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#6d28d9" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Full-pane loader using the Headroom mark — two violet pillars + a center
 * orbit that gently pulse like a heartbeat. The bars scale on Y so the "H"
 * appears to breathe; the orbit ring fades in sync. Much more branded than a
 * generic spinner.
 *
 * Use for first-load / blocking states only. For in-place updates prefer the
 * inline Spinner or a Skeleton screen, both of which feel lighter.
 */
export function PageLoader({ label }: { label?: string } = {}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] gap-4" aria-live="polite" aria-busy="true">
      <svg width={56} height={64} viewBox="0 0 18 22" fill="none" aria-hidden="true">
        <rect x="0" y="0" width="3.5" height="22" fill="#6d28d9" style={{ transformOrigin: '1.75px 11px', animation: 'hr-mark-bar 1.4s ease-in-out infinite' }} />
        <rect x="12.5" y="0" width="3.5" height="22" fill="#6d28d9" style={{ transformOrigin: '14.25px 11px', animation: 'hr-mark-bar 1.4s ease-in-out infinite', animationDelay: '180ms' }} />
        <rect x="3.5" y="9.75" width="9" height="2.5" fill="#6d28d9" opacity="0.85" />
        <rect x="5.5" y="0" width="5" height="3.5" fill="#6d28d9" style={{ animation: 'hr-mark-pulse 1.4s ease-in-out infinite' }} />
        <rect x="5.5" y="18.5" width="5" height="3.5" fill="#6d28d9" style={{ animation: 'hr-mark-pulse 1.4s ease-in-out infinite', animationDelay: '180ms' }} />
        <circle cx="8" cy="11" r="2.6" stroke="#6d28d9" strokeWidth="1" fill="none" style={{ animation: 'hr-mark-pulse 1.4s ease-in-out infinite' }} />
      </svg>
      {label && <p className="text-[12px] text-slate-500">{label}</p>}
    </div>
  )
}
