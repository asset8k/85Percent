'use client'

import { useId } from 'react'

/**
 * Mark85 — the standalone "85" brand mark (logo Option 1). A monoline,
 * hexagonally-constructed "8" and "5" whose strokes are read top-to-bottom: the
 * outer tips dissolve into white, materialising inward to a brand-violet core
 * (#6D28D9) and fading back to white at the bottom anchors. Geometry, gradient
 * and the single free-end fade are a faithful port of the design source
 * (design/Logo/mark85.js, "gradient" mode) — edit the mark there, then re-port.
 *
 * `size` is the rendered height in px; width follows the mark's aspect ratio.
 * `fadeTo` is the surface colour the tips melt into — keep it equal to the
 * background behind the mark (white on light surfaces). `strokeWidth` sets the
 * line weight in mark-space units (the 440×420 viewBox), so the same value gives
 * proportionally identical boldness at any `size` — that's how every 85Percent
 * lockup stays the same weight regardless of where it's rendered. Omit it to fall
 * back to the source's size-relative default.
 */
export function Mark85({
  size = 32,
  fadeTo = '#FFFFFF',
  strokeWidth,
  title,
  tone = 'violet',
}: {
  size?: number
  fadeTo?: string
  strokeWidth?: number
  title?: string
  /**
   * 'violet' (default) — white tips melting to `fadeTo`, brand-violet core. Reads
   * on light surfaces. 'white' — a bright white-cored mark whose tips melt to
   * `fadeTo`, for dark / brand-violet bands (the navbar over the charcoal hero).
   */
  tone?: 'violet' | 'white'
}) {
  const uid = useId().replace(/:/g, '')
  const main = `m85-${uid}`
  const fade = `m85f-${uid}`
  const h = size
  const w = h * (440 / 420)
  const sw = strokeWidth ?? Math.max(2.4, 7 * (h / 300) + 1.6)
  const M = `url(#${main})`
  const F = `url(#${fade})`
  const white = tone === 'white'
  return (
    <svg
      width={w}
      height={h}
      viewBox="40 40 440 420"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible', display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={main} x1="0" y1="42" x2="0" y2="458" gradientUnits="userSpaceOnUse">
          {white ? (
            <>
              <stop offset="0" stopColor={fadeTo} />
              <stop offset="0.12" stopColor="#C9B3F2" />
              <stop offset="0.30" stopColor="#FFFFFF" />
              <stop offset="0.50" stopColor="#FFFFFF" />
              <stop offset="0.70" stopColor="#FFFFFF" />
              <stop offset="0.88" stopColor="#C9B3F2" />
              <stop offset="1" stopColor={fadeTo} />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="0.10" stopColor="#EADBFB" />
              <stop offset="0.22" stopColor="#B98AF0" />
              <stop offset="0.36" stopColor="#8B5CF6" />
              <stop offset="0.50" stopColor="#6D28D9" />
              <stop offset="0.64" stopColor="#8B5CF6" />
              <stop offset="0.78" stopColor="#B98AF0" />
              <stop offset="0.90" stopColor="#EADBFB" />
              <stop offset="1" stopColor="#FFFFFF" />
            </>
          )}
        </linearGradient>
        <linearGradient id={fade} x1="270" y1="372" x2="270" y2="343" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={white ? '#FFFFFF' : '#be93f1'} />
          <stop offset="1" stopColor={fadeTo} />
        </linearGradient>
      </defs>
      <g strokeWidth={sw} strokeLinecap="round" fill="none">
        {/* EIGHT */}
        <line x1="100" y1="132" x2="248.1" y2="42.24" stroke={M} />
        <line x1="232" y1="132" x2="83.9" y2="42.24" stroke={M} />
        <line x1="100" y1="132" x2="100" y2="212" stroke={M} />
        <line x1="232" y1="132" x2="232" y2="212" stroke={M} />
        <line x1="100" y1="212" x2="157" y2="250" stroke={M} />
        <line x1="232" y1="212" x2="175" y2="250" stroke={M} />
        <line x1="100" y1="292" x2="157" y2="250" stroke={M} />
        <line x1="232" y1="292" x2="175" y2="250" stroke={M} />
        <line x1="100" y1="292" x2="100" y2="372" stroke={M} />
        <line x1="232" y1="292" x2="232" y2="372" stroke={M} />
        <line x1="100" y1="372" x2="249.2" y2="457.9" stroke={M} />
        <line x1="232" y1="372" x2="82.8" y2="457.9" stroke={M} />
        {/* FIVE */}
        <line x1="270" y1="132" x2="418.1" y2="42.24" stroke={M} />
        <line x1="336" y1="92" x2="253.9" y2="42.24" stroke={M} />
        <line x1="270" y1="132" x2="270" y2="240" stroke={M} />
        <line x1="270" y1="240" x2="336" y2="222" stroke={M} />
        <line x1="336" y1="222" x2="402" y2="260" stroke={M} />
        <line x1="402" y1="260" x2="402" y2="372" stroke={M} />
        <line x1="402" y1="372" x2="252.8" y2="457.9" stroke={M} />
        <line x1="270" y1="372" x2="419.2" y2="457.9" stroke={M} />
        <line x1="270" y1="372" x2="270" y2="343" stroke={F} />
      </g>
    </svg>
  )
}
