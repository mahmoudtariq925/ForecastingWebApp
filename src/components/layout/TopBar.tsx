import type { ReactNode } from 'react';

interface TopBarProps {
  crumb: string;
  title: string;
  actions?: ReactNode;
}

/** Page header with breadcrumb, serif title and a right-aligned actions slot. */
export function TopBar({ crumb, title, actions }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="page-title-wrap">
        <div className="crumb">{crumb}</div>
        <h1>{title}</h1>
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </header>
  );
}

/** The active-cycle status pill used in several top bars. */
export function CyclePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="cycle-pill">
      <span className="dot" />
      <span className="label">{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}
