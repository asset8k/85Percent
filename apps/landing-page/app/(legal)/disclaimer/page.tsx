import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'SCR Compliance Disclaimer',
  description:
    'The basis on which 85Percent presents Squad Cost Ratio analysis, and the limits of that analysis.',
}

export default function DisclaimerPage() {
  return (
    <LegalPage
      title="SCR Compliance Disclaimer"
      eyebrow="Important notice"
      updated="10 June 2026"
      summary="85Percent is an analytical decision-support tool. It is not a regulator, an auditor, or a source of regulatory advice. This notice sets out the limits of what it does and where responsibility for a club’s compliance ultimately rests."
    >
      <p>
        85Percent provides modelling and monitoring relating to the Squad Cost Ratio
        (“SCR”) and related squad-cost controls. The figures, ratios, projections,
        and scenarios it produces are informational decision support only. They are
        not regulatory determinations and must not be treated as such. This notice
        forms part of, and should be read together with, our Website Terms of Use.
      </p>

      <h2>1. Not regulatory advice</h2>
      <p>
        85Percent is an analytical decision-support tool. It is not a governing body,
        a competition organiser, a licensed auditor, or a provider of legal,
        accounting, or regulatory advice, and using it creates no such relationship.
        It does not certify, approve, clear, or sanction any club, transaction, or
        submission. Only the relevant league, federation, or governing body (for
        example UEFA or the Premier League) can determine a club’s actual compliance
        position. Where you require a binding view, you should obtain advice from
        appropriately qualified professional advisers and confirm any position
        directly with the competent authority.
      </p>

      <h2>2. Accuracy of inputs and outputs</h2>
      <p>
        Outputs are deterministic: they are the arithmetic consequence of the data,
        assumptions, and rule parameters you and your club supply or configure. The
        platform does not independently verify, audit, or validate the underlying
        financial data. Inaccurate, incomplete, or out-of-date inputs will produce
        correspondingly unreliable outputs (“garbage in, garbage out”). You are
        responsible for the accuracy, completeness, and currency of the information
        entered, and for confirming that the rule parameters in use reflect the
        regulations applicable to your club for the relevant period.
      </p>

      <h2>3. Legacy and historical rules</h2>
      <p>
        Regulatory frameworks change, and the squad-cost regime has succeeded earlier
        controls. We expressly disclaim any liability for analyses, comparisons, or
        outputs relating to historical or superseded frameworks, including the
        Profitability and Sustainability Rules (“PSR”) and any prior financial fair
        play or cost-control regime. Where the platform references such frameworks, it
        does so for indicative or comparative purposes only, and no representation is
        made that any historical calculation reflects how a governing body did, or
        would, assess a club under the rules in force at the relevant time.
      </p>

      <h2>4. Assumption of risk</h2>
      <p>
        Clubs are solely and exclusively responsible for their own financial
        submissions, filings, and disclosures to UEFA, the Premier League, and any
        other competent authority, and for all decisions taken in reliance on any
        output of the platform. To the fullest extent permitted by law, the creators
        of 85Percent assume no liability whatsoever, and shall not be liable to any
        club, individual, or third party, for any sporting sanction, points
        deduction, transfer restriction, fine, financial levy, exclusion, or other
        penalty, or for any direct, indirect, or consequential loss, arising out of or
        in connection with the use of, or reliance on, the platform or its outputs.
      </p>

      <h2>5. No warranty</h2>
      <p>
        The platform and its outputs are provided on an “as is” and “as available”
        basis, without warranty of any kind, whether express or implied, including any
        warranty of accuracy, fitness for a particular purpose, or non-infringement.
        Nothing in this notice excludes or limits any liability that cannot lawfully be
        excluded or limited.
      </p>

      <h2>6. Contact</h2>
      <p>
        If anything in this notice is unclear, contact us at{' '}
        <a href="mailto:contact@85percent.pro">contact@85percent.pro</a> before
        relying on the platform for a compliance-sensitive decision.
      </p>
    </LegalPage>
  )
}
