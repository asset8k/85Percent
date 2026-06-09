import {
  Trophy,
  Upload,
  Scale,
  GitBranch,
  CalendarDays,
  Bell,
  Sparkles,
  FileDown,
  ShieldCheck,
  Users,
  Coins,
  Share2,
  type LucideIcon,
} from 'lucide-react'

/**
 * features — the complete platform surface beyond the three headline pillars
 * (§5.4). These render in the PlatformFeatures grid as the "and everything else"
 * proof of depth. Sourced from the product's actual feature set (BUILD_LOG).
 */
export interface Feature {
  icon: LucideIcon
  title: string
  body: string
}

export const features: Feature[] = [
  {
    icon: Trophy,
    title: 'Every Premier League club, ready to go',
    body: 'All 20 Premier League squads pre-loaded. La Liga and Serie A are next.',
  },
  {
    icon: Upload,
    title: 'Pre-filled squads or upload your own',
    body: 'Start from a pre-filled Premier League or Championship club, or import your full squad from CSV or Excel.',
  },
  {
    icon: Scale,
    title: 'Premier League SSR tests',
    body: 'Working-capital, liquidity and positive-equity tests run alongside the Squad Cost Ratio for PL clubs.',
  },
  {
    icon: GitBranch,
    title: 'Drag-and-drop scenario builder',
    body: 'Stack signings, sales, renewals and loans, reorder them, and watch the projection recompute instantly.',
  },
  {
    icon: CalendarDays,
    title: 'Compliance calendar',
    body: 'Every checkpoint, deadline and contract-expiry date for the season, on one interactive timeline.',
  },
  {
    icon: Bell,
    title: 'Notifications & alerts',
    body: 'Breach-risk, contract-expiry and compliance warnings surface in-app the moment they matter.',
  },
  {
    icon: Sparkles,
    title: 'AI analyst, grounded in the rulebook',
    body: 'Retrieval-augmented answers drawn from the Premier League regulations and your club’s own numbers.',
  },
  {
    icon: FileDown,
    title: 'PDF & Excel exports',
    body: 'Board-ready squad, simulation and amortisation reports in a click.',
  },
  {
    icon: ShieldCheck,
    title: 'Bank-grade security',
    body: 'Two-factor authentication and a tamper-evident access & audit log on every action.',
  },
  {
    icon: Users,
    title: 'Granular team access',
    body: 'Invite your staff with precise per-member permissions and job titles per workspace.',
  },
  {
    icon: Coins,
    title: 'Multi-currency, multi-season',
    body: 'Work in your workspace’s base currency across any season you choose.',
  },
  {
    icon: Share2,
    title: 'Share with your board',
    body: 'Share a scenario or compliance position with the people who need to sign it off.',
  },
]
