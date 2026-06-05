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

import { useTranslation, Trans } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { KNOWLEDGE_SOURCE_URL } from '@/lib/copilotContext'

// Shared inline-markup mapping for <Trans>: <b> = emphasis, <n> = tabular figure.
const RICH = {
  b: <span className="font-semibold text-slate-900" />,
  n: <span className="num" />,
}

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
  const { t } = useTranslation()
  return (
    <a
      href={KNOWLEDGE_SOURCE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[13px] font-medium text-violet-700 transition-colors hover:bg-violet-100 ${className}`}
    >
      {t('rules.officialLink')}
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
  const { t } = useTranslation()
  return (
    <div className="mx-auto max-w-4xl pb-12">
      {/* Hero */}
      <div className="mb-6">
        <div className="meta-label">{t('rules.eyebrow')}</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-900">
          {t('rules.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-600">
          {t('rules.intro')}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <OfficialLink />
          <span className="text-[12px] text-slate-400">
            {t('rules.refOnly')}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* 1 — The formula */}
        <Card className="p-6">
          <SectionTitle num="1">{t('rules.s1.title')}</SectionTitle>
          <p className="text-[13px] leading-relaxed text-slate-600">
            {t('rules.s1.lead')}
          </p>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
            <span className="num text-[15px] text-slate-800">
              {t('rules.s1.formula')}
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
            <Trans i18nKey="rules.s1.body" components={RICH} />
          </p>
        </Card>

        {/* 2 — Squad costs */}
        <Card className="p-6">
          <SectionTitle num="2">{t('rules.s2.title')}</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="meta-label mb-2 text-green-600">{t('rules.s2.included')}</p>
              <IncludeList items={t('rules.s2.includedItems', { returnObjects: true }) as string[]} />
            </div>
            <div>
              <p className="meta-label mb-2 text-slate-400">{t('rules.s2.excluded')}</p>
              <ExcludeList items={t('rules.s2.excludedItems', { returnObjects: true }) as string[]} />
            </div>
          </div>
        </Card>

        {/* 3 — Revenue */}
        <Card className="p-6">
          <SectionTitle num="3">{t('rules.s3.title')}</SectionTitle>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <IncludeList items={t('rules.s3.left', { returnObjects: true }) as string[]} />
            <IncludeList items={t('rules.s3.right', { returnObjects: true }) as string[]} />
          </div>
        </Card>

        {/* 4 — Thresholds & sanctions */}
        <Card className="p-6">
          <SectionTitle num="4">{t('rules.s4.title')}</SectionTitle>
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50/60 p-3">
              <Pill tone="green">{t('rules.s4.green')}</Pill>
              <p className="text-[13px] leading-relaxed text-slate-700">
                <Trans i18nKey="rules.s4.greenBody" components={RICH} />
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <Pill tone="amber">{t('rules.s4.amber')}</Pill>
              <p className="text-[13px] leading-relaxed text-slate-700">
                <Trans i18nKey="rules.s4.amberBody" components={RICH} />
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
              <Pill tone="red">{t('rules.s4.red')}</Pill>
              <p className="text-[13px] leading-relaxed text-slate-700">
                <Trans i18nKey="rules.s4.redBody" components={RICH} />
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="meta-label mb-1.5">{t('rules.s4.allowanceTitle')}</p>
            <p className="text-[13px] leading-relaxed text-slate-600">
              <Trans i18nKey="rules.s4.allowanceBody" components={RICH} />
            </p>
          </div>
        </Card>

        {/* 5 — SSR */}
        <Card className="p-6">
          <SectionTitle num="5">{t('rules.s5.title')}</SectionTitle>
          <p className="mb-3 text-[13px] leading-relaxed text-slate-600">
            {t('rules.s5.intro')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[13px] font-semibold text-slate-900">{t('rules.s5.workingCapital')}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                <Trans i18nKey="rules.s5.workingCapitalBody" components={RICH} />
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[13px] font-semibold text-slate-900">{t('rules.s5.liquidity')}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                <Trans i18nKey="rules.s5.liquidityBody" components={RICH} />
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[13px] font-semibold text-slate-900">{t('rules.s5.positiveEquity')}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                <Trans i18nKey="rules.s5.positiveEquityBody" components={RICH} />
              </p>
            </div>
          </div>
        </Card>

        {/* 6 — Championship specifics */}
        <Card className="p-6">
          <SectionTitle num="6">{t('rules.s6.title')}</SectionTitle>
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              <span><Trans i18nKey="rules.s6.ownerEquity" components={RICH} /></span>
            </li>
            <li className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              <span><Trans i18nKey="rules.s6.noSsr" components={RICH} /></span>
            </li>
            <li className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              <span>{t('rules.s6.monitoring')}</span>
            </li>
          </ul>
        </Card>

        {/* 7 — Calendar */}
        <Card className="p-6">
          <SectionTitle num="7">{t('rules.s7.title')}</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-[13px]">
              <tbody>
                {(t('rules.s7.rows', { returnObjects: true }) as string[][]).map(([when, what], i) => (
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
            {t('rules.footer')}
          </p>
          <OfficialLink className="flex-shrink-0" />
        </Card>
      </div>
    </div>
  )
}
