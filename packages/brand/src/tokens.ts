/**
 * Brand tokens — the canonical 85Percent colour + geometry constants, exported
 * so any consumer (app, landing page, OG image generator) reads the brand from
 * one place instead of hard-coding hexes. The source of truth for the mark's
 * geometry remains design/Logo/mark85.js; these mirror its gradient stops.
 */

/** The violet core of the mark — the "50%" gradient stop, used for accents/CTAs. */
export const VIOLET_CORE = '#6D28D9'

/** The Mark85 vertical gradient stops, tip → core → tip (offset, colour). */
export const MARK_GRADIENT_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0.0, '#FFFFFF'],
  [0.1, '#EADBFB'],
  [0.22, '#B98AF0'],
  [0.36, '#8B5CF6'],
  [0.5, '#6D28D9'],
  [0.64, '#8B5CF6'],
  [0.78, '#B98AF0'],
  [0.9, '#EADBFB'],
  [1.0, '#FFFFFF'],
]

/** The "violet-tip" accent ramp (core → mid → soft → wash) used across the site. */
export const VIOLET = {
  core: '#6D28D9',
  mid: '#8B5CF6',
  soft: '#B98AF0',
  wash: '#EADBFB',
} as const

/** Default lockup stroke weight (mark-space units) — keeps every lockup identical. */
export const WORDMARK_STROKE_WIDTH = 16.95
