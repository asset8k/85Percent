/**
 * FinancialsPage — the club's season financial configuration (revenue,
 * allowance, owner-equity top-up, squad-costs mode, promoted-club uplift).
 *
 * This is the CFO-controlled input that defines the Green/Red thresholds used
 * across the app. It used to live under Settings, but it's club compliance
 * configuration rather than a personal/workspace setting, so it now has its own
 * sidebar entry. The form itself is the shared FinancialTab component.
 */

import { FinancialTab } from '@/pages/ClubSetupPage'
import { Card } from '@/components/ui/card'
import { useCan } from '@/lib/role'

export function FinancialsPage() {
  const can = useCan()

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">Financials</h1>
          <p className="text-[13px] text-slate-400 mt-1.5">Revenue, allowance, and the figures that set your compliance thresholds</p>
        </div>
      </div>

      {can.editClubFinancials ? (
        <FinancialTab />
      ) : (
        <Card className="p-12 text-center">
          <p className="text-[15px] font-medium text-slate-900">Restricted to the CFO</p>
          <p className="text-[13px] text-slate-500 mt-2 max-w-md mx-auto">
            Only the CFO can edit the club's financial configuration. Ask your CFO if these figures need updating.
          </p>
        </Card>
      )}
    </div>
  )
}
