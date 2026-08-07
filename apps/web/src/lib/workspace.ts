/**
 * Workspace readiness gate.
 *
 * Almost every API route is workspace-scoped: the server resolves the caller's
 * club from their application user record before it can answer. On a brand new
 * account that record is provisioned lazily by the first authenticated request,
 * so anything that fires *alongside* the bootstrap rather than *after* it is
 * racing something it depends on.
 *
 * `ProtectedRoute` performs the bootstrap (`/me` + `/club`) and publishes the
 * result on the club store. This hook is the single predicate every
 * workspace-dependent fetch gates on, giving one strict ordering:
 *
 *     auth ready → current user ready → workspace/club ready → page queries
 *
 * Use it as the `enabled` condition of workspace-scoped queries, never as a
 * reason to retry or delay — if it is false the prerequisite genuinely is not
 * resolved yet, and the caller should be showing a loading state.
 */
import { useClubStore } from '@/stores/club'

export function useWorkspaceReady(): boolean {
  const bootstrapStatus = useClubStore((state) => state.bootstrapStatus)
  const clubId = useClubStore((state) => state.clubId)
  return bootstrapStatus === 'ready' && clubId !== null
}

/** Non-reactive form, for imperative call sites (effects, event handlers). */
export function isWorkspaceReady(): boolean {
  const { bootstrapStatus, clubId } = useClubStore.getState()
  return bootstrapStatus === 'ready' && clubId !== null
}
