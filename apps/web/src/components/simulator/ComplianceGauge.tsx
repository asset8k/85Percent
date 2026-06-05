import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

interface ComplianceGaugeProps {
  currentPct: number
  projectedPct: number
  greenPct: number
  redPct: number
}

function fmtPct(n: number) {
  return n.toFixed(1) + '%'
}

// Spring config for marker sweeps. Stiff enough to land quickly; damped enough
// that the dot doesn't bounce past the destination.
const SWEEP_SPRING = { type: 'spring' as const, stiffness: 220, damping: 26 }
const COLOR_TWEEN = { duration: 0.35 }

export function ComplianceGauge({ currentPct, projectedPct, greenPct, redPct }: ComplianceGaugeProps) {
  const { t } = useTranslation()
  const max = Math.max(redPct + 12, projectedPct + 6, 108)
  const pos = (p: number) => (p / max) * 100

  const greenEnd = pos(greenPct)
  const amberEnd = pos(redPct)
  const currentX = pos(currentPct)
  const projectedX = pos(projectedPct)

  const projStatus = projectedPct > redPct ? 'red' : projectedPct > greenPct ? 'amber' : 'green'
  const projColor = projStatus === 'green' ? '#16a34a' : projStatus === 'amber' ? '#f59e0b' : '#dc2626'

  // When markers are close, stagger labels vertically: projected stays on top row,
  // current drops to a second row. Arrows remain pinned to exact positions.
  const shouldStagger = Math.abs(currentX - projectedX) < 10

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{t('common.gauge.title')}</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">{t('common.gauge.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-5 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <svg width="10" height="6" viewBox="0 0 14 8"><path d="M7 8 L0 0 L14 0 Z" fill="#475569" /></svg>
            {t('common.gauge.current')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'white', boxShadow: `0 0 0 2px ${projColor}` }} />
            {t('common.gauge.projected')}
          </span>
        </div>
      </div>

      <div className="px-4">
        {/* Current label + arrow above bar (always). The horizontal position
            is driven by a motion `left` value so the markers sweep smoothly
            when scenarios toggle or revenue/squad-cost inputs change. */}
        <div className="relative h-12">
          <motion.div
            className="absolute flex flex-col items-center"
            initial={false}
            animate={{ left: `${currentX}%` }}
            transition={SWEEP_SPRING}
            style={{ transform: 'translateX(-50%)', bottom: 0 }}
          >
            <span className="num text-[13px] text-slate-700 font-medium mb-1.5">{fmtPct(currentPct)}</span>
            <svg width="14" height="8" viewBox="0 0 14 8">
              <path d="M7 8 L0 0 L14 0 Z" fill="#475569" />
            </svg>
          </motion.div>
          <motion.div
            className="absolute flex flex-col items-center"
            initial={false}
            animate={{ left: `${projectedX}%` }}
            transition={SWEEP_SPRING}
            style={{ transform: 'translateX(-50%)', bottom: 0 }}
          >
            {!shouldStagger && (
              <motion.span
                className="num text-[13px] font-semibold mb-1.5"
                initial={false}
                animate={{ color: projColor }}
                transition={COLOR_TWEEN}
              >
                {fmtPct(projectedPct)}
              </motion.span>
            )}
            <motion.svg width="14" height="8" viewBox="0 0 14 8" initial={false} animate={{ fill: projColor }} transition={COLOR_TWEEN}>
              <path d="M7 8 L0 0 L14 0 Z" fill={projColor} />
            </motion.svg>
          </motion.div>
        </div>

        {/* The bar — zones animate in width when revenue/allowance shift */}
        <div className="relative gauge-track">
          <motion.div className="zone" initial={false} animate={{ width: `${greenEnd}%` }} transition={SWEEP_SPRING} style={{ left: 0, background: '#dcfce7' }} />
          <motion.div className="zone" initial={false} animate={{ left: `${greenEnd}%`, width: `${amberEnd - greenEnd}%` }} transition={SWEEP_SPRING} style={{ background: '#fef3c7' }} />
          <motion.div className="zone" initial={false} animate={{ left: `${amberEnd}%` }} transition={SWEEP_SPRING} style={{ right: 0, background: '#fee2e2' }} />
          <motion.div className="absolute top-0 bottom-0 w-px bg-white/70" initial={false} animate={{ left: `${greenEnd}%` }} transition={SWEEP_SPRING} />
          <motion.div className="absolute top-0 bottom-0 w-px bg-white/70" initial={false} animate={{ left: `${amberEnd}%` }} transition={SWEEP_SPRING} />
          <motion.div
            className="absolute"
            initial={false}
            animate={{ left: `${projectedX}%` }}
            transition={SWEEP_SPRING}
            style={{ top: '50%', transform: 'translate(-50%, -50%)', zIndex: 2 }}
          >
            <motion.span
              className="block w-4 h-4 rounded-full bg-white"
              initial={false}
              animate={{ boxShadow: `0 0 0 2.5px ${projColor}, 0 1px 3px rgba(0,0,0,0.15)` }}
              transition={COLOR_TWEEN}
            />
          </motion.div>
        </div>

        {/* Projected label below bar — only when close to current */}
        {shouldStagger && (
          <div className="relative h-6 mt-1.5">
            <motion.div
              className="absolute"
              initial={false}
              animate={{ left: `${projectedX}%` }}
              transition={SWEEP_SPRING}
              style={{ transform: 'translateX(-50%)', top: 0 }}
            >
              <motion.span
                className="num text-[13px] font-semibold"
                initial={false}
                animate={{ color: projColor }}
                transition={COLOR_TWEEN}
              >
                {fmtPct(projectedPct)}
              </motion.span>
            </motion.div>
          </div>
        )}

        {/* Axis */}
        <div className="relative mt-2.5 h-4 num text-[10.5px] text-slate-400">
          <span className="absolute left-0">0%</span>
          <span className="absolute right-0">{max.toFixed(0)}%</span>
        </div>
      </div>

      {/* Zone legend */}
      <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-4">
        <ZoneLegend dot="#16a34a" range={`0 – ${greenPct.toFixed(0)}%`} name={t('common.gauge.compliant')} sub={t('common.gauge.withinGreen')} />
        <ZoneLegend dot="#f59e0b" range={`${greenPct.toFixed(0)} – ${redPct.toFixed(0)}%`} name={t('common.gauge.levyZone')} sub={t('common.gauge.levySub')} />
        <ZoneLegend dot="#dc2626" range={`${redPct.toFixed(0)}%+`} name={t('common.gauge.deductionZone')} sub={t('common.gauge.deductionSub')} />
      </div>
    </div>
  )
}

function ZoneLegend({ dot, range, name, sub }: { dot: string; range: string; name: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: dot }} />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-slate-900">{name}</div>
        <div className="num text-[11px] text-slate-500 mt-0.5">{range}</div>
        <div className="text-[11.5px] text-slate-500 mt-1">{sub}</div>
      </div>
    </div>
  )
}
