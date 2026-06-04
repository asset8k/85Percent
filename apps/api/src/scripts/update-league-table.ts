// ─────────────────────────────────────────────────────────────────────────────
// League table refresh (admin-triggered). For each league:
//   • fetch live standings from football-data.org (else build the bundled seed),
//   • deactivate the previous active snapshot,
//   • insert a new active snapshot row (league_table_snapshots).
//
// The app's /league-table route then serves the newest active snapshot. Run via:
//   pnpm --filter @headroom/api update:league
// ─────────────────────────────────────────────────────────────────────────────

import { pathToFileURL } from 'url'
import { supabase } from '../lib/supabase.js'
import {
  buildFallback,
  fetchLive,
  LEAGUE_IDS,
  type LeagueTableResponse,
} from '../lib/league-table-source.js'

async function storeSnapshot(snap: LeagueTableResponse): Promise<void> {
  // Deactivate the league's previous active snapshots, then insert the new one.
  await supabase
    .from('league_table_snapshots')
    .update({ is_active: false })
    .eq('league_id', snap.leagueId)
    .eq('is_active', true)

  const { error } = await supabase.from('league_table_snapshots').insert({
    league_id: snap.leagueId,
    competition: snap.competition,
    season: snap.season,
    source: snap.source,
    standings: snap.standings,
    is_active: true,
    fetched_at: snap.fetchedAt,
  })
  if (error) throw new Error(`insert snapshot failed: ${error.message}`)
}

export async function main(): Promise<void> {
  const apiKey = process.env['FOOTBALL_DATA_API_KEY']
  let live = 0
  let fallback = 0

  for (const leagueId of LEAGUE_IDS) {
    let snap = apiKey ? await fetchLive(leagueId, apiKey) : null
    if (snap) {
      live++
      console.log(`[update-league] ${leagueId}: live — ${snap.standings.length} rows`)
    } else {
      snap = buildFallback(leagueId)
      fallback++
      console.warn(`[update-league] ${leagueId}: live unavailable — stored bundled fallback`)
    }
    await storeSnapshot(snap)
  }

  console.log(`[update-league] done — ${live} live, ${fallback} fallback snapshot(s) stored.`)
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[update-league] fatal:', err)
      process.exit(1)
    })
}
