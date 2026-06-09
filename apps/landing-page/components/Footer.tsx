import { Linkedin, Mail, MessageCircle } from 'lucide-react'
import { Wordmark } from '@85percent/brand'
import { site } from '@/content/site'

/**
 * Footer — the trust & contact close (spec §5.5). Quiet and monochrome: the
 * lockup + tagline, jurisdictional legal links, and the three contact channels.
 * Server component — no interactivity, so it ships zero client JS.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-content px-6 py-16">
        <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
          {/* Brand block */}
          <div className="max-w-sm">
            <Wordmark size={30} />
            <p className="mt-4 font-display text-lg tracking-tight text-foreground">
              {site.tagline}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The definitive financial compliance platform for elite football clubs.
            </p>
          </div>

          {/* Legal */}
          <nav aria-label="Legal" className="flex flex-col gap-3">
            <h3 className="meta-label text-muted-foreground">Legal</h3>
            {site.legal.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Contact */}
          <div className="flex flex-col gap-3">
            <h3 className="meta-label text-muted-foreground">Contact</h3>
            <a
              href={`mailto:${site.contact.email}`}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              <Mail size={16} /> {site.contact.email}
            </a>
            <a
              href={site.contact.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              <Linkedin size={16} /> LinkedIn
            </a>
            <a
              href={site.contact.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
          </div>
        </div>

        <div className="mt-14 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">
            © 2026 {site.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
