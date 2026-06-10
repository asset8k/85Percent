import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How the 85Percent project collects, uses, and protects the information you provide.',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="10 June 2026"
      summary="This notice explains how we handle the personal information you provide through this website, principally the details submitted when you request access. It is written to reflect the principles of the UK GDPR and the EU General Data Protection Regulation."
    >
      <p>
        This Privacy Policy is provided by the creators of 85Percent (“we”, “us”,
        “our”), an independent software project. It applies to personal information
        collected through our marketing website. As the project is not presently an
        incorporated entity, we act as the controllers of the limited information
        described below and handle it on the basis set out here.
      </p>

      <h2>1. Information we collect</h2>
      <p>
        We collect only the information you choose to give us. When you complete the
        access-request form, we collect:
      </p>
      <ul>
        <li>your name;</li>
        <li>your work email address;</li>
        <li>the club or organisation you represent;</li>
        <li>your role; and</li>
        <li>any message or context you choose to include.</li>
      </ul>
      <p>
        We do not ask for special-category data, and you should not submit it. We do
        not run advertising trackers or build marketing profiles from your visit.
      </p>

      <h2>2. How we use your information</h2>
      <p>
        We use the information you provide strictly to respond to your enquiry: that
        is, to arrange and manage access to the software and to communicate with you
        about 85Percent. We do not use your details for unrelated marketing. Our
        lawful basis is our legitimate interest in responding to a business enquiry
        that you have initiated, and, where relevant, taking steps at your request
        prior to any future arrangement.
      </p>

      <h2>3. How we share it</h2>
      <p>
        <strong>We never sell your information to third parties.</strong> We do not
        share it for any third party’s independent marketing. We may rely on a small
        number of trusted service providers (for example, hosting and email
        delivery) who process information on our instructions and under appropriate
        confidentiality obligations, solely to enable the communication described
        above. We may disclose information where required to do so by law.
      </p>

      <h2>4. Storage and security</h2>
      <p>
        We retain the information you submit only for as long as is necessary to deal
        with your enquiry and to maintain a record of our correspondence, after which
        it is deleted. We apply appropriate technical and organisational measures to
        protect it against unauthorised access, loss, or disclosure. No method of
        transmission or storage is completely secure, and we cannot guarantee
        absolute security.
      </p>

      <h2>5. Your rights</h2>
      <p>
        Subject to applicable law, you have the right to access the personal
        information we hold about you, to have it corrected or updated, to object to
        or restrict our use of it, to data portability, and, at any time, to
        request that we delete it. To exercise any of these rights, simply contact us
        and we will action your request without undue delay. You also have the right
        to lodge a complaint with your local data protection authority; in the United
        Kingdom this is the Information Commissioner’s Office (ICO).
      </p>

      <h2>6. International transfers</h2>
      <p>
        Where information is processed outside your home jurisdiction by one of our
        service providers, we take reasonable steps to ensure it remains protected by
        appropriate safeguards consistent with the standards described in this notice.
      </p>

      <h2>7. Contact</h2>
      <p>
        To exercise your rights or ask any question about this notice, contact us at{' '}
        <a href="mailto:contact@85percent.pro">contact@85percent.pro</a>. We may
        update this Privacy Policy from time to time; the date above reflects the
        latest revision.
      </p>
    </LegalPage>
  )
}
