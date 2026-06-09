/**
 * Grain — a fine fractal-noise overlay that gives the dark bands an editorial,
 * "printed" texture and kills gradient banding. Pure SVG turbulence as a tiled
 * data-URI background, blended low. Server component, zero JS.
 */
const NOISE =
  "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>"

export function Grain({ opacity = 0.05 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        opacity,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(NOISE)}")`,
        backgroundSize: '200px 200px',
        mixBlendMode: 'overlay',
      }}
    />
  )
}
