import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
import { SetPasswordPage } from '@/pages/SetPasswordPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { RosterPage } from '@/pages/RosterPage'
import { ScenariosPage } from '@/pages/ScenariosPage'
import { SSRPage } from '@/pages/SSRPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { RulesPage } from '@/pages/RulesPage'
import { LeagueTablePage } from '@/pages/LeagueTablePage'
import { ClubSetupPage } from '@/pages/ClubSetupPage'
import { FinancialsPage } from '@/pages/FinancialsPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { useClubStore } from '@/stores/club'
import { useCan } from '@/lib/role'
import { resolveProductCapabilities } from '@/lib/navigation'
import { FormPageSkeleton } from '@/components/ui/page-skeletons'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Public self-serve registration is disabled (invite-only). Any stale
            link to /register lands on sign-in. */}
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Supabase invite landing — admin-provisioned leads set their password here. */}
        <Route path="/set-password" element={<SetPasswordPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/roster" element={<RosterPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/ssr" element={<SsrRoute><SSRPage /></SsrRoute>} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/league-table" element={<LeagueTablePage />} />
          <Route path="/financials" element={<FinancialsPage />} />
          <Route path="/setup" element={<ClubSetupPage />} />

          {/* Legacy MVP 1.0 routes redirect to the new home */}
          <Route path="/simulator" element={<Navigate to="/scenarios" replace />} />
          <Route path="/history" element={<Navigate to="/scenarios" replace />} />
          <Route path="/history/:id" element={<Navigate to="/scenarios" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function SsrRoute({ children }: { children: React.ReactNode }) {
  const bootstrapStatus = useClubStore((state) => state.bootstrapStatus)
  const leagueId = useClubStore((state) => state.leagueId)
  const can = useCan()
  if (bootstrapStatus !== 'ready') return <FormPageSkeleton />
  const capabilities = resolveProductCapabilities(leagueId ?? '', can)

  return capabilities.ssrTests ? <>{children}</> : <Navigate to="/dashboard" replace />
}
