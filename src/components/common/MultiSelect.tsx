import { useEffect, useMemo, useRef, useState } from 'react';

interface MultiSelectProps {
  /** Accessible name for the control (the visible label sits beside it). */
  ariaLabel: string;
  options: string[];
  /** Chosen values. EMPTY MEANS NO FILTER — see the note below. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** What an empty selection reads as, e.g. "All countries". */
  emptyLabel: string;
  /** Noun for the summary line: "3 countries selected". */
  noun: string;
  placeholder?: string;
}

/**
 * A dropdown that takes any number of values, or none.
 *
 * A row of chips is fine for a demo's eleven countries and unusable at fifty:
 * it wraps into a wall above the thing it filters. This is one control of
 * fixed width whatever the list length, with a search box once the list is
 * long enough to need one.
 *
 * EMPTY MEANS EVERYTHING, which is why there is no "All" button: selecting
 * nothing is not an empty page, it is an unfiltered one. That is the
 * behaviour people already expect from a filter, and it removes the state
 * where a dashboard sits blank because the last chip was switched off.
 */
export function MultiSelect({
  ariaLabel,
  options,
  selected,
  onChange,
  emptyLabel,
  noun,
  placeholder = 'Search…',
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  // Search earns its place only once the list is too long to scan.
  const searchable = options.length > 8;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );

  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${noun} selected`;

  return (
    <div className="multi-select" ref={wrapRef}>
      <button
        type="button"
        className="form-select multi-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`multi-select-value${selected.length === 0 ? ' is-empty' : ''}`}>
          {summary}
        </span>
        <span className="multi-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="multi-select-panel" role="listbox" aria-multiselectable="true">
          {searchable && (
            <input
              className="form-input multi-select-search"
              autoFocus
              value={query}
              placeholder={placeholder}
              aria-label={`Search ${noun}`}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="multi-select-list">
            {shown.length === 0 ? (
              <div className="multi-select-empty">No match</div>
            ) : (
              shown.map((option) => (
                <label className="multi-select-option" key={option}>
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggle(option)}
                  />
                  {option}
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <button type="button" className="multi-select-clear" onClick={() => onChange([])}>
              Clear selection · show {emptyLabel.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
