import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

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
        set({ session: null, user: null })
      },
    }),
    {
      name: 'headroom-auth',
      partialize: (state) => ({ session: state.session, user: state.user }),
    }
  )
)
