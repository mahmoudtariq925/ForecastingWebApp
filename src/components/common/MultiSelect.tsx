import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pushEscapeLayer } from './escapeLayer';

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
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * Where the panel goes, in viewport coordinates.
   *
   * It is rendered into `document.body` rather than beside its button, because
   * the control is used inside dialogs whose body scrolls and therefore CLIPS.
   * An absolutely positioned panel adds nothing to that body's scroll height,
   * so anything past the edge was simply cut off with no way to scroll to it —
   * the cycle dialog's entity picker showed two of eleven countries and hid
   * the rest behind the footer. Positioned against the viewport instead, the
   * list gets the room the screen has rather than the room the dialog has.
   */
  const [place, setPlace] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    // The panel is outside the wrapper in the DOM now, so it has to be asked
    // about separately or every click on an option would close the panel.
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Closing the panel is the whole of what this Escape does; a dialog
      // behind it must not also take it as "close me".
      e.stopPropagation();
      setOpen(false);
    };
    /**
     * Escape belongs to the panel while the panel is open.
     *
     * Without this the dialog it sits inside answers first — it listens in the
     * capture phase, which beats a bubble-phase listener however deeply nested
     * — and closes itself, taking the panel with it. The claim is released on
     * cleanup, so it lifts however the panel closes: a pick, a click outside,
     * Escape, or the whole screen going away.
     */
    const releaseEscape = pushEscapeLayer();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      releaseEscape();
    };
  }, [open]);

  // Measure on open, and again whenever the page moves under it — a fixed
  // panel does not travel with its button on its own.
  useEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const btn = wrapRef.current?.querySelector('.multi-select-btn');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vh = document.documentElement.clientHeight;
      const vw = document.documentElement.clientWidth;
      const GAP = 4;
      const MARGIN = 12;
      const below = vh - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      // Downward unless upward is genuinely roomier — a panel that flips for
      // a few pixels reads as a glitch.
      const up = below < 200 && above > below;
      const width = Math.min(Math.max(r.width, 200), 320);
      setPlace({
        top: up ? Math.max(MARGIN, r.top - GAP - Math.min(above, 320)) : r.bottom + GAP,
        // Kept on screen when the button sits near the right edge.
        left: Math.min(Math.max(MARGIN, r.left), Math.max(MARGIN, vw - width - MARGIN)),
        width,
        maxHeight: Math.max(120, Math.round(Math.min(up ? above : below, 320))),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
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
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="multi-select-panel"
            role="listbox"
            aria-multiselectable="true"
            // Hidden for the first paint, before the measurement lands: a panel
            // that appears in the wrong place and jumps is worse than one that
            // appears a frame later in the right one.
            style={
              place
                ? {
                    top: place.top,
                    left: place.left,
                    width: place.width,
                    maxHeight: place.maxHeight,
                  }
                : { visibility: 'hidden' }
            }
          >
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
          </div>,
        document.body,
      )}
    </div>
  );
}
