import { Activity, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react'

/**
 * capabilities — the three product pillars rendered by the CapabilitiesCarousel
 * (spec §5.4 / §5a). Typed so copy is reviewable in PRs; the icon is a lucide
 * component reference so the card renders it without a string→component map.
 */
export interface Capability {
  id: string
  icon: LucideIcon
  title: string
  /** The one-line promise shown large under the title. */
  promise: string
  /** The supporting sentence. */
  body: string
}

export const capabilities: Capability[] = [
  {
    id: 'threshold-monitoring',
    icon: Activity,
    title: 'Real-Time Threshold Monitoring',
    promise: 'Always know exactly where you stand against the limit.',
    body: 'Live Squad Cost Ratio against the cap, a zone gauge that reads green to red at a glance, and breach alerts the moment a number moves you toward the line.',
  },
  {
    id: 'scenario-planning',
    icon: SlidersHorizontal,
    title: 'Transfer Window Scenario Planning',
    promise: 'Model every signing, sale, and renewal before you commit.',
    body: 'Build the window deal by deal and watch the ratio respond in real time — so you walk into negotiations knowing precisely how much room each move leaves.',
  },
  {
    id: 'ai-analyst',
    icon: Sparkles,
    title: 'AI-Powered Compliance Analyst',
    promise: 'Interrogate your compliance position in plain language.',
    body: 'Ask what a deal does to your headroom, why a number changed, or where the risk sits — answered against your club’s own figures, not generic guidance.',
  },
]
