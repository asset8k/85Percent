import type { ComponentType } from 'react'
import { Activity, SlidersHorizontal } from 'lucide-react'
import { SparkIcon } from '@/components/icons/SparkIcon'

/**
 * capabilities — the three product pillars rendered by the CapabilitiesCarousel
 * (spec §5.4 / §5a). Typed so copy is reviewable in PRs; the icon is a component
 * reference so the card renders it without a string→component map. The AI pillar
 * uses 85Percent's own SparkIcon, not a generic sparkle.
 */
export type IconType = ComponentType<{
  size?: number | string
  className?: string
  strokeWidth?: number | string
}>

export interface Capability {
  id: string
  icon: IconType
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
    body: 'Live Squad Cost Ratio against the cap, a green-to-red zone gauge, and breach alerts the moment a number moves you toward the line.',
  },
  {
    id: 'scenario-planning',
    icon: SlidersHorizontal,
    title: 'Transfer Window Scenario Planning',
    promise: 'Model every signing, sale and renewal before you commit.',
    body: 'Build the window deal by deal and watch the ratio respond live, so you negotiate knowing exactly how much room each move leaves.',
  },
  {
    id: 'ai-analyst',
    icon: SparkIcon,
    title: 'AI-Powered Compliance Analyst',
    promise: 'Interrogate your compliance position in plain language.',
    body: 'Ask what a deal does to your headroom, why a number moved, or where the risk sits. Answered from your club’s own figures, never generic guidance.',
  },
]
