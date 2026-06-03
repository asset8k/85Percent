import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
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

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

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
          <Route path="/ssr" element={<SSRPage />} />
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
