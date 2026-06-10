/**
 * site — the single source of brand, contact, and legal strings for the
 * marketing site. Centralised and typed so copy review happens in PRs and i18n
 * is a later drop-in. No component hard-codes a brand string; it reads from here.
 */

export const site = {
  name: '85Percent',
  tagline: 'The Squad Cost Engine.',
  domain: '85percent.com',
  url: 'https://85percent.com',

  /** Contact channels surfaced in the footer. */
  contact: {
    email: 'contact@85percent.pro',
    linkedin: 'https://www.linkedin.com/company/85percent',
    // TODO: replace with the real WhatsApp number (digits only, intl format,
    // no '+') once provided — e.g. wa.me/447700900000.
    whatsapp: 'https://wa.me/00000000000',
  },

  /** Jurisdictional & legal routes — the /(legal) route group. */
  legal: [
    { label: 'Website Terms of Use', href: '/terms' },
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'SCR Compliance Disclaimer', href: '/disclaimer' },
    { label: 'Cookie Policy', href: '/cookies' },
  ],
} as const

export type Site = typeof site
