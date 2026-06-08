import { QueryClient } from '@tanstack/react-query'

/**
 * The app-wide TanStack Query client.
 *
 * It lives ABOVE the router (mounted in main.tsx), so its cache survives every
 * page unmount/remount that React Router does when the user switches tabs. That
 * is the whole point: a tab's server data is cached here, not in the page
 * component, so navigating away and back no longer triggers a fresh fetch +
 * loading shimmer.
 *
 * Defaults tuned for "instant tab switching, refresh quietly in the background":
 *  - staleTime 5m   — within 5 minutes a remount serves the cache with NO refetch
 *                     at all (truly instant). After 5m the cache is still served
 *                     instantly and a silent background refetch runs.
 *  - gcTime 30m     — keep unused cache around long enough to cover a normal
 *                     session of hopping between tabs.
 *  - refetchOnWindowFocus false — don't surprise-refetch every time the tab
 *                     regains focus; the staleTime cadence is enough.
 *  - retry 1        — one quiet retry on transient failure, then surface the error.
 *
 * Consumers render the skeleton ONLY on `isPending` (no cached data yet — the
 * genuine first load). A background refresh is `isFetching` and must keep the
 * existing data on screen, never the skeleton.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
