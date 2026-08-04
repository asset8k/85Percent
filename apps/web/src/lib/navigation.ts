import type { Permissions } from './role'

export type NavigationItemId =
  | 'dashboard'
  | 'roster'
  | 'scenarios'
  | 'leagueTable'
  | 'calendar'
  | 'rules'
  | 'financials'
  | 'ssrTests'

export interface ProductCapabilities {
  financials: boolean
  ssrTests: boolean
}

export interface NavigationItem {
  id: NavigationItemId
  to: string
  labelKey: string
  requires?: keyof ProductCapabilities
}

// Keep product availability in one place. UI visibility is a convenience only;
// API routes continue to enforce their own authorisation rules.
export function resolveProductCapabilities(
  leagueId: string,
  permissions: Pick<Permissions, 'isWorkspaceAdmin'>,
): ProductCapabilities {
  return {
    financials: permissions.isWorkspaceAdmin,
    ssrTests: leagueId === 'premier-league',
  }
}

export const navigationItems: readonly NavigationItem[] = [
  { id: 'dashboard', to: '/dashboard', labelKey: 'nav.dashboard' },
  { id: 'roster', to: '/roster', labelKey: 'nav.roster' },
  { id: 'scenarios', to: '/scenarios', labelKey: 'nav.scenarios' },
  { id: 'leagueTable', to: '/league-table', labelKey: 'nav.leagueTable' },
  { id: 'calendar', to: '/calendar', labelKey: 'nav.calendar' },
  { id: 'rules', to: '/rules', labelKey: 'nav.rules' },
  { id: 'financials', to: '/financials', labelKey: 'nav.financials', requires: 'financials' },
  { id: 'ssrTests', to: '/ssr', labelKey: 'nav.ssrTests', requires: 'ssrTests' },
]

export function visibleNavigation(capabilities: ProductCapabilities): readonly NavigationItem[] {
  return navigationItems.filter((item) => !item.requires || capabilities[item.requires])
}
