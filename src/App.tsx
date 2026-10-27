import { useState, useEffect } from 'react'
// HashRouter, not BrowserRouter: the packaged app runs from a file:// document,
// where history-API paths resolve to sibling files that do not exist.
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Search from './pages/Search'
import ImportScanner from './pages/ImportScanner'
import Settings from './pages/Settings'
import ActivityLog from './pages/ActivityLog'
import Help from './pages/Help'
import Layout from './components/Layout'
import { ToastProvider } from './components/ui/Toast'
import type { User } from '@/types'

function AppInner() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const electronMissing = typeof window !== 'undefined' && !window.electronAPI

  useEffect(() => {
    if (electronMissing) {
      console.error(
        '[Registrar Archive] window.electronAPI is undefined. The app is running in a plain ' +
        'browser tab, not the Electron renderer, so nothing can be saved. Launch the desktop ' +
        'window instead (npm run dev opens the Electron app; do not use http://localhost:5173 directly).'
      )
      return
    }
    // Check if user is already logged in (from session storage)
    const savedUser = sessionStorage.getItem('user')
    if (savedUser) {
      setUser(JSON.parse(savedUser))
    }
    setIsLoading(false)
  }, [electronMissing])

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser)
    sessionStorage.setItem('user', JSON.stringify(loggedInUser))
  }

  const handleLogout = () => {
    // Clear the main-process session first: the renderer's copy is only a UI
    // convenience, and the admin checks read the main-process session.
    void window.electronAPI.logout().catch(() => {})
    setUser(null)
    sessionStorage.removeItem('user')
  }

  if (electronMissing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: 24 }}>
        <div style={{
          maxWidth: 560,
          border: '1px solid #f0b4b0',
          background: '#fff0ef',
          color: '#8a2f2b',
          borderRadius: 10,
          padding: '24px 28px',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.5
        }}>
          <strong style={{ display: 'block', marginBottom: 8, fontSize: 16 }}>
            Desktop bridge not available
          </strong>
          <p style={{ margin: 0, fontSize: 13 }}>
            <code>window.electronAPI</code> is undefined, which means this page is open in a
            regular browser tab. Saves, imports, and settings will not persist here.
          </p>
          <p style={{ margin: '12px 0 0', fontSize: 13 }}>
            Close this tab and run the app through its Electron desktop window
            (<code>npm run dev</code>), which injects the bridge via <code>preload.js</code>.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <Router>
      <Layout user={user} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/search" element={<Search user={user} />} />
          <Route path="/students" element={<Students user={user} />} />
          <Route path="/help" element={<Help user={user} />} />
          {user.role === 'admin' && (
            <>
              <Route path="/import" element={<ImportScanner user={user} />} />
              <Route path="/settings" element={<Settings user={user} />} />
              <Route path="/logs" element={<ActivityLog user={user} />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}
