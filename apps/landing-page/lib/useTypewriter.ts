'use client'

import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * useTypewriter — reveals `text` character-by-character once `active` is true, at a
 * steady chars-per-second cadence (no jitter, in keeping with the page's precise-
 * not-playful motion doctrine). Returns the revealed substring and a `done` flag so
 * callers can sequence one bubble after another. Under prefers-reduced-motion it
 * resolves the full string immediately.
 */
export function useTypewriter(
  text: string,
  { active, cps = 42 }: { active: boolean; cps?: number },
) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState('')

  useEffect(() => {
    if (!active) {
      setShown('')
      return
    }
    if (reduce) {
      setShown(text)
      return
    }
    setShown('')
    let i = 0
    const step = Math.max(16, 1000 / cps)
    const id = window.setInterval(() => {
      i += 1
      setShown(text.slice(0, i))
      if (i >= text.length) window.clearInterval(id)
    }, step)
    return () => window.clearInterval(id)
  }, [text, active, cps, reduce])

  return { shown, done: shown.length >= text.length }
}
