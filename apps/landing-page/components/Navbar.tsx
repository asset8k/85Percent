'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { Wordmark } from '@85percent/brand'
import { RequestAccessButton } from './RequestAccessButton'
import { EASE_EXPO } from './motion/variants'
import { navLinks } from '@/content/nav'

/**
 * Navbar — sticky, transparent over the charcoal hero, transitioning to a deep-
 * violet frosted-glass bar once scrolled past it (spec §5.1). The bar stays dark in
 * both states, so the white-tone lockup and light links read correctly throughout —
 * no light/dark swap needed. Mobile: hamburger → full-height motion sheet.
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
    <motion.header
      className="fixed inset-x-0 top-0 z-50"
      initial={false}
      animate={{
        backgroundColor: solid ? 'rgba(26,17,48,0.74)' : 'rgba(0,0,0,0)',
        borderColor: solid ? 'rgba(167,139,250,0.22)' : 'rgba(255,255,255,0)',
        boxShadow: solid ? '0 12px 40px -16px rgba(11,7,28,0.7)' : '0 0 0 0 rgba(0,0,0,0)',
      }}
      transition={{ duration: 0.4, ease: EASE_EXPO }}
      style={{ backdropFilter: solid ? 'blur(14px) saturate(140%)' : 'none', borderBottomWidth: 1 }}
    >
      <nav className="mx-auto flex h-16 max-w-content items-center justify-between px-6">
        <a
          href={forceSolid ? '/' : '#top'}
          aria-label="85Percent home"
          className="relative inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Wordmark size={38} tone="white" wordColor="#FFFFFF" fadeTo="#0B1020" interactive={false} />
        </a>

        {/* Desktop links + CTA */}
        <div className="hidden items-center gap-8 md:flex">
          <ul className="flex items-center gap-7 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={forceSolid ? `/${link.href}` : link.href}
                  className="text-white/70 transition-colors duration-200 hover:text-white"
                >
                  {link.label}
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
          className="rounded-md p-2 text-white transition-colors md:hidden"
        >
          <Menu size={22} />
        </button>
      </nav>

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
    </motion.header>
  )
}
