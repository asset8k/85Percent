import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { Providers } from './providers'
import { site } from '@/content/site'
import './globals.css'

// Self-hosted, no layout shift, no external request at runtime. Exposed as CSS
// variables so Tailwind's font-sans / font-display map straight onto them.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://85percent.com'),
  title: {
    default: '85Percent — The Squad Cost Engine',
    template: '%s — 85Percent',
  },
  description:
    'The definitive financial compliance platform for elite football clubs. Maximize your squad. Protect your points.',
  applicationName: '85Percent',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: '85Percent',
    title: '85Percent — The Squad Cost Engine',
    description:
      'The definitive financial compliance platform for elite football clubs. Maximize your squad. Protect your points.',
  },
  twitter: {
    card: 'summary_large_image',
    title: '85Percent — The Squad Cost Engine',
    description:
      'The definitive financial compliance platform for elite football clubs.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: site.name,
        url: site.url,
        slogan: site.tagline,
        email: site.contact.email,
        sameAs: [site.contact.linkedin],
      },
      {
        '@type': 'SoftwareApplication',
        name: site.name,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description:
          'Financial compliance platform for elite football clubs: real-time Squad Cost Ratio monitoring, transfer-window scenario planning, and an AI compliance analyst.',
        offers: { '@type': 'Offer', availability: 'https://schema.org/LimitedAvailability' },
      },
    ],
  }

  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <script
          type="application/ld+json"
          // Structured data for rich results — Organization + SoftwareApplication.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  )
}
