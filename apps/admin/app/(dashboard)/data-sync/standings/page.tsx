import type { Metadata } from 'next'
import { DataSyncTabs } from '@/components/data-sync/data-sync-tabs'
import { DataSyncRouteRefresher } from '@/components/data-sync/data-sync-route-refresher'
import { StandingsSyncClient } from '@/components/data-sync/standings-sync-client'
import { getLeagueSyncState } from '@/lib/data-imports'
import { getDataImportTarget, getDataImportTargets } from '@/backend/data-imports/target'

export const metadata: Metadata = { title: 'League table sync' }
export const dynamic = 'force-dynamic'

export default async function StandingsSyncPage({ searchParams }: { searchParams: { target?: string } }) {
  const target = getDataImportTarget(searchParams.target)
  const states = await getLeagueSyncState(target.id)
  return <div><DataSyncRouteRefresher /><header className="mb-5"><h1 className="text-xl font-semibold tracking-tight">Data sync</h1><p className="mt-1 text-sm text-muted-foreground">Publish validated standings only when every club maps successfully.</p></header><DataSyncTabs active="standings" /><StandingsSyncClient states={states} target={target} targets={getDataImportTargets()} /></div>
}
