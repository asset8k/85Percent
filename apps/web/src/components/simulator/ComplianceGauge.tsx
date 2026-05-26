interface ComplianceGaugeProps {
  currentPct: number
  projectedPct: number
  greenPct: number
  redPct: number
}

function fmtPct(n: number) {
  return n.toFixed(1) + '%'
}

export function ComplianceGauge({ currentPct, projectedPct, greenPct, redPct }: ComplianceGaugeProps) {
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
            <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Compliance Gauge</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Where your projected position falls on the Squad Cost Ratio scale</p>
          </div>
        </div>
        <div className="flex items-center gap-5 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <svg width="10" height="6" viewBox="0 0 14 8"><path d="M7 8 L0 0 L14 0 Z" fill="#475569" /></svg>
            Current
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'white', boxShadow: `0 0 0 2px ${projColor}` }} />
            Projected
          </span>
        </div>
      </div>

      <div className="px-4">
        {/* Current label + arrow above bar (always) */}
        <div className="relative h-12">
          {/* Current: label + arrow grouped at bottom */}
          <div className="absolute flex flex-col items-center" style={{ left: `${currentX}%`, transform: 'translateX(-50%)', bottom: 0 }}>
            <span className="num text-[13px] text-slate-700 font-medium mb-1.5">{fmtPct(currentPct)}</span>
            <svg width="14" height="8" viewBox="0 0 14 8">
              <path d="M7 8 L0 0 L14 0 Z" fill="#475569" />
            </svg>
          </div>
          {/* Projected: label + arrow when far apart; arrow only when staggered (label goes below bar) */}
          <div className="absolute flex flex-col items-center" style={{ left: `${projectedX}%`, transform: 'translateX(-50%)', bottom: 0 }}>
            {!shouldStagger && (
              <span className="num text-[13px] font-semibold mb-1.5" style={{ color: projColor }}>{fmtPct(projectedPct)}</span>
            )}
            <svg width="14" height="8" viewBox="0 0 14 8">
              <path d="M7 8 L0 0 L14 0 Z" fill={projColor} />
            </svg>
          </div>
        </div>

        {/* The bar */}
        <div className="relative gauge-track">
          <div className="zone" style={{ left: 0, width: `${greenEnd}%`, background: '#dcfce7' }} />
          <div className="zone" style={{ left: `${greenEnd}%`, width: `${amberEnd - greenEnd}%`, background: '#fef3c7' }} />
          <div className="zone" style={{ left: `${amberEnd}%`, right: 0, background: '#fee2e2' }} />
          <div className="absolute top-0 bottom-0 w-px bg-white/70" style={{ left: `${greenEnd}%` }} />
          <div className="absolute top-0 bottom-0 w-px bg-white/70" style={{ left: `${amberEnd}%` }} />
          <div className="absolute" style={{ left: `${projectedX}%`, top: '50%', transform: 'translate(-50%, -50%)', zIndex: 2 }}>
            <span className="block w-4 h-4 rounded-full bg-white" style={{ boxShadow: `0 0 0 2.5px ${projColor}, 0 1px 3px rgba(0,0,0,0.15)` }} />
          </div>
        </div>

        {/* Projected label below bar — only when close to current */}
        {shouldStagger && (
          <div className="relative h-6 mt-1.5">
            <div className="absolute" style={{ left: `${projectedX}%`, transform: 'translateX(-50%)', top: 0 }}>
              <span className="num text-[13px] font-semibold" style={{ color: projColor }}>{fmtPct(projectedPct)}</span>
            </div>
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
        <ZoneLegend dot="#16a34a" range={`0 – ${greenPct.toFixed(0)}%`} name="Compliant" sub="Within Green Threshold" />
        <ZoneLegend dot="#f59e0b" range={`${greenPct.toFixed(0)} – ${redPct.toFixed(0)}%`} name="Levy zone" sub="Financial penalty applies" />
        <ZoneLegend dot="#dc2626" range={`${redPct.toFixed(0)}%+`} name="Deduction zone" sub="Points deducted" />
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
