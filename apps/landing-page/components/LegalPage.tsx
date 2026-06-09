import { Navbar } from './Navbar'
import { Footer } from './Footer'

/**
 * LegalPage — the shared shell for /terms, /privacy, /ssr-disclaimer. A solid
 * navbar (so it reads on the white page), a constrained prose column, and the
 * footer. Copy is counsel-owned; these routes are scaffolded with a clearly
 * marked placeholder so the structure and links exist before the real text lands
 * (spec §10.4).
 */
export function LegalPage({
  title,
  updated = 'Pending',
  children,
}: {
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <>
      <Navbar forceSolid />
      <main className="min-h-screen bg-background pt-16">
        <article className="mx-auto max-w-2xl px-6 py-20">
          <p className="meta-label text-primary">Legal</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>

          <div className="mt-8 rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
            This page is a placeholder. The final wording is being prepared by
            counsel and will replace this notice before launch.
          </div>

          <div className="prose-legal mt-10 space-y-6 text-[15px] leading-relaxed text-muted-foreground [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </>
  )
}
