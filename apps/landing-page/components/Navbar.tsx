'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { Wordmark } from '@85percent/brand'
import { RequestAccessButton } from './RequestAccessButton'
import { EASE_EXPO } from './motion/variants'
import { navLinks } from '@/content/nav'

/**
 * Navbar — sticky, transparent over the charcoal hero, transitioning to a frosted
 * white bar once scrolled past it (spec §5.1). The Wordmark and links swap from
 * light to dark on the same boolean so the whole bar reads correctly on either
 * band — animated opacity, no jump. Mobile: hamburger → full-height motion sheet.
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

  const onLight = scrolled || forceSolid
  const linkColor = onLight ? 'text-muted-foreground hover:text-foreground' : 'text-white/70 hover:text-white'

  return (
    <motion.header
      className="fixed inset-x-0 top-0 z-50"
      initial={false}
      animate={{
        backgroundColor: onLight ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0)',
        borderColor: onLight ? 'hsl(var(--border))' : 'rgba(255,255,255,0)',
      }}
      transition={{ duration: 0.4, ease: EASE_EXPO }}
      style={{ backdropFilter: onLight ? 'blur(12px)' : 'none', borderBottomWidth: 1 }}
    >
      <nav className="mx-auto flex h-16 max-w-content items-center justify-between px-6">
        {/* The two lockups are stacked and cross-faded as the band changes:
            white-tone over the charcoal hero, violet-tone once scrolled to white.
            The first sits in flow (sets the footprint); the second overlays it. */}
        <a
          href={forceSolid ? '/' : '#top'}
          aria-label="85Percent — home"
          className="relative inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <motion.span
            className="block"
            initial={false}
            animate={{ opacity: onLight ? 0 : 1 }}
            transition={{ duration: 0.4, ease: EASE_EXPO }}
          >
            <Wordmark size={38} tone="white" wordColor="#FFFFFF" fadeTo="#0B1020" interactive={false} />
          </motion.span>
          <motion.span
            className="absolute inset-0 block"
            initial={false}
            animate={{ opacity: onLight ? 1 : 0 }}
            transition={{ duration: 0.4, ease: EASE_EXPO }}
          >
            <Wordmark size={38} tone="violet" wordColor="#1E293B" fadeTo="#FFFFFF" interactive={false} />
          </motion.span>
        </a>

        {/* Desktop links + CTA */}
        <div className="hidden items-center gap-8 md:flex">
          <ul className="flex items-center gap-7 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={forceSolid ? `/${link.href}` : link.href}
                  className={`transition-colors duration-200 ${linkColor}`}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <RequestAccessButton variant={onLight ? 'primary' : 'inverse'} size="sm" source="navbar" />
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className={`md:hidden rounded-md p-2 transition-colors ${onLight ? 'text-foreground' : 'text-white'}`}
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
