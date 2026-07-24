import { useEffect, useRef, useState } from 'react';
import { NavIcon } from '../common/icons';
import { users as seedUsers } from '../../data/mockData';
import { permissionsFor } from '../../data/session';
import { loadUsers } from '../../storage/localStorage';
import { navFor } from '../../types/nav';
import type { ViewId } from '../../types/nav';
import type { User } from '../../types';

interface SidebarProps {
  active: ViewId;
  user: User;
  onNavigate: (view: ViewId) => void;
  /** Dev-only mock session switch (until real authentication exists). */
  onSwitchUser: (email: string) => void;
  /** Mobile drawer state — ignored on desktop widths. */
  open?: boolean;
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * Left navigation rail. The sections are derived from the signed-in user's
 * permissions (treasury manager vs focused analyst), and the user card
 * doubles as a mock-session switcher for testing each experience.
 */
export function Sidebar({ active, user, onNavigate, onSwitchUser, open = false }: SidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const sections = navFor(permissionsFor(user));
  const allUsers = loadUsers(seedUsers);

  useEffect(() => {
    if (!switcherOpen) return;
    const close = (e: MouseEvent) => {
      if (!switcherRef.current?.contains(e.target as Node)) setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [switcherOpen]);

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          Liquid<span>·</span>
        </div>
        <div className="brand-sub">Cash Flow Forecasting</div>
      </div>

      <div className="nav-section">
        <div className="nav-label">Workspace</div>
        {sections.workspace.map((entry) => (
          <button
            key={entry.view}
            className={`nav-item${active === entry.view ? ' active' : ''}`}
            onClick={() => onNavigate(entry.view)}
          >
            <NavIcon view={entry.view} />
            {entry.label}
          </button>
        ))}
      </div>

      {sections.admin.length > 0 && (
        <div className="nav-section">
          <div className="nav-label">Admin</div>
          {sections.admin.map((entry) => (
            <button
              key={entry.view}
              className={`nav-item${active === entry.view ? ' active' : ''}`}
              onClick={() => onNavigate(entry.view)}
            >
              <NavIcon view={entry.view} />
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div className="user-card-wrap" ref={switcherRef}>
        {switcherOpen && (
          <div className="user-switcher" role="menu" aria-label="Switch mock user">
            <div className="nav-label" style={{ padding: '4px 8px 8px' }}>
              Switch User (dev)
            </div>
            {allUsers.map((u) => (
              <button
                key={u.email}
                className={`user-switch-item${u.email === user.email ? ' active' : ''}`}
                onClick={() => {
                  setSwitcherOpen(false);
                  if (u.email !== user.email) onSwitchUser(u.email);
                }}
              >
                <span className="avatar" style={{ width: 24, height: 24, fontSize: 9 }}>
                  {initials(u.name)}
                </span>
                <span className="user-switch-name">{u.name}</span>
                <span className={`role-tag ${u.role}`}>{u.role}</span>
              </button>
            ))}
          </div>
        )}
        <button
          className="user-card"
          onClick={() => setSwitcherOpen((v) => !v)}
          title="Switch mock user (no real sign-in yet)"
        >
          <div className="avatar">{initials(user.name)}</div>
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-role">
              {user.team} · {user.role}
            </div>
          </div>
          <span className="user-caret">▴</span>
        </button>
      </div>
    </aside>
  );
}
