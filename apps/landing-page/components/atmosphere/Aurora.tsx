/**
 * Aurora — the living violet light behind the dark bands. Three large, blurred,
 * screen-blended blobs drift on long offset loops (see globals `.aurora-blob`), so
 * the charcoal reads as deep, lit atmosphere instead of a flat fill. Server
 * component — pure CSS, zero client JS; reduced-motion holds it still.
 */
export function Aurora({ className = '' }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
    >
      <div className="aurora-blob aurora-blob--a" />
      <div className="aurora-blob aurora-blob--b" />
      <div className="aurora-blob aurora-blob--c" />
    </div>
  )
}
