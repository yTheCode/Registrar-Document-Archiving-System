import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, Search, Upload, Settings, Activity, LogOut, User, UserCog, HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { User as SessionUser } from '@/types'
import appLogo from '@/assets/logo-256.png'

interface LayoutProps {
  user: SessionUser
  onLogout: () => void
  children: ReactNode
}

function Layout({ user, onLogout, children }: LayoutProps) {
  const location = useLocation()

  const isActive = (path: string) => location.pathname === path

  // Help is placed by role: below Activity Log for admins, below Students for
  // regular staff. Same link, two positions.
  const helpLink = (
    <Link
      to="/help"
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-1 ${
        isActive('/help')
          ? 'bg-[#1a2942] text-[#d4a843]'
          : 'text-[#a4adba] hover:bg-[#1a2942] hover:text-white'
      }`}
    >
      <HelpCircle size={20} />
      <span>Help</span>
    </Link>
  )

  return (
    <div className="flex h-screen bg-[#f8fafc]">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0f1b2d] text-white flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[#1a2942]">
          <img
            src={appLogo}
            alt="AdZU Registrar Archive logo"
            className="mx-auto mb-3 h-16 w-16 object-contain"
          />
          <h2 className="text-center text-[15px] font-bold leading-snug text-[#d4a843] mb-4">
            AdZU Registrar Document Archiving System
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1a2942] text-[#d4a843]">
              {user.role === 'admin' ? <UserCog size={20} /> : <User size={20} />}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{user.username}</div>
              <div className="text-xs text-[#8793a3]">{user.role === 'admin' ? 'Administrator' : 'Regular Staff'}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <Link 
            to="/" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-1 ${
              isActive('/') 
                ? 'bg-[#1a2942] text-[#d4a843]' 
                : 'text-[#a4adba] hover:bg-[#1a2942] hover:text-white'
            }`}
          >
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </Link>
          
          <Link
            to="/students"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-1 ${
              isActive('/students')
                ? 'bg-[#1a2942] text-[#d4a843]'
                : 'text-[#a4adba] hover:bg-[#1a2942] hover:text-white'
            }`}
          >
            <Users size={20} />
            <span>Students</span>
          </Link>
          
          <Link 
            to="/search" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-1 ${
              isActive('/search') 
                ? 'bg-[#1a2942] text-[#d4a843]' 
                : 'text-[#a4adba] hover:bg-[#1a2942] hover:text-white'
            }`}
          >
            <Search size={20} />
            <span>Search Documents</span>
          </Link>

          {/* Regular Staff: Help sits right below Search Documents */}
          {user.role !== 'admin' && helpLink}
          
          {user.role === 'admin' && (
            <Link
              to="/import"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-1 ${
                isActive('/import')
                  ? 'bg-[#1a2942] text-[#d4a843]'
                  : 'text-[#a4adba] hover:bg-[#1a2942] hover:text-white'
              }`}
            >
              <Upload size={20} />
              <span>Upload Documents</span>
            </Link>
          )}

          {user.role === 'admin' && (
            <>
              <div className="my-3 border-t border-[#1a2942]"></div>
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#536d89]">
                Administration
              </div>
              
              <Link 
                to="/settings" 
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-1 ${
                  isActive('/settings') 
                    ? 'bg-[#1a2942] text-[#d4a843]' 
                    : 'text-[#a4adba] hover:bg-[#1a2942] hover:text-white'
                }`}
              >
                <Settings size={20} />
                <span>Settings</span>
              </Link>
              
              <Link 
                to="/logs" 
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-1 ${
                  isActive('/logs') 
                    ? 'bg-[#1a2942] text-[#d4a843]' 
                    : 'text-[#a4adba] hover:bg-[#1a2942] hover:text-white'
                }`}
              >
                <Activity size={20} />
                <span>Activity Log</span>
              </Link>

              {/* Admin: Help sits right below Activity Log */}
              {helpLink}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[#1a2942]">
          <button 
            onClick={onLogout} 
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-[#a4adba] hover:bg-[#1a2942] hover:text-white transition"
          >
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

export default Layout
