import { Navbar } from '@/components/Navbar'
import { Hero } from '@/components/Hero'
import { ProblemSolution } from '@/components/ProblemSolution'
import { CapabilitiesCarousel } from '@/components/CapabilitiesCarousel'
import { CommandCenter } from '@/components/command-center/CommandCenter'
import { AiAnalystChat } from '@/components/ai-analyst/AiAnalystChat'
import { PlatformFeatures } from '@/components/PlatformFeatures'
import { Footer } from '@/components/Footer'

/**
 * Home — composes the marketing sections (spec §5): hero → the rule
 * (ProblemSolution) → the three core capabilities (carousel) → the interactive SCR
 * Command Center → the AI Analyst chat → the full platform grid (#platform) → footer.
 */
export default function HomePage() {
  return (
    <>
      <Navbar />
      <main id="top">
        <Hero />
        <ProblemSolution />
        <CapabilitiesCarousel />
        <CommandCenter />
        <AiAnalystChat />
        <PlatformFeatures />
      </main>
      <Footer />
    </>
  )
}
