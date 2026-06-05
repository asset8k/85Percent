/**
 * AI icon set — a single source of polished icons for the Compliance Analyst,
 * shared by the chat surface and the in-app triggers so the glyphs never drift.
 *
 * SparkIcon is the brand mark — an open compliance gauge (the SCR/headroom dial
 * that runs through the product) with a spark at its centre: 85Percent's own
 * "intelligence" glyph rather than the generic four-point AI sparkle. The rest
 * are crisp 2px stroke icons (compose, send, expand/collapse, etc.).
 */

interface IconProps {
  size?: number
  className?: string
}

function Stroke({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  )
}

/**
 * Brand / AI mark — an open gauge arc (the headroom dial, with its gap at the
 * bottom) wrapped around a centred spark. The spark says "AI"; the gauge makes
 * it unmistakably 85Percent's analyst, echoing the SCR dial and the context ring.
 */
export function SparkIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M5.6 18.4A9 9 0 1 1 18.4 18.4"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M12 7.4C12 10 14 12 16.6 12 14 12 12 14 12 16.6 12 14 10 12 7.4 12 10 12 12 10 12 7.4Z"
        fill="currentColor"
      />
    </svg>
  )
}

export const CloseIcon = ({ size, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Stroke>
)

/** New chat — a compose / square-pen glyph (more modern than a bare plus). */
export const ComposeIcon = ({ size, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </Stroke>
)

export const PlusIcon = ({ size, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
)

export const ExpandIcon = ({ size, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </Stroke>
)

export const CollapseIcon = ({ size, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </Stroke>
)

/** Send — a clean paper plane. */
export const SendIcon = ({ size, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </Stroke>
)

/** Stop — a filled rounded square. */
export const StopIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="6" y="6" width="12" height="12" rx="3" />
  </svg>
)

export const TrashIcon = ({ size = 14, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Stroke>
)

/** Source / rules reference — an open book. */
export const BookIcon = ({ size = 12, className }: IconProps) => (
  <Stroke size={size} className={className}>
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </Stroke>
)
