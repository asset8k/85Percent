import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'SSR Compliance Disclaimer',
  description:
    'The basis on which 85Percent presents Squad Cost Ratio compliance information.',
}

export default function SsrDisclaimerPage() {
  return (
    <LegalPage title="SSR Compliance Disclaimer">
      <p>
        85Percent provides modelling and monitoring tools relating to the Squad
        Cost Ratio (SCR). The figures and projections it produces are decision
        support, not regulatory determinations.
      </p>
      <h2>1. Not regulatory advice</h2>
      <p>
        Outputs are based on the data you provide and the rule parameters
        configured in the platform. Final compliance positions are determined by
        the relevant league and governing bodies.
      </p>
      <h2>2. Accuracy of inputs</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
      <h2>3. No warranty</h2>
      <p>Placeholder. Counsel-owned wording to follow.</p>
    </LegalPage>
  )
}
