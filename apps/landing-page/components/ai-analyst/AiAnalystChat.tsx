'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { ShieldCheck, CornerDownLeft } from 'lucide-react'
import { Reveal } from '../motion/Reveal'
import { EASE_EXPO } from '../motion/variants'
import { SparkIcon } from '@/components/icons/SparkIcon'
import { useTypewriter } from '@/lib/useTypewriter'

/**
 * AiAnalystChat — the AI Analyst, shown rather than described. On scroll-in, a
 * Sporting Director's question types out, the analyst "thinks", then answers — token
 * by token — with deterministic, RAG-grounded math, and a structured calculation
 * card resolves beneath it. The point the motion makes: this isn't a chatbot
 * guessing; it's the engine's numbers, in plain language. Reduced motion renders the
 * whole exchange at rest.
 */

const QUESTION =
  'How much budget do we have left before hitting the 85% cap if we renew our goalkeeper’s contract?'

const ANSWER =
  'Renewing your goalkeeper adds about £4.2M a year in gross wages, roughly +2.0 points of Squad Cost Ratio. You’re at 78% today, so the renewal takes you to 80%, leaving 5 points of headroom under the 85% cap.'

const FIGURES = [
  { k: 'GK renewal', v: '+£4.2M / yr' },
  { k: 'SCR impact', v: '+2.0 pts' },
  { k: 'After renewal', v: '80%' },
  { k: 'Headroom to cap', v: '5 pts' },
]

type Phase = 0 | 1 | 2 | 3 | 4 // idle → ask → think → answer → resolved

export function AiAnalystChat() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<Phase>(0)

  // Kick off the scripted exchange once it scrolls into view.
  useEffect(() => {
    if (inView && phase === 0) setPhase(1)
  }, [inView, phase])

  const ask = useTypewriter(QUESTION, { active: phase >= 1 })
  const answer = useTypewriter(ANSWER, { active: phase >= 3 })

  // Advance the state machine as each beat completes.
  useEffect(() => {
    if (phase === 1 && ask.done) {
      const t = setTimeout(() => setPhase(2), reduce ? 0 : 420)
      return () => clearTimeout(t)
    }
    if (phase === 2) {
      const t = setTimeout(() => setPhase(3), reduce ? 0 : 950)
      return () => clearTimeout(t)
    }
    if (phase === 3 && answer.done) {
      const t = setTimeout(() => setPhase(4), reduce ? 0 : 200)
      return () => clearTimeout(t)
    }
  }, [phase, ask.done, answer.done, reduce])

  return (
    <section id="ai-analyst" data-nav-theme="light" className="scroll-mt-20 bg-background">
      <div className="mx-auto grid max-w-content grid-cols-1 items-center gap-14 px-6 py-28 lg:grid-cols-2 lg:gap-16">
        {/* Pitch */}
        <Reveal>
          <span className="meta-label text-primary">AI Analyst</span>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-foreground sm:text-[2.6rem]">
            Ask in plain English. Get answers in hard numbers.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Grounded in your club’s own filings, squad and the league rulebook. Every
            answer is retrieval-augmented and traces back to a real figure. It doesn’t
            estimate the Squad Cost Ratio. It computes it.
          </p>
          <ul className="mt-6 space-y-2.5">
            {[
              'Retrieval-augmented over your squad, contracts and accounts',
              'Deterministic maths, the same engine that powers compliance',
              'Every figure is auditable, never a guess',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-foreground">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
                {line}
              </li>
            ))}
          </ul>
        </Reveal>

        {/* Chat panel */}
        <Reveal delay={0.1}>
          <div
            ref={ref}
            className="overflow-hidden rounded-2xl border border-border bg-charcoal text-charcoal-foreground shadow-[0_1px_0_rgba(0,0,0,0.04),0_40px_80px_-40px_rgba(11,16,32,0.5)]"
          >
            {/* Window chrome */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-white/85">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-violet-tip text-white">
                  <SparkIcon size={14} />
                </span>
                AI Analyst
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/45">
                RAG-grounded · Deterministic
              </span>
            </div>

            {/*
              The exchange animates from a single question to a full answer +
              calculation card, so its content height grows over time. To stop
              that growth from reflowing the panel (and shifting the whole grid
              row), a hidden ghost of the fully-resolved exchange reserves the
              final height up front, and the live animated content is overlaid
              absolutely on top. The panel is always its final size; nothing
              jumps. Both layers share `space-y-4 p-5` so they align exactly.
            */}
            <div className="relative">
              {/* Ghost: reserves the resolved height. visibility:hidden keeps layout. */}
              <div aria-hidden className="invisible space-y-4 p-5">
                <QuestionBubble text={QUESTION} />
                <AnswerBlock text={ANSWER} showCard />
              </div>

              {/* Live, animated exchange */}
              <div className="absolute inset-0 space-y-4 p-5">
                {/* Director's question */}
                <QuestionBubble
                  text={ask.shown}
                  caret={phase === 1 && !ask.done}
                />

                {/* Thinking indicator */}
                <AnimatePresence>
                  {phase === 2 && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: EASE_EXPO }}
                      className="flex items-center gap-2"
                    >
                      <AvatarDot />
                      <ThinkingDots />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Analyst's answer */}
                {phase >= 3 && (
                  <AnswerBlock
                    text={answer.shown}
                    caret={phase === 3 && !answer.done}
                    showCard={phase >= 4}
                  />
                )}
              </div>
            </div>

            {/* Inert composer — sells the affordance without faking input. */}
            <div className="border-t border-white/10 px-5 py-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                <span className="text-sm text-white/35">Ask about your headroom, a transfer, a renewal…</span>
                <CornerDownLeft size={15} className="shrink-0 text-white/30" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/** The Sporting Director's question bubble. Shared by the ghost and live layers. */
function QuestionBubble({ text, caret }: { text: string; caret?: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-violet-tip px-4 py-2.5 text-sm leading-relaxed text-white">
        {text}
        {caret && <Caret />}
      </div>
    </div>
  )
}

/**
 * The analyst's answer bubble plus its deterministic calculation card. Shared by
 * the ghost (full text + card, to reserve height) and the live layer (typed text,
 * card revealed once resolved).
 */
function AnswerBlock({
  text,
  caret,
  showCard,
}: {
  text: string
  caret?: boolean
  showCard?: boolean
}) {
  return (
    <div className="flex items-start gap-2.5">
      <AvatarDot />
      <div className="max-w-[88%]">
        <div className="rounded-2xl rounded-tl-md bg-white/[0.06] px-4 py-2.5 text-sm leading-relaxed text-white/90">
          {text}
          {caret && <Caret />}
        </div>

        {/* Deterministic calculation card */}
        <AnimatePresence>
          {showCard && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE_EXPO }}
              className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {FIGURES.map((f) => (
                  <div key={f.k} className="flex items-center justify-between gap-3">
                    <span className="meta-label text-white/40">{f.k}</span>
                    <span className="num text-sm text-white/90">{f.v}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-relaxed text-white/50">
                ≈ one £60M signing on a 5-year deal, or £12M/yr of added
                wage capacity, all within the cap.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function Caret() {
  return (
    <motion.span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[1px] align-middle bg-current"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear', times: [0, 0.5, 0.5, 1] }}
    />
  )
}

function AvatarDot() {
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-tip text-white">
      <SparkIcon size={15} />
    </span>
  )
}

function ThinkingDots() {
  const reduce = useReducedMotion()
  return (
    <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-white/[0.06] px-3.5 py-3">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-white/50"
          animate={reduce ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, ease: EASE_EXPO, delay: i * 0.16 }}
        />
      ))}
    </div>
  )
}
