import type { AmortisationEntry } from '@headroom/shared'
import { formatPence } from '@headroom/shared'

interface AmortisationTableProps {
  schedule: AmortisationEntry[]
}

const CURRENT_SEASON = '2026-27'

export function AmortisationTable({ schedule }: AmortisationTableProps) {
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className="text-left meta-label py-2 font-medium">Season</th>
          <th className="text-right meta-label py-2 font-medium">Amortisation</th>
          <th className="text-right meta-label py-2 font-medium">Remaining Book Value</th>
        </tr>
      </thead>
      <tbody>
        {schedule.length === 0 ? (
          <tr>
            <td colSpan={3} className="py-6 text-center text-sm text-slate-400">No fee to amortise.</td>
          </tr>
        ) : (
          schedule.map((row) => {
            const isCurrent = row.season === CURRENT_SEASON
            return (
              <tr
                key={row.season}
                className={`border-b border-slate-100 last:border-0 ${isCurrent ? 'bg-violet-50/60' : ''}`}
              >
                <td className={`num py-3 ${isCurrent ? 'text-violet-700 font-medium' : 'text-slate-600'}`}>
                  {row.season}
                  {isCurrent && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-violet-600">Current</span>
                  )}
                </td>
                <td className={`num py-3 text-right ${isCurrent ? 'text-violet-700 font-medium' : 'text-slate-900'}`}>
                  {formatPence(row.amortisationAmount)}
                </td>
                <td className={`num py-3 text-right ${isCurrent ? 'text-violet-700' : 'text-slate-500'}`}>
                  {formatPence(row.remainingBookValue)}
                </td>
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  )
}
