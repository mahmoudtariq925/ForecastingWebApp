import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  /** Renders the entry in the danger colour (remove, delete). */
  danger?: boolean;
  /** Hide the entry entirely — simpler than filtering at every call site. */
  hidden?: boolean;
}

interface ActionMenuProps {
  /** Button text; defaults to "Edit". */
  label?: ReactNode;
  items: ActionMenuItem[];
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
}

/**
 * A row's actions behind one button.
 *
 * A table row carrying four competing buttons makes every row look urgent and
 * pushes the data off the screen; one "Edit" that opens the same four is the
 * same functionality at a quarter of the width.
 */
export function ActionMenu({ label = 'Edit', items, ariaLabel }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;

  return (
    <div className="action-menu" ref={wrapRef}>
      <button
        className="btn btn-ghost action-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {label}
        <span className="action-menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="action-menu-list" role="menu">
          {visible.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={`action-menu-item${item.danger ? ' danger' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
