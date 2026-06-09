/**
 * nav — the navbar anchor links and the primary CTA label. Anchors point at the
 * in-page section ids (set on each <section>); the CTA opens the demo-request
 * dialog rather than navigating.
 */

export const navLinks = [
  { label: 'The Rule', href: '#the-rule' },
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'Platform', href: '#platform' },
] as const

/** The recurring call-to-action label, used in the navbar, hero, and footer. */
export const CTA_LABEL = 'Request Access'

export type NavLink = (typeof navLinks)[number]
