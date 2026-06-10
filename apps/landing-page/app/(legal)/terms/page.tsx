import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Website Terms of Use',
  description:
    'The terms governing use of the public 85Percent marketing website.',
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Website Terms of Use"
      updated="10 June 2026"
      summary="These terms govern your use of this website. They are website terms only. They do not constitute a software licence, a service agreement, or any contract for the supply of the 85Percent platform."
    >
      <p>
        This website is operated by the creators of 85Percent (“we”, “us”, “our”),
        an independent software project. 85Percent is not at present an
        incorporated entity, and nothing on this website should be read as an offer
        capable of acceptance, a binding commercial proposal, or a contract for
        software or services. These Website Terms of Use (“Terms”) apply solely to
        your access to and use of the public marketing website at our domain (the
        “Website”).
      </p>

      <h2>1. Acceptance of these Terms</h2>
      <p>
        By accessing, browsing, or otherwise using the Website, you confirm that you
        have read, understood, and agree to be bound by these Terms. If you do not
        agree, you must not use the Website. Your continued use following any update
        to these Terms constitutes acceptance of the revised version. We may revise
        these Terms at any time by amending this page, and it is your responsibility
        to review it periodically.
      </p>

      <h2>2. Intellectual property</h2>
      <p>
        All content on the Website, including the name “85Percent”, the “85” mark
        and wordmark, logos, the user-interface designs and product imagery,
        copy, typography, graphics, and the arrangement and presentation of each of
        the foregoing, is owned by or licensed to the creators of 85Percent and is
        protected by copyright, trade mark, database, and other intellectual
        property rights.
      </p>
      <p>
        You are granted a limited, revocable, non-exclusive licence to view the
        Website for your own informational purposes only. You may not copy,
        reproduce, republish, frame, distribute, modify, create derivative works
        from, or otherwise commercially exploit any part of the Website without our
        prior written consent. No right or licence is granted in respect of any
        trade mark or brand element displayed on the Website.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree that you will not, and will not attempt to:</p>
      <ul>
        <li>
          scrape, crawl, harvest, index, mirror, or otherwise extract data or
          content from the Website by any automated or systematic means;
        </li>
        <li>
          submit false, misleading, or another person’s details through the contact,
          access-request, or waitlist forms, or use those forms to transmit spam,
          solicitations, or unsolicited communications;
        </li>
        <li>
          submit any forms in a bulk, automated, or abusive manner, or in a way
          designed to overload, disrupt, or interfere with their operation;
        </li>
        <li>
          probe, scan, or test the vulnerability of the Website or any associated
          system or network, or breach or circumvent any security or authentication
          measure;
        </li>
        <li>
          introduce any malware, virus, or other harmful code, or use the Website in
          any way that is unlawful, fraudulent, or otherwise harmful, or that
          infringes the rights of any other person.
        </li>
      </ul>

      <h2>4. Third-party links</h2>
      <p>
        The Website may contain links to third-party websites and resources. Those
        links are provided for your convenience only. We have no control over, and
        accept no responsibility for, the content, availability, or practices of any
        third-party site, and the inclusion of any link does not imply endorsement.
      </p>

      <h2>5. Limitation of liability</h2>
      <p>
        The Website and all content on it are provided on an “as is” and “as
        available” basis, without warranties or representations of any kind, whether
        express or implied. We do not warrant that the Website will be accurate,
        complete, current, uninterrupted, secure, or free of errors or harmful
        components.
      </p>
      <p>
        To the fullest extent permitted by law, we exclude all liability, whether
        in contract, tort (including negligence), or otherwise, for any loss or
        damage arising out of or in connection with your use of, or inability to use,
        the Website, or your reliance on any content displayed on it. Nothing in
        these Terms excludes or limits any liability that cannot lawfully be excluded
        or limited.
      </p>

      <h2>6. Governing law</h2>
      <p>
        These Terms, and any dispute or claim arising out of or in connection with
        them, are governed by and construed in accordance with the laws of England
        and Wales, and the courts of England and Wales shall have exclusive
        jurisdiction.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions about these Terms can be directed to{' '}
        <a href="mailto:contact@85percent.pro">contact@85percent.pro</a>.
      </p>
    </LegalPage>
  )
}
