import { Linkedin, Mail, MessageCircle, ArrowUp } from 'lucide-react'
import { Mark85, Wordmark } from '@85percent/brand'
import { Aurora } from './atmosphere/Aurora'
import { Grain } from './atmosphere/Grain'
import { RequestAccessButton } from './RequestAccessButton'
import { site } from '@/content/site'
import { navLinks } from '@/content/nav'

/**
 * Footer — the royal close. A charcoal band lit by the same drifting aurora as the
 * hero, with a giant ghost "85" watermark, a final headline + Request Access CTA, a
 * gradient hairline, four refined columns, and a back-to-top. It rhymes with the
 * top of the page so the site bookends in the same expensive register rather than
 * trailing off into a quiet light strip.
 */
export function Footer() {
  return (
    <footer data-nav-theme="dark" className="relative isolate overflow-hidden bg-charcoal text-white">
      <Aurora className="opacity-45" />
      <Grain opacity={0.04} />

      {/* Giant ghost mark — a regal watermark bleeding off the corner. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -right-20 opacity-[0.04]"
      >
        <Mark85 size={560} tone="white" />
      </div>

      <div className="relative z-10 mx-auto max-w-content px-6">
        {/* Closing CTA */}
        <div className="grid gap-10 py-20 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div>
            <span className="meta-label text-violet-soft">Request access</span>
            <h2 className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.01em] sm:text-5xl">
              Win the transfer window.
              <br />
              <span className="text-gradient-violet">Within the rules.</span>
            </h2>
          </div>
          <div className="lg:text-right">
            <p className="mb-5 text-white/55">
              Limited onboarding for the 2025/26 window.
            </p>
            <RequestAccessButton
              variant="primary"
              size="lg"
              source="footer"
              magnetic
            />
          </div>
        </div>

        {/* Gradient hairline */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-mid/40 to-transparent" />

        {/* Columns */}
        <div className="grid grid-cols-2 gap-10 py-16 lg:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-1">
            <Wordmark size={34} tone="white" wordColor="#FFFFFF" fadeTo="#0B1020" />
            <p className="mt-5 font-display text-lg italic text-white/85">
              {site.tagline}
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/50">
              The definitive financial compliance platform for elite football clubs.
            </p>
          </div>

          {/* Explore */}
          <nav aria-label="Sections" className="flex flex-col gap-3">
            <h3 className="meta-label text-white/40">Explore</h3>
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Legal */}
          <nav aria-label="Legal" className="flex flex-col gap-3">
            <h3 className="meta-label text-white/40">Legal</h3>
            {site.legal.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Contact */}
          <div className="flex flex-col gap-3">
            <h3 className="meta-label text-white/40">Contact</h3>
            {[
              { Icon: Mail, label: site.contact.email, href: `mailto:${site.contact.email}`, ext: false },
              { Icon: Linkedin, label: 'LinkedIn', href: site.contact.linkedin, ext: true },
              { Icon: MessageCircle, label: 'WhatsApp', href: site.contact.whatsapp, ext: true },
            ].map(({ Icon, label, href, ext }) => (
              <a
                key={label}
                href={href}
                {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="group inline-flex items-center gap-2.5 text-sm text-white/60 transition-colors hover:text-white"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 transition-colors group-hover:border-violet-mid/50 group-hover:bg-violet-tip group-hover:text-white">
                  <Icon size={15} />
                </span>
                {label}
              </a>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col gap-4 border-t border-white/10 py-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/45">
            © 2026 {site.name}. All rights reserved.
          </p>
          <a
            href="#top"
            className="group inline-flex items-center gap-1.5 text-xs font-medium text-white/55 transition-colors hover:text-white"
          >
            Back to top
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 transition-colors group-hover:border-violet-mid/50 group-hover:bg-white/5">
              <ArrowUp size={13} />
            </span>
          </a>
        </div>
      </div>
    </footer>
  )
}
