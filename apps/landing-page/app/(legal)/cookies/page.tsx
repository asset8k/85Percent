import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'How the 85Percent website uses cookies and similar technologies.',
}

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated="10 June 2026"
      summary="This policy explains how cookies and similar technologies are used on the 85Percent website, in line with UK and EU requirements (PECR and the GDPR)."
    >
      <p>
        This Cookie Policy is provided by the creators of 85Percent and applies to
        our marketing website. It should be read together with our{' '}
        <a href="/privacy">Privacy Policy</a>. Cookies are small text files placed on
        your device when you visit a website; they are widely used to make sites work,
        to make them work more efficiently, and to provide information to site
        operators.
      </p>

      <h2>1. The cookies we use</h2>
      <p>We use a small, deliberately limited set of cookies and similar technologies.</p>
      <h3>Strictly necessary cookies</h3>
      <p>
        These are essential for the website to function. They support basic
        functionality such as page routing and navigation, load balancing, and
        security, such as protecting forms against abuse and maintaining the
        integrity of your session. The website cannot operate properly without them,
        and they do not require consent.
      </p>
      <h3>Analytics cookies</h3>
      <p>
        We use basic, privacy-respecting analytics to understand aggregate site
        traffic (such as which pages are visited and how visitors arrive) so that we
        can improve the site. This information is used in aggregate and is not used to
        identify you individually or to build an advertising profile. Where required,
        these are set only with your consent.
      </p>

      <h2>2. What we do not use</h2>
      <p>
        We do not use advertising or cross-site tracking cookies, and we do not sell
        any information derived from cookies. We do not use cookies to profile you for
        marketing purposes.
      </p>

      <h2>3. Current status</h2>
      <p>
        Our website is intentionally lightweight, and at present we set only the
        strictly necessary cookies required for it to function. This policy also
        describes the limited analytics cookies we may introduce as the site develops,
        so that our disclosure remains accurate and ahead of any change. Where consent
        is required for non-essential cookies, we will ask for it before any such
        cookie is set.
      </p>

      <h2>4. Managing cookies</h2>
      <p>
        You can control and delete cookies through your browser settings, including
        blocking some or all cookies or asking to be notified when one is set. Most
        browsers also offer a “do not track” signal. Please note that blocking
        strictly necessary cookies may prevent parts of the website from working
        correctly.
      </p>

      <h2>5. Contact</h2>
      <p>
        Questions about our use of cookies can be sent to{' '}
        <a href="mailto:contact@85percent.pro">contact@85percent.pro</a>. We may update
        this policy from time to time; the date above reflects the latest revision.
      </p>
    </LegalPage>
  )
}
