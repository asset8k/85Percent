import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { RosterPage } from '@/pages/RosterPage'
import { ScenariosPage } from '@/pages/ScenariosPage'
import { SSRPage } from '@/pages/SSRPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { ClubSetupPage } from '@/pages/ClubSetupPage'
import { OnboardingPage } from '@/pages/OnboardingPage'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

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
