import { NavIcon } from '../common/icons';
import { currentUser } from '../../data/session';
import { adminNav, workspaceNav } from '../../types/nav';
import type { ViewId } from '../../types/nav';

interface SidebarProps {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  /** Mobile drawer state — ignored on desktop widths. */
  open?: boolean;
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('');

/** Left navigation rail with brand, workspace/admin sections and user card. */
export function Sidebar({ active, onNavigate, open = false }: SidebarProps) {
  const me = currentUser();
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
        {workspaceNav.map((entry) => (
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

      <div className="nav-section">
        <div className="nav-label">Admin</div>
        {adminNav.map((entry) => (
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

      <div className="user-card">
        <div className="avatar">{initials(me.name)}</div>
        <div className="user-info">
          <div className="user-name">{me.name}</div>
          <div className="user-role">
            {me.team} · {me.role}
          </div>
        </div>
      </div>
    </aside>
  );
}
