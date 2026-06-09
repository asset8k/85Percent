import { Reveal } from './motion/Reveal'
import { CountUp } from './CountUp'

/**
 * ProblemSolution — the two-beat narrative (spec §5.3) on the light band:
 *   1. The end of the unlimited-spending era.
 *   2. Enter the Squad Cost Ratio — defined plainly, with the 85% cap rendered
 *      as an audited stat band (mono figures, the formula that produces it).
 * Each beat fades up on scroll via <Reveal>.
 */
export function ProblemSolution() {
  return (
    <section id="the-rule" className="scroll-mt-20 bg-background">
      <div className="mx-auto max-w-content px-6 py-28">
        {/* Beat 1 — the problem */}
        <Reveal className="max-w-2xl">
          <span className="meta-label text-primary">The new era</span>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-foreground sm:text-4xl">
            The end of the unlimited-spending era.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            For a generation the model was simple: spend to the limit of an owner’s
            patience. That era is over. Squad investment now sits under a hard,
            league-enforced ceiling, and clubs that treat it as an afterthought lose
            points, transfers and seasons.
          </p>
        </Reveal>

        {/* Beat 2 — the solution */}
        <div className="mt-20 grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <span className="meta-label text-primary">The rule</span>
            <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-foreground sm:text-4xl">
              Enter the{' '}
              <span className="text-gradient-violet">Squad Cost Ratio</span>.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Wages, transfer amortisation and agent fees, capped as a share of
              football revenue. Cross the line and the consequences are no longer
              financial. They are sporting. 85Percent is the deterministic engine
              that keeps you on the right side of it, every day of the window.
            </p>
          </Reveal>

          {/* The stat band — the formula that yields the cap, audited in mono. */}
          <Reveal delay={0.1}>
            <div className="rounded-2xl border border-border bg-surface p-8 shadow-[0_1px_0_rgba(0,0,0,0.04),0_24px_48px_-32px_rgba(109,40,217,0.25)]">
              <div className="flex items-baseline gap-3">
                <CountUp
                  to={85}
                  suffix="%"
                  className="bg-violet-tip bg-clip-text text-6xl font-semibold tracking-tight text-transparent sm:text-7xl"
                />
                <span className="meta-label text-muted-foreground">the cap</span>
              </div>
              <div className="mt-8 space-y-3 border-t border-border pt-6">
                {[
                  { k: 'Player & coach wages', v: 'included' },
                  { k: 'Transfer fee amortisation', v: 'included' },
                  { k: 'Agent & intermediary fees', v: 'included' },
                ].map((row) => (
                  <div key={row.k} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{row.k}</span>
                    <span className="meta-label text-primary">{row.v}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-4">
                  <span className="text-sm font-medium text-foreground">
                    ÷ Football revenue
                  </span>
                  <span className="num text-sm font-medium text-foreground">
                    ≤ 85%
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
