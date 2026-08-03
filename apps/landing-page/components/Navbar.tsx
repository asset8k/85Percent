'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { Wordmark } from '@85percent/brand'
import { RequestAccessButton } from './RequestAccessButton'
import { EASE_EXPO } from './motion/variants'
import { navLinks } from '@/content/nav'

type NavTheme = 'dark' | 'light'

/**
 * Navbar — a floating frosted-glass "island" that hangs below the top edge with a
 * margin (spec §5.1). It is *section-aware*: as the page scrolls, the bar reads the
 * `data-nav-theme` of whichever section sits under it and switches state to stay
 * legible over that background — a deep-violet glass with a white lockup over the
 * charcoal bands, and a bright white glass with the violet lockup over the light
 * bands. The "85" mark itself cross-fades between its white-cored and violet-cored
 * forms so it always reads on the surface behind it. Links, the top-edge sheen and
 * the mobile trigger adopt the same theme; the CTA keeps its drifting violet
 * gradient throughout. Mobile: hamburger → full-height motion sheet.
 */
export function Navbar({ forceSolid = false }: { forceSolid?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // Legal pages (forceSolid) sit on the deep-slate band, continuous with the dark
  // footer, so the bar stays dark and solid throughout. The home page opens over
  // the charcoal hero, so it also starts dark and then tracks the section beneath
  // it. Initialising from the same prop on server and client keeps hydration in sync.
  const [theme, setTheme] = useState<NavTheme>('dark')

  useEffect(() => {
    if (forceSolid) return
    let raf = 0
    // Detection line ~ the bar's vertical centre (pt + half the 56px pill height).
    const LINE = 52
    const measure = () => {
      raf = 0
      setScrolled(window.scrollY > 24)
      let next: NavTheme = 'dark'
      for (const el of document.querySelectorAll<HTMLElement>('[data-nav-theme]')) {
        const r = el.getBoundingClientRect()
        if (r.top <= LINE && r.bottom > LINE) {
          next = el.dataset.navTheme === 'light' ? 'light' : 'dark'
          break
        }
      }
      setTheme(next)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
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
  const dark = theme === 'dark'

  const surface = dark
    ? {
        backgroundColor: solid ? 'rgba(24,16,44,0.72)' : 'rgba(255,255,255,0.04)',
        borderColor: solid ? 'rgba(167,139,250,0.30)' : 'rgba(255,255,255,0.10)',
        boxShadow: solid
          ? '0 18px 50px -22px rgba(11,7,28,0.85), inset 0 1px 0 0 rgba(255,255,255,0.06)'
          : '0 8px 30px -22px rgba(11,7,28,0.6), inset 0 1px 0 0 rgba(255,255,255,0.05)',
      }
    : {
        backgroundColor: solid ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.45)',
        borderColor: solid ? 'rgba(109,40,217,0.18)' : 'rgba(15,23,42,0.08)',
        boxShadow: solid
          ? '0 18px 50px -24px rgba(76,29,149,0.30), inset 0 1px 0 0 rgba(255,255,255,0.70)'
          : '0 8px 30px -24px rgba(76,29,149,0.18), inset 0 1px 0 0 rgba(255,255,255,0.55)',
      }

  return (
    <header className="hero-header-reveal fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:px-6 sm:pt-4">
      <motion.nav
        className="relative mx-auto flex h-14 max-w-content items-center justify-between rounded-2xl border pl-5 pr-2.5"
        initial={false}
        animate={surface}
        transition={{ duration: 0.45, ease: EASE_EXPO }}
        style={{ backdropFilter: solid ? 'blur(16px) saturate(150%)' : 'blur(8px)' }}
      >
        {/* Glass top-edge highlight — white sheen on the dark glass, violet on light. */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent to-transparent transition-colors duration-500 ${
            dark ? 'via-white/30' : 'via-primary/25'
          }`}
        />

        <a
          href={forceSolid ? '/' : '#top'}
          aria-label="85Percent home"
          className="relative inline-flex rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {/* The mark cross-fades between its white-cored and violet-cored forms. */}
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={theme}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE_EXPO }}
              className="inline-flex"
            >
              {dark ? (
                <Wordmark size={34} tone="white" wordColor="#FFFFFF" fadeTo="#0B1020" interactive={false} />
              ) : (
                <Wordmark size={34} tone="violet" wordColor="#1E293B" fadeTo="#FFFFFF" interactive={false} />
              )}
            </motion.span>
          </AnimatePresence>
        </a>

        {/* Desktop links + CTA */}
        <div className="hidden items-center gap-7 md:flex">
          <ul className="flex items-center gap-1 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={forceSolid ? `/${link.href}` : link.href}
                  className={`group relative inline-flex rounded-lg px-3 py-2 transition-colors duration-300 ${
                    dark ? 'text-white/70 hover:text-white' : 'text-[#1E293B]/65 hover:text-[#1E293B]'
                  }`}
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
          className={`rounded-lg p-2 transition-colors md:hidden ${
            dark ? 'text-white hover:bg-white/10' : 'text-[#1E293B] hover:bg-black/5'
          }`}
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
