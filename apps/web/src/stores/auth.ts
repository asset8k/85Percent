import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useClubStore } from '@/stores/club'
import { resetAnalytics } from '@/lib/analytics'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  setSession: (session: Session | null) => void
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      user: null,
      loading: true,
      setSession: (session) => set({ session, user: session?.user ?? null, loading: false }),
      signOut: async () => {
        await supabase.auth.signOut()
        resetAnalytics()
        set({ session: null, user: null })
        // Reset all per-club state so a different user signing in on the same browser
        // does not briefly see (or rehydrate from) the previous user's data.
        useClubStore.setState({
          bootstrapStatus: 'idle',
          clubId: null,
          clubName: null,
          leagueId: null,
          clubLogoUrl: null,
          financials: null,
          financialsLoaded: false,
          financialsStatus: 'idle',
          scenarios: [],
          scenariosLoaded: false,
          scenariosStatus: 'idle',
        })
      },
    }),
    {
      name: 'headroom-auth',
      partialize: (state) => ({ session: state.session, user: state.user }),
    }
  )
)
