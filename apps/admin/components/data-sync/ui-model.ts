export interface SelectableClub {
  id: string
}

export function selectVisibleClubIds(clubs: SelectableClub[], limit: number): Set<string> {
  return new Set(clubs.slice(0, Math.max(0, limit)).map((club) => club.id))
}

export function toggleClubSelection(
  current: ReadonlySet<string>,
  id: string,
  limit: number,
): { selection: Set<string>; limitReached: boolean } {
  const selection = new Set(current)
  if (selection.has(id)) {
    selection.delete(id)
    return { selection, limitReached: false }
  }
  if (selection.size >= limit) return { selection, limitReached: true }
  selection.add(id)
  return { selection, limitReached: false }
}

export function estimateRemainingSeconds(
  tasks: Array<Record<string, unknown>>,
  concurrency: number,
): number | null {
  const completedDurations = tasks
    .filter((task) => task.status === 'SUCCEEDED' || task.status === 'FAILED')
    .map((task) => Number(task.duration_ms))
    .filter((duration) => Number.isFinite(duration) && duration > 0)
  if (completedDurations.length < 2) return null
  const remaining = tasks.filter((task) => task.status === 'QUEUED' || task.status === 'RUNNING').length
  if (remaining === 0) return 0
  const averageMs = completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length
  return Math.ceil((averageMs * Math.ceil(remaining / Math.max(1, concurrency))) / 1000)
}

export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
