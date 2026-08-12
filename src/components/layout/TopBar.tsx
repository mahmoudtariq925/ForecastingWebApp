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

/**
 * The active-cycle status pill used in several top bars.
 *
 * With `onClick` it becomes the way INTO the cycle it names — treasury reads
 * it and wants the cycle list, and a badge that names a thing you can open is
 * the obvious place to click. Without one it stays a plain status badge, which
 * is all it can be for a role with no cycles screen to open.
 */
export function CyclePill({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="dot" />
      <span className="label">{label}</span>
      <span className="val">{value}</span>
    </>
  );
  return onClick ? (
    <button className="cycle-pill cycle-pill-link" onClick={onClick} title="Open Forecast Cycles">
      {body}
    </button>
  ) : (
    <div className="cycle-pill">{body}</div>
  );
}
