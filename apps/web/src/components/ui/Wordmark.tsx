import { Mark85 } from '@/components/ui/Mark85'

/**
 * Wordmark — the 85Percent primary lockup (logo Option 2): the gradient "85"
 * mark set beside "Percent" in Space Grotesk, kept light (weight 400) and
 * smaller so the mark leads. Shared by the Sidebar (top-left) and the Login
 * screen so the brand lives in one place.
 *
 * `size` is the base lockup scale in px: the word ("Percent") size and gap derive
 * from it to hold the design proportions. `markScale` independently scales just
 * the "85" mark relative to that base (1 = matched to the word; 1.25 = mark a
 * quarter larger while the word stays put). The lockup is rendered as a clickable
 * control — it is inert for now (no navigation); pass `onClick` (or swap to a
 * router link) once the marketing landing page exists.
 */
export function Wordmark({
  size = 30,
  markScale = 1,
  gap,
  onClick,
}: {
  size?: number
  markScale?: number
  /** Absolute gap (px) between the mark and "Percent". Defaults to a value
   * proportional to the mark height; set it explicitly to keep the spacing
   * identical across placements that use different scales. */
  gap?: number
  onClick?: () => void
}) {
  const wordSize = Math.round(size * 0.452 * 10) / 10
  const markHeight = size * markScale
  const gapPx = gap ?? markHeight * 0.18
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="85Percent"
      className="inline-flex items-center select-none cursor-pointer bg-transparent border-0 p-0 m-0 transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 rounded-md"
      style={{ gap: gapPx, fontSize: 0, lineHeight: 0 }}
    >
      <Mark85 size={markHeight} fadeTo="#FFFFFF" strokeWidth={16.95} />
      <span
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontWeight: 400,
          fontSize: wordSize,
          letterSpacing: '-0.015em',
          lineHeight: 1,
          color: '#1E293B',
        }}
      >
        Percent
      </span>
    </button>
  )
}
