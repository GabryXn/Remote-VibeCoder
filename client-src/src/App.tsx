import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LoginPage }    from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { TerminalPage } from './pages/TerminalPage'
import { ErrorBoundary } from './components/ErrorBoundary'

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/"         element={<LoginPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
