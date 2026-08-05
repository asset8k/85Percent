import type { Metadata } from 'next'
import { DataSyncTabs } from '@/components/data-sync/data-sync-tabs'
import { DataSyncRouteRefresher } from '@/components/data-sync/data-sync-route-refresher'
import { SquadSyncClient } from '@/components/data-sync/squad-sync-client'
import { listImportRuns, listSyncClubs } from '@/lib/data-imports'
import { getDataImportConfig } from '@/backend/data-imports/config'
import { getDataImportTarget, getDataImportTargets } from '@/backend/data-imports/target'

export const metadata: Metadata = { title: 'Squads & coaches sync' }
export const dynamic = 'force-dynamic'

export default async function SquadSyncPage({ searchParams }: { searchParams: { target?: string } }) {
  const target = getDataImportTarget(searchParams.target)
  const [clubs, runs] = await Promise.all([listSyncClubs(target.id), listImportRuns(8, target.id)])
  const { maxClubsPerRun, maxConcurrentClubTasks } = getDataImportConfig()
  return <div><DataSyncRouteRefresher /><header className="mb-5"><h1 className="text-xl font-semibold tracking-tight">Data sync</h1><p className="mt-1 text-sm text-muted-foreground">Manually reconcile public football data without overwriting club financials.</p></header><DataSyncTabs active="squads" /><SquadSyncClient clubs={clubs} maxClubs={maxClubsPerRun} concurrency={maxConcurrentClubTasks} target={target} targets={getDataImportTargets()} />{runs.length > 0 && <section className="mt-8"><h2 className="mb-3 font-semibold">Recent runs</h2><div className="space-y-2">{runs.map((run) => <a key={run.id} href={`/data-sync/runs/${run.id}?target=${encodeURIComponent(target.id)}`} className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm hover:bg-muted/30"><span>{run.type.replaceAll('_', ' ')} · {new Date(run.createdAt).toLocaleString()}</span><span>{run.status} · {run.progressPercent}%</span></a>)}</div></section>}</div>
}
