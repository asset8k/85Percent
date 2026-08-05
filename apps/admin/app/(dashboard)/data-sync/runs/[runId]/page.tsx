import { notFound } from 'next/navigation'
import { RunProgress } from '@/components/data-sync/run-progress'
import { getImportRunDetail } from '@/lib/data-imports'
import { getDataImportTarget } from '@/backend/data-imports/target'

export const dynamic = 'force-dynamic'

export default async function ImportRunPage({ params, searchParams }: { params: { runId: string }; searchParams: { target?: string } }) {
  const target = getDataImportTarget(searchParams.target)
  const detail = await getImportRunDetail(params.runId, target.id)
  if (!detail) notFound()
  return <RunProgress initial={detail} targetId={target.id} />
}
