import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, Warehouse, ShieldCheck, BookOpen, TrendingUp,
  Rocket, LogOut, Menu, X,
  FileBadge, PackageCheck,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { useLang, type Lang } from './i18n';

const NAV = [
  { to: '/', end: true, icon: LayoutDashboard, key: 'nav.dashboard' },
  { to: '/company-stock', icon: Boxes, key: 'nav.company' },
  { to: '/warehouses', icon: Warehouse, key: 'nav.warehouses' },
  { to: '/customs', icon: ShieldCheck, key: 'nav.customs' },
  { to: '/cleared', icon: PackageCheck, key: 'nav.cleared' },
  { to: '/catalog', icon: BookOpen, key: 'nav.catalog' },
  { to: '/certificates', icon: FileBadge, key: 'nav.certificates' },
  { to: '/sales', icon: TrendingUp, key: 'nav.sales' },
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const { t, lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  const initials = (user?.displayName || user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="logo"><Rocket size={22} color="#fff" /></div>
          <div>
            <div className="brand-name">ANDROMEDA</div>
            <div className="brand-sub">{t('app.tagline')}</div>
          </div>
        </div>

        <div className="sidebar-section-label">{t('nav.section')}</div>
        <nav>
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Icon size={20} />
                <span>{t(n.key)}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1 }}>
            <div className="u-name">{user?.displayName || user?.username}</div>
            <div className="u-role">{user?.role}</div>
          </div>
          <button className="btn-ghost btn btn-sm" title={t('action.logout')}
            onClick={() => signOut()} style={{ padding: 8 }}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="hamburger" onClick={() => setOpen((v) => !v)}>
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
            <span className="crumb">{loc.pathname === '/' ? t('nav.dashboard') : ''}</span>
          </div>
          <div className="topbar-right">
            <div className="lang-switch">
              {(['uz', 'ru', 'en'] as Lang[]).map((l) => (
                <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
