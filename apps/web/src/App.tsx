import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { SimulatorPage } from '@/pages/SimulatorPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { ClubSetupPage } from '@/pages/ClubSetupPage'
import { RosterPage } from '@/pages/RosterPage'

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
          <Route index element={<Navigate to="/simulator" replace />} />
          <Route path="/simulator" element={<SimulatorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<HistoryPage />} />
          <Route path="/roster" element={<RosterPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/setup" element={<ClubSetupPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/simulator" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
