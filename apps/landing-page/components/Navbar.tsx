'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { Wordmark } from '@85percent/brand'
import { RequestAccessButton } from './RequestAccessButton'
import { EASE_EXPO } from './motion/variants'
import { navLinks } from '@/content/nav'

/**
 * Navbar — a floating frosted-glass "island" that hangs below the top edge with a
 * margin (spec §5.1). It's a subtle glass pill over the charcoal hero, then firms
 * into a defined deep-violet glass with a violet border, top-edge sheen and drop
 * shadow once scrolled. The bar stays dark in both states, so the white-tone lockup
 * and light links read throughout. Links carry an animated violet underline; the
 * CTA drifts its gradient. Mobile: hamburger → full-height motion sheet.
 */
export function Navbar({ forceSolid = false }: { forceSolid?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (forceSolid) return
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [forceSolid])

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [menuOpen])

  const solid = scrolled || forceSolid

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:px-6 sm:pt-4">
      <motion.nav
        className="relative mx-auto flex h-14 max-w-content items-center justify-between rounded-2xl border pl-5 pr-2.5"
        initial={false}
        animate={{
          backgroundColor: solid ? 'rgba(24,16,44,0.72)' : 'rgba(255,255,255,0.04)',
          borderColor: solid ? 'rgba(167,139,250,0.30)' : 'rgba(255,255,255,0.10)',
          boxShadow: solid
            ? '0 18px 50px -22px rgba(11,7,28,0.85), inset 0 1px 0 0 rgba(255,255,255,0.06)'
            : '0 8px 30px -22px rgba(11,7,28,0.6), inset 0 1px 0 0 rgba(255,255,255,0.05)',
        }}
        transition={{ duration: 0.4, ease: EASE_EXPO }}
        style={{ backdropFilter: solid ? 'blur(16px) saturate(150%)' : 'blur(8px)' }}
      >
        {/* Glass top-edge highlight — the polished-glass sheen. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
        />

        <a
          href={forceSolid ? '/' : '#top'}
          aria-label="85Percent home"
          className="relative inline-flex rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Wordmark size={34} tone="white" wordColor="#FFFFFF" fadeTo="#0B1020" interactive={false} />
        </a>

        {/* Desktop links + CTA */}
        <div className="hidden items-center gap-7 md:flex">
          <ul className="flex items-center gap-1 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={forceSolid ? `/${link.href}` : link.href}
                  className="group relative inline-flex rounded-lg px-3 py-2 text-white/70 transition-colors duration-200 hover:text-white"
                >
                  {link.label}
                  <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px origin-left scale-x-0 bg-violet-tip transition-transform duration-300 ease-out group-hover:scale-x-100" />
                </a>
              </li>
            ))}
          </ul>
          <RequestAccessButton variant="inverse" size="sm" source="navbar" gradientShift magnetic />
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-white transition-colors hover:bg-white/10 md:hidden"
        >
          <Menu size={22} />
        </button>
      </motion.nav>

      {/* Mobile full-height sheet */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="fixed inset-0 z-[60] bg-background md:hidden"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.4, ease: EASE_EXPO }}
          >
            <div className="flex h-16 items-center justify-between px-6">
              <Wordmark size={28} wordColor="#1E293B" fadeTo="#FFFFFF" />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-2 text-foreground"
              >
                <X size={22} />
              </button>
            </div>
            <div className="flex flex-col gap-2 px-6 pt-6">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="border-b border-border py-4 font-display text-2xl tracking-tight text-foreground"
                >
                  {link.label}
                </a>
              ))}
              <div className="pt-6">
                <RequestAccessButton variant="primary" size="lg" source="mobile-nav" className="w-full" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
