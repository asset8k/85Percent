import { Card } from '@/components/ui/card'

interface ComplianceEvent {
  date: string
  kind: 'checkpoint' | 'compliance' | 'window' | 'deadline'
  name: string
  desc: string
  key?: boolean
}

const CALENDAR_EVENTS: ComplianceEvent[] = [
  { date: '01 Jul 2026', kind: 'window',     name: 'Summer Transfer Window Opens',        desc: 'Domestic transfers between EFL clubs now permitted.' },
  { date: '01 Sep 2026', kind: 'deadline',   name: 'Summer Window Deadline',              desc: 'Final day for permanent transfers in the summer window.' },
  { date: '30 Sep 2026', kind: 'checkpoint', name: 'Q1 Squad Cost Reconciliation',        desc: 'Internal reconciliation of squad costs against budget. No filing required.' },
  { date: '01 Jan 2027', kind: 'window',     name: 'January Transfer Window Opens',       desc: 'Mid-season window — most simulation activity occurs here.' },
  { date: '31 Jan 2027', kind: 'deadline',   name: 'January Window Deadline',             desc: 'Final day for January transfers. SCR exposure locks in for the second half-season.' },
  { date: '01 Mar 2027', kind: 'compliance', name: 'Main SCR Compliance Test',            desc: 'Primary regulatory checkpoint. Clubs must demonstrate squad costs are within the calculated threshold.', key: true },
  { date: '15 Apr 2027', kind: 'checkpoint', name: 'Pre-Season-End Position Review',      desc: 'EFL provisional review of clubs trending toward breach.' },
  { date: '31 May 2027', kind: 'deadline',   name: 'Season End — Accounts Cutoff',        desc: 'Fiscal close for the 2026/27 squad cost calculation period.' },
  { date: '15 Jun 2027', kind: 'compliance', name: 'Accounts Confirmation Test',          desc: 'Final audited submission. Sanctions confirmed for the season just ended.', key: true },
  { date: '01 Jul 2027', kind: 'window',     name: 'Summer Transfer Window Opens (27/28)', desc: 'Beginning of the 2027/28 cycle.' },
]

const KIND_META = {
  checkpoint: { label: 'CHECKPOINT',      cls: 'bg-slate-100 text-slate-600' },
  compliance: { label: 'COMPLIANCE TEST', cls: 'bg-violet-100 text-violet-700' },
  window:     { label: 'TRANSFER WINDOW', cls: 'bg-blue-100 text-blue-700' },
  deadline:   { label: 'DEADLINE',        cls: 'bg-amber-100 text-amber-700' },
}

export function CalendarPage() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">Compliance Calendar 2026/27</h1>
          <p className="text-[13px] text-slate-400 mt-1.5 italic">
            EFL Championship — Key regulatory dates. Confirm against the official EFL Handbook when published.
          </p>
        </div>
      </div>

      <div className="mt-8 relative">
        {/* Connecting line */}
        <div className="absolute top-2 bottom-2 w-px bg-slate-200" style={{ left: 134 }} />
        <ul className="space-y-4">
          {CALENDAR_EVENTS.map((ev, i) => {
            const meta = KIND_META[ev.kind]
            return (
              <li key={i} className="flex items-start gap-0">
                <div className="w-[120px] flex-shrink-0 pt-5">
                  <div className="num text-[13px] text-slate-500">{ev.date}</div>
                </div>
                <div className="relative flex-shrink-0" style={{ width: 28 }}>
                  <span className={`absolute left-1/2 top-7 -translate-x-1/2 w-3 h-3 rounded-full border-[2.5px] ${ev.key ? 'border-violet-600 bg-white' : 'border-slate-300 bg-white'}`} />
                </div>
                <Card className={`flex-1 p-5 ${ev.key ? 'border-l-4 border-l-violet-600' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium tracking-wider whitespace-nowrap ${meta.cls}`}>
                      {meta.label}
                    </span>
                    {ev.key && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider whitespace-nowrap bg-violet-600 text-white">
                        KEY DATE
                      </span>
                    )}
                  </div>
                  <h3 className="text-[15px] font-semibold text-slate-900">{ev.name}</h3>
                  <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">{ev.desc}</p>
                </Card>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
