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
  /** Re-run the guided walkthrough for the signed-in user. */
  onReplayTour?: () => void;
  /** Mobile drawer state — ignored on desktop widths. */
  open?: boolean;
  /** Desktop: collapsed to an icon rail so the content area maximises. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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
export function Sidebar({
  active,
  user,
  onNavigate,
  onSwitchUser,
  onReplayTour,
  open = false,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const sections = navFor(permissionsFor(user));
  const allUsers = loadUsers(seedUsers);
  // Brand-new joiners are grouped separately: picking one always replays
  // that role's walkthrough, which is how each tour gets reviewed.
  const existingUsers = allUsers.filter((u) => !u.alwaysTour);
  const newJoiners = allUsers.filter((u) => u.alwaysTour);

  useEffect(() => {
    if (!switcherOpen) return;
    const close = (e: MouseEvent) => {
      if (!switcherRef.current?.contains(e.target as Node)) setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [switcherOpen]);

  // Collapsing hides labels, so the switcher panel would have nowhere to sit.
  const showSwitcher = switcherOpen && !collapsed;

  return (
    <aside className={`sidebar${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-text">
          <div className="brand-mark">
            Liquid<span>·</span>
          </div>
          <div className="brand-sub">Cash Flow Forecasting</div>
        </div>
        {onToggleCollapsed && (
          <button
            className="collapse-btn"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polyline points={collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
            </svg>
          </button>
        )}
      </div>

      {sections.workspace.length > 0 && (
        <div className="nav-section">
          <div className="nav-label">Workspace</div>
          {sections.workspace.map((entry) => (
            <button
              key={entry.view}
              className={`nav-item${active === entry.view ? ' active' : ''}`}
              onClick={() => onNavigate(entry.view)}
              title={collapsed ? entry.label : undefined}
              data-tour={`nav-${entry.view}`}
            >
              <NavIcon view={entry.view} />
              <span className="nav-item-label">{entry.label}</span>
            </button>
          ))}
        </div>
      )}

      {sections.admin.length > 0 && (
        <div className="nav-section">
          <div className="nav-label">{sections.workspace.length > 0 ? 'Admin' : 'Administration'}</div>
          {sections.admin.map((entry) => (
            <button
              key={entry.view}
              className={`nav-item${active === entry.view ? ' active' : ''}`}
              onClick={() => onNavigate(entry.view)}
              title={collapsed ? entry.label : undefined}
              data-tour={`nav-${entry.view}`}
            >
              <NavIcon view={entry.view} />
              <span className="nav-item-label">{entry.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="user-card-wrap" ref={switcherRef}>
        {showSwitcher && (
          <div className="user-switcher" role="menu" aria-label="User menu">
            {onReplayTour && (
              <>
                <div className="nav-label" style={{ padding: '4px 8px 8px' }}>
                  Help
                </div>
                <button
                  className="user-switch-item"
                  data-tour="replay-walkthrough"
                  onClick={() => {
                    setSwitcherOpen(false);
                    onReplayTour();
                  }}
                >
                  <span className="tour-replay-icon" aria-hidden="true">
                    ?
                  </span>
                  <span className="user-switch-name">Replay walkthrough</span>
                </button>
                <div className="user-switcher-divider" />
              </>
            )}
            {newJoiners.length > 0 && (
              <>
                <div className="nav-label" style={{ padding: '4px 8px 8px' }}>
                  New joiners · runs the tour
                </div>
                {newJoiners.map((u) => (
                  <button
                    key={u.email}
                    className={`user-switch-item joiner${u.email === user.email ? ' active' : ''}`}
                    data-tour-demo={u.role}
                    title={`Start the ${u.role} walkthrough as ${u.name}`}
                    onClick={() => {
                      setSwitcherOpen(false);
                      if (u.email !== user.email) onSwitchUser(u.email);
                      else onReplayTour?.();
                    }}
                  >
                    <span className="avatar" style={{ width: 24, height: 24, fontSize: 9 }}>
                      {initials(u.name)}
                    </span>
                    <span className="user-switch-name">{u.name}</span>
                    <span className={`role-tag ${u.role}`}>{u.role}</span>
                  </button>
                ))}
                <div className="user-switcher-divider" />
              </>
            )}
            <div className="nav-label" style={{ padding: '4px 8px 8px' }}>
              Switch User (dev)
            </div>
            {existingUsers.map((u) => (
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
          onClick={() => (collapsed ? onToggleCollapsed?.() : setSwitcherOpen((v) => !v))}
          title={
            collapsed
              ? `${user.name} · ${user.role} — expand to switch user`
              : 'Switch mock user (no real sign-in yet)'
          }
        >
          <div className="avatar">{initials(user.name)}</div>
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-role">
              {user.team ? `${user.team} · ` : ''}
              {user.role}
            </div>
          </div>
          <span className="user-caret">▴</span>
        </button>
      </div>
    </aside>
  );
}
