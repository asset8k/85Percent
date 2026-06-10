import { Aurora } from './atmosphere/Aurora'
import { Grain } from './atmosphere/Grain'
import { Navbar } from './Navbar'
import { Footer } from './Footer'

/**
 * LegalPage — the shared shell for the /(legal) route group (Website Terms of Use,
 * Privacy Policy, SCR Compliance Disclaimer, Cookie Policy). A deep-slate band that
 * is continuous with the dark navbar and footer, lit by the same faint aurora as
 * the hero so the legal section reads in the brand's institutional register rather
 * than as a bare white document.
 *
 * Body copy is authored as plain HTML and styled with @tailwindcss/typography
 * (`prose prose-invert`), tuned to the brand: display headings, violet links, and
 * a constrained reading measure for high-contrast legibility on the slate.
 */
export function LegalPage({
  title,
  eyebrow = 'Legal',
  summary,
  updated,
  children,
}: {
  title: string
  eyebrow?: string
  summary?: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <>
      <Navbar forceSolid />
      <main
        data-nav-theme="dark"
        className="relative isolate min-h-screen overflow-hidden bg-charcoal text-white"
      >
        <Aurora className="opacity-30" />
        <Grain opacity={0.04} />

        <article className="relative z-10 mx-auto max-w-2xl px-6 pb-28 pt-36">
          {/* Header */}
          <header className="border-b border-white/10 pb-10">
            <p className="meta-label text-violet-soft">{eyebrow}</p>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {title}
            </h1>
            {summary && (
              <p className="mt-5 text-lg leading-relaxed text-white/65">{summary}</p>
            )}
            <p className="mt-6 text-xs uppercase tracking-[0.14em] text-white/40">
              Last updated {updated}
            </p>
          </header>

          {/* Body */}
          <div
            className="prose prose-invert mt-12 max-w-none
              prose-headings:font-display prose-headings:tracking-tight prose-headings:text-white
              prose-h2:mt-12 prose-h2:text-xl prose-h2:font-semibold
              prose-h3:mt-8 prose-h3:text-base prose-h3:font-semibold prose-h3:text-white/90
              prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-white/65
              prose-li:text-[15px] prose-li:text-white/65 prose-li:marker:text-violet-soft
              prose-strong:text-white
              prose-a:font-medium prose-a:text-violet-soft prose-a:no-underline hover:prose-a:text-white
              prose-hr:border-white/10"
          >
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </>
  )
}
