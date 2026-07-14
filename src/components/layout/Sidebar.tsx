import { NavIcon } from '../common/icons';
import { adminNav, workspaceNav } from '../../types/nav';
import type { ViewId } from '../../types/nav';

interface SidebarProps {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  /** Mobile drawer state — ignored on desktop widths. */
  open?: boolean;
}

/** Left navigation rail with brand, workspace/admin sections and user card. */
export function Sidebar({ active, onNavigate, open = false }: SidebarProps) {
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
        <div className="avatar">MK</div>
        <div className="user-info">
          <div className="user-name">Maja Kowalska</div>
          <div className="user-role">Treasury · Admin</div>
        </div>
      </div>
    </aside>
  );
}
