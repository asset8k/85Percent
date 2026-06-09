import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing use of the 85Percent platform.',
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These Terms of Service govern access to and use of the 85Percent platform
        and related services. By requesting access, you agree to the terms set out
        here once finalised.
      </p>
      <h2>1. Use of the service</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
      <h2>2. Accounts &amp; access</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
      <h2>3. Data &amp; confidentiality</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
      <h2>4. Liability</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
    </LegalPage>
  )
}
