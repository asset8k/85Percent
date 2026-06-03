/**
 * RulesPage — an in-app reference for the Squad Cost Ratio (SCR) financial
 * system, between Calendar and Financials in the nav.
 *
 * This is Headroom's own plain-English summary of the regulatory framework the
 * engine implements (thresholds, inclusions, sanctions, the PL SSR tests) — it
 * is NOT a reproduction of any third-party article. The official Premier League
 * statement is linked at the top and bottom for the authoritative source, and
 * the Analyst's "Source" chips deep-link here.
 *
 * Reference only — not legal advice; verify against the official 2026/27 Handbook.
 */

import { Card } from '@/components/ui/card'
import { KNOWLEDGE_SOURCE_URL } from '@/lib/copilotContext'

function ExternalLinkIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" /><path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

function OfficialLink({ className = '' }: { className?: string }) {
  return (
    <a
      href={KNOWLEDGE_SOURCE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[13px] font-medium text-violet-700 transition-colors hover:bg-violet-100 ${className}`}
    >
      Read the official Premier League statement
      <ExternalLinkIcon />
    </a>
  )
}

function SectionTitle({ children, num }: { children: React.ReactNode; num: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-100 text-[11px] font-semibold text-violet-700 num">
        {num}
      </span>
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{children}</h2>
    </div>
  )
}

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  }[tone]
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

function IncludeList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-2 text-[13px] text-slate-700">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
          {t}
        </li>
      ))}
    </ul>
  )
}
function ExcludeList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-2 text-[13px] text-slate-500">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300" />
          {t}
        </li>
      ))}
    </ul>
  )
}

export function RulesPage() {
  return (
    <div className="mx-auto max-w-4xl pb-12">
      {/* Hero */}
      <div className="mb-6">
        <div className="meta-label">Reference</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-900">
          The Squad Cost Ratio system
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-600">
          From the 2026/27 season, the Premier League and the EFL Championship cap squad spending
          as a share of football revenue under the Squad Cost Ratio (SCR), replacing the old
          Profitability &amp; Sustainability Rules. This page is Headroom's plain-English summary of
          how the system works — the same logic the engine uses to compute your position.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <OfficialLink />
          <span className="text-[12px] text-slate-400">
            Reference only — not legal advice. Verify against the official 2026/27 Handbook.
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* 1 — The formula */}
        <Card className="p-6">
          <SectionTitle num="1">The core calculation</SectionTitle>
          <p className="text-[13px] leading-relaxed text-slate-600">
            The Squad Cost Ratio measures total squad costs against football-related revenue:
          </p>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
            <span className="num text-[15px] text-slate-800">
              SCR&nbsp;=&nbsp;Total Squad Costs&nbsp;÷&nbsp;Football-Related Revenue
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
            The compliance ceiling is <span className="font-semibold text-slate-900">85%</span> of
            revenue. The same formula applies in both the Premier League and the Championship — the
            Premier League adds three further solvency tests on top (see section&nbsp;5).
          </p>
        </Card>

        {/* 2 — Squad costs */}
        <Card className="p-6">
          <SectionTitle num="2">What counts as squad costs</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="meta-label mb-2 text-green-600">Included</p>
              <IncludeList
                items={[
                  'First-team player wages',
                  'Head coach / manager wages',
                  'Agent fees (on transfers and renewals)',
                  'Transfer-fee amortisation (fee spread over the contract, capped at 5 years)',
                  'Player impairment (when book value is written down)',
                ]}
              />
            </div>
            <div>
              <p className="meta-label mb-2 text-slate-400">Excluded</p>
              <ExcludeList
                items={[
                  'Assistant coaches and other coaching staff',
                  'Administrative and commercial staff',
                  'Academy costs (but academy income still counts as revenue)',
                  "Women's team costs (but women's team income still counts)",
                ]}
              />
            </div>
          </div>
        </Card>

        {/* 3 — Revenue */}
        <Card className="p-6">
          <SectionTitle num="3">What counts as football-related revenue</SectionTitle>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <IncludeList
              items={[
                'Matchday — tickets and hospitality',
                'Commercial — sponsorship, kit, merchandise',
                'Central league payments — merit, facility & solidarity',
                'Domestic cup income (FA Cup, EFL Cup)',
              ]}
            />
            <IncludeList
              items={[
                'European competition income (UCL / UEL / UECL)',
                'FIFA Club World Cup income',
                'Net profit on player sales (fee minus book value)',
                'Net profit from non-football stadium events',
              ]}
            />
          </div>
        </Card>

        {/* 4 — Thresholds & sanctions */}
        <Card className="p-6">
          <SectionTitle num="4">The three zones, the allowance &amp; the sanctions</SectionTitle>
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50/60 p-3">
              <Pill tone="green">Green</Pill>
              <p className="text-[13px] leading-relaxed text-slate-700">
                Squad costs at or below <span className="num font-semibold">85%</span> of revenue —
                fully compliant.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <Pill tone="amber">Amber</Pill>
              <p className="text-[13px] leading-relaxed text-slate-700">
                Above the Green threshold but below the Red — a financial{' '}
                <span className="font-semibold">levy</span>, no points deduction. The levy is the
                overspend multiplied by the percentage by which the ratio exceeds 85%.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
              <Pill tone="red">Red</Pill>
              <p className="text-[13px] leading-relaxed text-slate-700">
                Above the Red threshold — a <span className="font-semibold">points deduction</span>:
                a baseline of <span className="num">6</span> points, plus a further point for every{' '}
                <span className="num">£6.5M</span> spent above the Red line, imposed in the same
                season.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="meta-label mb-1.5">The allowance &amp; feedback loop</p>
            <p className="text-[13px] leading-relaxed text-slate-600">
              Each club starts with a <span className="num">30%</span> allowance, setting the Red
              threshold at <span className="num">85% + 30% = 115%</span> of revenue. Breach 85% at
              season end and next year's allowance shrinks by the size of the breach; stay compliant
              and it recovers by <span className="num">10%</span> (up to the 30% cap). Unused
              capacity does not carry forward.
            </p>
          </div>
        </Card>

        {/* 5 — SSR */}
        <Card className="p-6">
          <SectionTitle num="5">Premier League solvency tests (SSR)</SectionTitle>
          <p className="mb-3 text-[13px] leading-relaxed text-slate-600">
            On top of the SCR, Premier League clubs must pass three Sustainability &amp; Systemic
            Resilience tests. These don't trigger automatic points deductions — failing them brings
            monitoring, a required business plan and possible spending restrictions. (Championship
            clubs are not subject to SSR.)
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[13px] font-semibold text-slate-900">Working Capital</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                Each month, cashflow plus qualifying funds must stay at or above{' '}
                <span className="num">£12.5M</span>.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[13px] font-semibold text-slate-900">Liquidity</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                Liquid assets less liabilities must clear an <span className="num">£85M</span> stress
                test (relegation, lost sponsor/broadcaster).
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[13px] font-semibold text-slate-900">Positive Equity</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                Liabilities-to-assets ratio capped per season:{' '}
                <span className="num">90% → 85% → 80%</span>.
              </p>
            </div>
          </div>
        </Card>

        {/* 6 — Championship specifics */}
        <Card className="p-6">
          <SectionTitle num="6">Championship specifics</SectionTitle>
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              <span>
                <span className="font-semibold">Owner equity top-up:</span> up to{' '}
                <span className="num">£33M</span> over a rolling three-year period (max{' '}
                <span className="num">£15M</span> in a single season), which counts toward revenue
                for SCR.
              </span>
            </li>
            <li className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              <span><span className="font-semibold">No SSR tests</span> — the three solvency tests are Premier League only.</span>
            </li>
            <li className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              <span>Real-time monitoring by the EFL's Club Financial Reporting Unit.</span>
            </li>
          </ul>
        </Card>

        {/* 7 — Calendar */}
        <Card className="p-6">
          <SectionTitle num="7">Assessment calendar</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  ['Pre-season', 'Estimated revenues agreed → sets the season thresholds'],
                  ['1 October', 'First in-season monitoring checkpoint'],
                  ['1 March', 'Main SCR compliance test (post-winter window)'],
                  ['June', 'Accounts Confirmation Test — actual vs estimated'],
                  ['7 July (PL)', 'SSR assessments — Working Capital, Liquidity, Positive Equity'],
                ].map(([when, what], i) => (
                  <tr key={when} className={i % 2 ? 'bg-slate-50/60' : ''}>
                    <td className="w-40 px-4 py-2.5 align-top font-medium text-slate-900 num whitespace-nowrap">{when}</td>
                    <td className="px-4 py-2.5 text-slate-600">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Footer source */}
        <Card className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-slate-600">
            This summary reflects Headroom's reading of the published framework. The Premier League's
            own statement is the authoritative source.
          </p>
          <OfficialLink className="flex-shrink-0" />
        </Card>
      </div>
    </div>
  )
}
