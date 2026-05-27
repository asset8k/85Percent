import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'

const navItems = [
  {
    to: '/simulator',
    label: 'Simulator',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 18V8" /><path d="M10 18V4" /><path d="M16 18V11" /><path d="M3 21h18" />
      </svg>
    ),
  },
  {
    to: '/history',
    label: 'History',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    to: '/calendar',
    label: 'Calendar',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="1.5" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" />
      </svg>
    ),
  },
  {
    to: '/setup',
    label: 'Settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8L4.2 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    ),
  },
]

const LogoutIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
  </svg>
)

export function Sidebar() {
  const { clubName } = useClubStore()
  const { signOut } = useAuthStore()

  return (
    <aside className="w-[240px] flex-shrink-0 h-screen border-r border-slate-200 bg-white flex flex-col sticky top-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-slate-100">
        <span className="inline-flex items-baseline gap-0 select-none" style={{ color: '#6d28d9', fontFamily: 'Inter', fontWeight: 700, letterSpacing: '-0.02em', fontSize: 20 }}>
          <span aria-hidden="true" className="inline-flex items-end" style={{ height: 22, marginRight: -1 }}>
            <svg width={18} height={22} viewBox="0 0 18 22" fill="none">
              {/* Left post — sideline */}
              <rect x="0" y="0" width="3.5" height="22" fill="#6d28d9" />
              {/* Right post — sideline */}
              <rect x="12.5" y="0" width="3.5" height="22" fill="#6d28d9" />
              {/* Halfway line */}
              <rect x="3.5" y="9.75" width="9" height="2.5" fill="#6d28d9" />
              {/* Top goal */}
              <rect x="5.5" y="0" width="5" height="3.5" fill="#6d28d9" opacity="0.65" />
              {/* Bottom goal */}
              <rect x="5.5" y="18.5" width="5" height="3.5" fill="#6d28d9" opacity="0.65" />
              {/* Center circle */}
              <circle cx="8" cy="11" r="2.6" stroke="#6d28d9" strokeWidth="1" fill="none" opacity="0.6" />
            </svg>
          </span>
          <span>eadroom</span>
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'group relative w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'text-violet-700'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-violet-600" />
                )}
                <span className={cn(isActive ? 'text-violet-600' : 'text-slate-400 group-hover:text-slate-600')}>
                  {icon}
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Workspace + sign out */}
      <div className="px-5 py-4 border-t border-slate-100">
        <div className="meta-label mb-2">Workspace</div>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-violet-600 text-white text-[11px] font-semibold flex-shrink-0">
            {clubName ? clubName.substring(0, 2).toUpperCase() : 'CL'}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-slate-900 truncate">{clubName ?? 'Your Club'}</div>
            <div className="text-[11px] text-slate-400">EFL Championship</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2 text-[13px] text-slate-400 hover:text-slate-700 transition-colors py-1"
        >
          {LogoutIcon}
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
