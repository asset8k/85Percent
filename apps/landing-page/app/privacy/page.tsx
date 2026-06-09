import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How 85Percent collects, uses, and protects your information.',
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This Privacy Policy explains how 85Percent collects, uses, and protects
        personal information, including details submitted through the access
        request form.
      </p>
      <h2>1. Information we collect</h2>
      <p>
        When you request access we collect the name, work email, club, role, and
        any message you provide. These details are used solely to arrange and
        manage your access.
      </p>
      <h2>2. How we use it</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
      <h2>3. Storage &amp; security</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
      <h2>4. Your rights</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
    </LegalPage>
  )
}
