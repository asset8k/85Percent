/**
 * SparkIcon — 85Percent's own AI mark, ported verbatim from the product app
 * (apps/web/src/components/ai/icons.tsx) so the marketing site and the app share
 * one glyph. It's an open compliance-gauge arc (the SCR/headroom dial) wrapped
 * around a centred spark: the gauge makes it unmistakably 85Percent's analyst,
 * the spark says "AI" — deliberately not the generic four-point sparkle.
 *
 * Signature matches lucide (size/className/strokeWidth) so it drops into the same
 * icon slots; strokeWidth is accepted-and-ignored since the mark is path-defined.
 */
export function SparkIcon({
  size = 16,
  className,
}: {
  size?: number | string
  className?: string
  strokeWidth?: number | string
}) {
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
