'use client'

import { motion } from 'framer-motion'
import { Reveal } from './motion/Reveal'
import { staggerParent, fadeUp } from './motion/variants'
import { features } from '@/content/features'

/**
 * PlatformFeatures — the depth section (#platform): the complete platform surface
 * beyond the three headline pillars, as a staggered grid. The three pillars are
 * the focus; this is the "and everything else" that closes the value case.
 */
export function PlatformFeatures() {
  return (
    <section id="platform" className="scroll-mt-20 bg-background">
      <div className="mx-auto max-w-content px-6 py-28">
        <Reveal className="max-w-2xl">
          <span className="meta-label text-primary">The platform</span>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            Everything a compliance operation needs, in one place.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Monitoring, scenarios and the AI analyst are the core. Around them sits
            the full toolkit your finance and recruitment teams run on every day.
          </p>
        </Reveal>

        <motion.div
          variants={staggerParent}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.15 }}
          className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((f) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.title}
                variants={fadeUp}
                className="group bg-background p-7 transition-colors duration-300 hover:bg-surface"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-primary transition-all duration-300 group-hover:border-primary/40 group-hover:bg-violet-tip group-hover:text-white">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
