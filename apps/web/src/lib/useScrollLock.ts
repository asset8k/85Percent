/**
 * useScrollLock — freeze the page (document/body) scroll while an overlay is open.
 *
 * Fixes two related issues with our overlays (the Copilot drawer + every modal):
 *  1. **Scroll chaining** — scrolling to the end of a panel's own scroll area
 *     used to bubble to the window, so the page behind the overlay moved.
 *  2. **Double scrollbar** — the page's scrollbar stayed live and interactive
 *     next to the panel's, so a wheel/drag over the overlay scrolled the page.
 *
 * While locked, `body` gets `overflow: hidden`. The width the scrollbar
 * occupied is replaced with equivalent right padding so the page underneath
 * doesn't shift left by a few pixels when the scrollbar disappears (a jump that
 * reads as a layout glitch when a modal opens).
 *
 * Reference-counted at module scope so stacked overlays (a modal that opens a
 * nested picker, or the drawer over a page that also has a modal) coordinate:
 * the lock is applied when the first overlay opens and released only when the
 * last one closes — they never fight over the body styles. React 18 StrictMode's
 * mount→cleanup→mount cycle nets to a single active lock.
 */

import { useLayoutEffect } from 'react'

let lockCount = 0
let savedOverflow = ''
let savedPaddingRight = ''

function applyLock() {
  const { body, documentElement } = document
  // Width of the now-hidden scrollbar, so we can pad it back and avoid a shift.
  const scrollbarWidth = window.innerWidth - documentElement.clientWidth

  savedOverflow = body.style.overflow
  savedPaddingRight = body.style.paddingRight

  body.style.overflow = 'hidden'
  if (scrollbarWidth > 0) {
    const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0
    body.style.paddingRight = `${current + scrollbarWidth}px`
  }
}

function releaseLock() {
  document.body.style.overflow = savedOverflow
  document.body.style.paddingRight = savedPaddingRight
}

/**
 * Lock page scroll while `active` is true (and the component is mounted).
 * Pass the overlay's open state; the lock tracks it and releases on close/unmount.
 */
export function useScrollLock(active = true) {
  useLayoutEffect(() => {
    if (!active) return
    if (lockCount === 0) applyLock()
    lockCount += 1
    return () => {
      lockCount -= 1
      if (lockCount === 0) releaseLock()
    }
  }, [active])
}
