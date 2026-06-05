/**
 * Wordmark — the 85Percent brand lockup. Pure typography, no SVG asset: a bold
 * violet "85" paired with a lighter slate "Percent", set in the UI Kit's Inter
 * stack with tight tracking. Shared by the Sidebar and the Login screen so the
 * brand stays in one place.
 */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-baseline select-none tracking-tight"
      style={{ fontSize: size, lineHeight: 1 }}
    >
      <span className="font-extrabold text-violet-700">85</span>
      <span className="font-semibold text-slate-900">Percent</span>
    </span>
  )
}
