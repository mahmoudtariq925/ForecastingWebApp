import {
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { TemplateCategory, TemplateLayout } from '../../types';
import type { DayLabel } from '../../data/periods';
import {
  catTotal,
  catValue,
  categoryGroups,
  cellKey,
  dayInflows,
  dayNet,
  dayOutflows,
  groupIsEmpty,
  groupTotal,
  groupValue,
  hasAnyValue,
  isPartialNumber,
  parseCellNumber,
  runningBalance,
  subtotalTotal,
  subtotalValue,
  type GridValues,
} from './gridMath';
import {
  heatColor,
  NEUTRAL_SCALE,
  useHeatScale,
  useHeatScales,
  type HeatScale,
} from './heatmap';

const fmt = (v: number) => (v === 0 ? '—' : v.toLocaleString());

/**
 * Sign colouring for a net figure: red below zero, green above. Applied to
 * the net cash flow rows/columns only — the line items already carry the
 * heat map, and colouring every number would leave nothing standing out.
 */
const netClass = (v: number) => (v < 0 ? ' net-negative' : v > 0 ? ' net-positive' : '');

export interface ForecastGridProps {
  categories: TemplateCategory[];
  layout: TemplateLayout;
  dayLabels: DayLabel[];
  values: GridValues;
  flags: Set<string>;
  /** Cells carrying an open treasury question, marked apart from a flag. */
  requested?: Set<string>;
  /**
   * Cells whose question has been answered. Marked for whoever asked, so a
   * reply can be found on the grid rather than only in a queue elsewhere.
   */
  answered?: Set<string>;
  /**
   * Focus mode: when set, these cells are spotlit and every other cell is
   * dimmed. Used to point at the cells still needing input before submission.
   */
  highlight?: Set<string> | null;
  /**
   * How the focus mode reads: `input` (red, strong dim) points at cells that
   * still need a number; `comment` (amber, soft dim) walks the guided
   * commentary flow, where the surrounding numbers must stay readable.
   */
  highlightTone?: 'input' | 'comment';
  /** Opening balance; `null` hides the running-total column entirely. */
  startingBalance: number | null;
  dayComments?: Record<string, string>;
  editable: boolean;
  /** `null` = the cell was cleared, which is different from a forecast of 0. */
  onChangeCell?: (catIdx: number, dayIdx: number, value: number | null) => void;
  /** Paste starting at a cell; the editor maps rows/cols per layout. */
  onPaste?: (catIdx: number, dayIdx: number, e: ClipboardEvent<HTMLInputElement>) => void;
  onCellClick?: (catIdx: number, dayIdx: number) => void;
  /**
   * Which cells respond to a click. Submitters explain flagged cells;
   * treasury asks about any cell, flagged or not.
   */
  clickableCells?: 'flagged' | 'all';
  /**
   * Cells whose figure is a set of counterparty legs rather than a number
   * somebody types. They are opened, not edited — see `onOpenIntercompany`.
   */
  intercompany?: Set<string>;
  /**
   * Open the counterparty breakdown. `digit` is the key that opened it, so
   * typing a number straight into the cell starts the first amount with it
   * rather than being swallowed by a cell that cannot be typed into.
   */
  onOpenIntercompany?: (catIdx: number, dayIdx: number, digit?: string) => void;
  /** Cells carrying an unsettled disagreement with a mirrored figure. */
  mismatched?: Set<string>;
  /** Open the mismatch thread on a cell. */
  onOpenMismatch?: (catIdx: number, dayIdx: number) => void;
  onChangeDayComment?: (dayIdx: number, comment: string) => void;
  /** Diverging heatmap on the numeric cells (on by default). */
  heatmap?: boolean;
  /**
   * What each cell is shaded AGAINST.
   *
   * `row` (the default) scales every line item against itself — the colour
   * then answers "is this a big week for receivables?". `grid` puts every
   * data cell on one scale, which answers "where is the money in this
   * forecast at all?" and washes the smaller lines out entirely. Both are
   * legitimate readings, so the forecast screen offers the choice.
   */
  heatmapScope?: 'row' | 'grid';
  /** Extra pinned row/column summing every line item per period. */
  showColumnTotals?: boolean;
  /**
   * Section indices currently collapsed to a single total. Reviewers open a
   * forecast to read its shape, not its twelve line items, so they start
   * collapsed; the submitter entering numbers starts expanded.
   */
  collapsedGroups?: Set<number>;
  onToggleGroup?: (groupIndex: number) => void;
}

/**
 * One scale per family of magnitudes. A single shared scale would be
 * useless here: horizon totals are ~20x a daily cell and running balances
 * bigger still, so one scale crushes every data cell to the minimum tint.
 * Each family is normalised against its own visible range, all sharing the
 * same fixed midpoint of 0.
 *
 * The line-item cells go one step further and take a scale PER CATEGORY:
 * receivables are shaded against other receivables and payables against
 * other payables, so the colour answers "is this a big week for this line?"
 * rather than "is this line bigger than payroll?" — which the labels
 * already say. (The grid only ever shows one country's one forecast, so a
 * per-category scale is per category, per country, per forecast.)
 */
interface GridScales {
  /** Line-item / subtotal cells, indexed by category. */
  byCat: HeatScale[];
  /** Collapsed section rows, indexed by group. */
  byGroup: HeatScale[];
  /** Trailing Total column / Net row. */
  totals: HeatScale;
  /** Running-total (closing balance) column. */
  balances: HeatScale;
}

/** Recompute the colour extremes from the cells currently on screen. */
function useGridScales(props: ForecastGridProps): GridScales {
  const {
    categories,
    values,
    startingBalance,
    dayLabels,
    heatmap = true,
    heatmapScope = 'row',
  } = props;
  const numDays = dayLabels.length;
  const numCats = categories.length;

  // One band per line item — or, when the whole grid is one scale, the same
  // band repeated so every cell is measured against the forecast's extremes.
  const catScales = useHeatScales(() => {
    if (!heatmap) return [];
    const rows = Array.from({ length: numCats }, (_v, c) =>
      Array.from({ length: numDays }, (_x, d) =>
        categories[c]?.subtotal
          ? subtotalValue(categories, values, c, d)
          : catValue(values, c, d),
      ),
    );
    if (heatmapScope === 'row') return rows;
    const all = rows.flat();
    return rows.map(() => all);
  }, [heatmap, heatmapScope, categories, values, numDays, numCats]);

  // A collapsed section stands in for its line items, so it takes a band of
  // its own rather than borrowing one of theirs.
  const groupScales = useHeatScales(() => {
    if (!heatmap) return [];
    return categoryGroups(categories).map((g) =>
      Array.from({ length: numDays }, (_x, d) => groupValue(categories, values, g.idxs, d)),
    );
  }, [heatmap, categories, values, numDays]);

  const totalScale = useHeatScale(() => {
    if (!heatmap) return [];
    const out: number[] = [];
    for (let c = 0; c < numCats; c++) {
      out.push(
        categories[c]?.subtotal
          ? subtotalTotal(categories, values, c, numDays)
          : catTotal(values, c, numDays),
      );
    }
    for (let d = 0; d < numDays; d++) out.push(dayNet(numCats, values, d));
    return out;
  }, [heatmap, categories, values, numDays, numCats]);

  const balanceScale = useHeatScale(() => {
    if (!heatmap || startingBalance === null) return [];
    const out: number[] = [];
    for (let d = 0; d < numDays; d++) {
      out.push(runningBalance(numCats, values, startingBalance, d));
    }
    return out;
  }, [heatmap, values, numCats, numDays, startingBalance]);

  return useMemo(
    () =>
      heatmap
        ? { byCat: catScales, byGroup: groupScales, totals: totalScale, balances: balanceScale }
        : { byCat: [], byGroup: [], totals: NEUTRAL_SCALE, balances: NEUTRAL_SCALE },
    [heatmap, catScales, groupScales, totalScale, balanceScale],
  );
}

/** The scale a band uses, falling back to neutral (no tint) when absent. */
const bandScale = (scales: HeatScale[], index: number): HeatScale =>
  scales[index] ?? NEUTRAL_SCALE;

/**
 * How many open questions are hidden inside a section.
 *
 * Collapsing a section hides the blue cells in it, and with them the only
 * sign that someone is waiting on an answer — so the section band says it.
 */
function questionsInGroup(idxs: number[], requested: Set<string> | undefined): number {
  if (!requested || requested.size === 0) return 0;
  const inGroup = new Set(idxs);
  let count = 0;
  for (const key of requested) {
    if (inGroup.has(Number(key.split('-')[0]))) count += 1;
  }
  return count;
}

/** The "3 questions" marker a collapsed section carries. */
function SectionQuestions({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="section-questions"
      title={`${count} open question${count === 1 ? '' : 's'} inside this section`}
    >
      ? {count}
    </span>
  );
}

/**
 * How many cells inside a section disagree with a counterparty's figure.
 *
 * Derived exactly like the question count above and for the same reason:
 * collapsing a section hides the flagged cells in it, and with them the only
 * sign that two entities are carrying different numbers for the same movement.
 */
function mismatchesInGroup(idxs: number[], mismatched: Set<string> | undefined): number {
  if (!mismatched || mismatched.size === 0) return 0;
  const inGroup = new Set(idxs);
  let count = 0;
  for (const key of mismatched) {
    if (inGroup.has(Number(key.split('-')[0]))) count += 1;
  }
  return count;
}

/** The "! 2" marker a section carries when a cell inside it is disputed. */
function SectionMismatches({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="section-mismatches"
      title={`${count} intercompany mismatch${count === 1 ? '' : 'es'} inside this section`}
    >
      ! {count}
    </span>
  );
}

/** Inline background for a numeric cell, or undefined to leave it plain. */
function fill(value: number, scale: HeatScale): { background: string } | undefined {
  const background = heatColor(value, scale);
  return background ? { background } : undefined;
}

/**
 * The forecast grid, rendered in the template's layout:
 * - `days-across`: line items down the rows, one column per working day.
 * - `grouped`: one row per working day, categories across columns under
 *   group bands with Comments / Total / Running total (standard workbook).
 * Values are keyed `${catIdx}-${dayIdx}` in both layouts.
 */
export function ForecastGrid(props: ForecastGridProps) {
  const scales = useGridScales(props);
  return props.layout === 'grouped' ? (
    <GroupedGrid {...props} scales={scales} />
  ) : (
    <DaysAcrossGrid {...props} scales={scales} />
  );
}

function EditableCell({
  catIdx,
  dayIdx,
  props,
  scale,
  extraClass = '',
}: {
  catIdx: number;
  dayIdx: number;
  props: ForecastGridProps;
  scale: HeatScale;
  extraClass?: string;
}) {
  const {
    categories,
    values,
    flags,
    requested,
    answered,
    highlight,
    highlightTone = 'input',
    editable,
    onChangeCell,
    onPaste,
    onCellClick,
    clickableCells = 'flagged',
    intercompany,
    onOpenIntercompany,
    mismatched,
    onOpenMismatch,
  } = props;
  const key = cellKey(catIdx, dayIdx);
  const flagged = flags.has(key);
  const asked = requested?.has(key) ?? false;
  // A question that has come back. Marked only where `answered` is passed —
  // the asker's view — and never clickable-by-itself: the cell already opens.
  const replied = (answered?.has(key) ?? false) && !asked;
  // Focus mode. Pre-submit validation dims the rest of the grid, because the
  // empty cells are the only thing that matters then. The commentary flow
  // does NOT: writing "what drives this change" means reading the numbers
  // around the cell, and shading the whole forecast to point at one cell of
  // it took those numbers away.
  const spotlit = `cell-spotlit${highlightTone === 'comment' ? ' spotlit-comment' : ''}`;
  const focus = highlight
    ? highlight.has(key)
      ? ` ${spotlit}`
      : highlightTone === 'comment'
        ? ''
        : ' cell-dimmed'
    : '';

  // Computed subtotal rows are never editable — the app derives them.
  if (categories[catIdx]?.subtotal) {
    const sub = subtotalValue(categories, values, catIdx, dayIdx);
    return (
      <td
        className={`cell subtotal-cell ${extraClass}${focus}`.trim()}
        style={fill(sub, scale)}
      >
        {fmt(sub)}
      </td>
    );
  }

  const val = catValue(values, catIdx, dayIdx);
  // A cell with a question on it always opens, whatever the flag set says.
  // Flags are recomputed from the numbers on every edit, and a question can
  // sit on a cell those rules would not flag — an empty one, say — which is
  // how a question could end up with no way to answer it.
  const clickable = Boolean(onCellClick) && (clickableCells === 'all' || flagged || asked);
  /**
   * A cell with a question on it is opened, not typed into: the whole cell is
   * the button. Leaving it as a plain input meant the only ways into the one
   * thing being asked for were a 16px pencil and the banner above the grid.
   */
  const toAnswer = asked && clickable;
  /** An intercompany cell: its figure is a set of counterparty legs. */
  const interco = (intercompany?.has(key) ?? false) && Boolean(onOpenIntercompany);
  /** This cell disagrees with a figure a counterparty mirrored in. */
  const disputed = (mismatched?.has(key) ?? false) && Boolean(onOpenMismatch);
  /**
   * Who gets the intercompany breakdown on the CELL, and who gets it on a
   * button beside it.
   *
   * The entering side (`clickableCells === 'flagged'` — submitters and
   * viewers) opens it from the cell itself, exactly as a question cell opens:
   * an intercompany figure is never typed, so there is nothing else a click
   * there could mean. A reviewer's click already means "ask about this cell"
   * and must keep meaning that, so theirs moves to the icon button — and no
   * second click handler is added to a td whose onClick already fires twice on
   * a double click.
   *
   * A question outranks both: somebody is waiting on an answer, and the
   * breakdown falls back to the button so the deep-link and auto-open paths
   * that aim at question cells are untouched.
   */
  const breakdownOnCell = interco && !toAnswer && clickableCells !== 'all';
  /** ...so the button appears exactly where the cell itself means something else. */
  const breakdownOnButton = interco && !breakdownOnCell;
  // `cell-input` marks the cells a value can be typed into — the only ones
  // that lift under the pointer (see the raise-on-hover rule in the CSS).
  const cls = `cell ${flagged ? 'variance-flag' : ''} ${asked ? 'comment-requested' : ''} ${
    replied ? 'comment-answered' : ''
  } ${interco ? 'cell-intercompany' : ''} ${disputed ? 'cell-mismatched' : ''} ${
    clickable || breakdownOnCell ? 'cell-askable' : ''
  } ${editable && !toAnswer && !breakdownOnCell ? 'cell-input' : ''} ${extraClass}${focus}`
    .replace(/\s+/g, ' ')
    .trim();
  // A variance flag keeps its amber background — it outranks the heatmap.
  const style = flagged ? undefined : fill(val, scale);
  const open = () => onCellClick?.(catIdx, dayIdx);
  const openBreakdown = (digit?: string) => onOpenIntercompany?.(catIdx, dayIdx, digit);
  const cellName = categories[catIdx]?.label ?? 'this cell';

  /**
   * The small marks a cell can carry on its right edge, in both the editable
   * and the read-only branch. Each one stops the click from reaching the cell,
   * so whatever the cell itself does is left exactly as it was.
   */
  const marks =
    breakdownOnButton || disputed ? (
      <span className="cell-marks">
        {breakdownOnButton && (
          <button
            type="button"
            className="cell-interco-btn"
            tabIndex={-1}
            title="Show the counterparty breakdown for this cell"
            aria-label={`Counterparty breakdown for ${cellName}, period ${dayIdx + 1}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              openBreakdown();
            }}
          >
            ⇄
          </button>
        )}
        {disputed && (
          <button
            type="button"
            className="cell-mismatch-btn"
            tabIndex={-1}
            title="This figure disagrees with the counterparty's — open the thread"
            aria-label={`Intercompany mismatch on ${cellName}, period ${dayIdx + 1}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenMismatch?.(catIdx, dayIdx);
            }}
          >
            !
          </button>
        )}
      </span>
    ) : null;

  // A read-only grid has nothing else a click could mean, so the whole cell
  // opens the dialog — and so does a cell waiting on an answer, where the
  // dialog is the whole job. Both carry the cell coordinates an editable one
  // does, so a deep link ("explain THIS cell") still finds and scrolls to it,
  // and Enter opens the one the keyboard has landed on.
  const asButton = toAnswer || breakdownOnCell;
  if (!editable || asButton) {
    return (
      <td
        className={cls}
        style={style}
        data-cat={catIdx}
        data-day={dayIdx}
        onClick={breakdownOnCell ? () => openBreakdown() : clickable ? open : undefined}
        role={asButton ? 'button' : undefined}
        tabIndex={asButton ? 0 : undefined}
        title={
          toAnswer
            ? editable
              ? 'Open the question on this cell and answer it'
              : 'Open the question on this cell'
            : breakdownOnCell
              ? editable
                ? 'Enter this figure by counterparty — click, or type a number'
                : 'Show the counterparty breakdown for this cell'
              : undefined
        }
        onKeyDown={
          asButton
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (breakdownOnCell) openBreakdown();
                  else open();
                  return;
                }
                // Typing a number at an intercompany cell means the same
                // thing it means at any other cell — start entering. The cell
                // cannot hold the digit itself, so it opens the breakdown and
                // the digit begins the first amount. Arrow keys are untouched
                // and fall through to the movement handler, so ARRIVING at
                // one of these cells still opens nothing.
                if (breakdownOnCell && editable && /^[0-9-]$/.test(e.key)) {
                  e.preventDefault();
                  openBreakdown(e.key);
                  return;
                }
                moveWithKeyboard(e);
              }
            : undefined
        }
      >
        {fmt(val)}
        {marks}
      </td>
    );
  }
  // An EDITABLE cell must stay editable: clicking it puts the caret in the
  // number, and the commentary/request dialog gets its own small button
  // rather than hijacking every click on the grid.
  return (
    <td className={cls} style={style}>
      <NumberCell
        value={val}
        catIdx={catIdx}
        dayIdx={dayIdx}
        onChange={(n) => onChangeCell?.(catIdx, dayIdx, n)}
        onPaste={(e) => onPaste?.(catIdx, dayIdx, e)}
      />
      {clickable && (
        <button
          type="button"
          className="cell-note-btn"
          tabIndex={-1}
          title={asked ? 'Open the question on this cell' : 'Comment on this cell'}
          aria-label={`Comment on ${cellName}, period ${dayIdx + 1}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
        >
          ?
        </button>
      )}
      {marks}
    </td>
  );
}

/**
 * A numeric cell that keeps the text the user is typing.
 *
 * Binding the input straight to the number meant every keystroke was parsed
 * and echoed back, so any transient text that isn't yet a valid number was
 * destroyed: "-" became "" (typing -500 stored 500) and "1." became "1"
 * (typing 1.5 stored 15). Holding a draft while the cell is being edited,
 * and committing the parsed value alongside it, fixes both while keeping the
 * grid a controlled component everywhere else.
 */
function NumberCell({
  value,
  catIdx,
  dayIdx,
  onChange,
  onPaste,
}: {
  value: number;
  catIdx: number;
  dayIdx: number;
  onChange: (value: number | null) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
}) {
  // null = not being edited, so the cell shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  // What the cell held when this edit started. The grid commits on every
  // keystroke, so without remembering this there is nothing for Escape to put
  // back — pressing it did nothing at all, and Undo was the only way out of a
  // number you had started typing over.
  const committedBefore = useRef<number>(value);

  return (
    <input
      value={draft ?? (value === 0 ? '' : String(value))}
      data-cat={catIdx}
      data-day={dayIdx}
      onFocus={() => {
        committedBefore.current = value;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (draft === null) committedBefore.current = value;
        setDraft(raw);
        // Emptying a cell empties it. Committing 0 instead would make
        // "no forecast yet" indistinguishable from "the forecast is zero",
        // which is exactly the difference pre-submit validation reports on.
        if (raw.trim() === '') {
          onChange(null);
          return;
        }
        const parsed = parseCellNumber(raw);
        // Commit whatever parses; leave partial input ("-", "1.") on screen
        // as typed rather than replacing it with a half-finished number.
        if (parsed !== null) onChange(parsed);
        else if (!isPartialNumber(raw)) onChange(0);
      }}
      onBlur={() => {
        // Settle on the stored value: "1." shows as 1, junk clears to blank.
        if (draft !== null) onChange(draft.trim() === '' ? null : (parseCellNumber(draft) ?? 0));
        setDraft(null);
      }}
      onPaste={(e) => {
        setDraft(null);
        onPaste(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Abandon the edit: put the cell back exactly as it was found.
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
          onChange(committedBefore.current === 0 ? null : committedBefore.current);
          return;
        }
        moveWithKeyboard(e);
      }}
    />
  );
}

/**
 * Spreadsheet keyboard movement.
 *
 * The grid is a data-entry surface, so arrows, Enter and Shift+Enter move
 * between cells the way Excel does; previously the only way across a 12x20
 * grid was to Tab through every cell in turn. Cells are addressed by their
 * `data-cat` / `data-day` attributes, which both orientations already carry,
 * so one handler serves the whole grid.
 */
function moveWithKeyboard(e: ReactKeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'];
  if (!keys.includes(e.key)) return;
  const from = e.currentTarget;
  // Left/right inside a partly-typed value should still move the caret — but
  // when the value is fully selected (which is how a cell arrives after a
  // move) the user means "next cell", not "collapse the selection". A cell
  // waiting on an answer holds no caret, so it always means "next cell".
  if (from instanceof HTMLInputElement) {
    const { selectionStart, selectionEnd, value } = from;
    const allSelected = selectionStart === 0 && selectionEnd === value.length && value.length > 0;
    if (e.key === 'ArrowLeft' && !allSelected && selectionStart !== 0) return;
    if (e.key === 'ArrowRight' && !allSelected && selectionEnd !== value.length) return;
  }

  const cat = Number(from.dataset.cat);
  const day = Number(from.dataset.day);
  if (!Number.isFinite(cat) || !Number.isFinite(day)) return;

  const grid = from.closest<HTMLElement>('.forecast-grid');
  // Arrows are SCREEN directions, so which coordinate they step depends on
  // the layout: the grouped (dates-down-rows) grid puts days on the rows and
  // line items across the columns, days-across is the other way round.
  // Mapping up/down to `cat` unconditionally made the arrows move sideways
  // in the default layout.
  const rowsAreDays = grid?.dataset.rows === 'days';
  let nextCat = cat;
  let nextDay = day;
  const stepDown = (n: number) => {
    if (rowsAreDays) nextDay += n;
    else nextCat += n;
  };
  const stepRight = (n: number) => {
    if (rowsAreDays) nextCat += n;
    else nextDay += n;
  };
  if (e.key === 'ArrowUp') stepDown(-1);
  else if (e.key === 'ArrowDown') stepDown(1);
  else if (e.key === 'ArrowLeft') stepRight(-1);
  else if (e.key === 'ArrowRight') stepRight(1);
  else if (e.key === 'Enter') stepDown(e.shiftKey ? -1 : 1);

  // Either the next cell's input or — where a question is waiting — the cell
  // itself, so spreadsheet movement runs through the whole row either way.
  const target = grid?.querySelector<HTMLElement>(
    `input[data-cat="${nextCat}"][data-day="${nextDay}"], td[data-cat="${nextCat}"][data-day="${nextDay}"][tabindex]`,
  );
  if (!target) return;
  e.preventDefault();
  target.focus();
  if (target instanceof HTMLInputElement) target.select();
}

// ---------------------------------------------------------------------------
// days-across: rows = line items, columns = days
// ---------------------------------------------------------------------------
function DaysAcrossGrid(props: ForecastGridProps & { scales: GridScales }) {
  const {
    categories,
    dayLabels,
    values,
    startingBalance,
    dayComments,
    editable,
    onChangeDayComment,
    showColumnTotals,
    scales,
  } = props;
  const numDays = dayLabels.length;
  const numCats = categories.length;
  const groups = categoryGroups(categories);

  const computedRows: {
    label: string;
    day: (d: number) => number;
    kind: string;
    /** Sign-coloured (red below zero, green above) — net figures only. */
    signed?: boolean;
  }[] = [
    { label: 'Total Inflows', day: (d) => dayInflows(numCats, values, d), kind: 'subtotal' },
    { label: 'Total Outflows', day: (d) => dayOutflows(numCats, values, d), kind: 'subtotal' },
    {
      label: 'Net Cash Flow',
      day: (d) => dayNet(numCats, values, d),
      kind: 'total',
      signed: true,
    },
    // A closing balance only means something once an opening one is given.
    ...(startingBalance === null
      ? []
      : [
          {
            label: 'Closing Balance',
            day: (d: number) => runningBalance(numCats, values, startingBalance, d),
            kind: 'total',
          },
        ]),
  ];

  return (
    <table className="forecast-grid" data-rows="categories">
      <thead>
        <tr className="label-row">
          <th className="row-label-h">Cash Flow Category</th>
          {/* The date IS the column's name. A "D1…Dn" index above it added a
              line of text to every header for something no one refers to — a
              forecast is discussed as "Friday the 14th", never as "D5". */}
          {dayLabels.map((dl, i) => (
            <th key={i} className="day-h">
              {dl.dm}
              {/* On a monthly template the weekday line reads "July" under
                  "Jul 26" — the same word twice, in two sizes. */}
              {!dl.dm.startsWith(dl.dow.slice(0, 3)) && <span className="dow">{dl.dow}</span>}
            </th>
          ))}
          <th className="day-h" style={{ background: 'var(--n-200)' }}>
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g, gi) => (
          <GroupRows key={gi} group={g} groupIndex={gi} props={props} scales={scales} />
        ))}
        {showColumnTotals && (
          <tr className="column-totals-row">
            <td className="row-label total">Column Total</td>
            {dayLabels.map((_dl, d) => (
              <td key={d} className="cell total-cell">
                {fmt(dayNet(numCats, values, d))}
              </td>
            ))}
            <td className="cell total-cell">
              {Array.from({ length: numDays }, (_v, d) => dayNet(numCats, values, d))
                .reduce((a, b) => a + b, 0)
                .toLocaleString()}
            </td>
          </tr>
        )}
        {computedRows.map((row) => {
          const rowTotal =
            row.label === 'Closing Balance'
              ? row.day(numDays - 1)
              : Array.from({ length: numDays }, (_v, d) => row.day(d)).reduce((a, b) => a + b, 0);
          return (
            <tr key={row.label}>
              <td className={`row-label ${row.kind}`}>{row.label}</td>
              {dayLabels.map((_dl, d) => {
                const v = row.day(d);
                return (
                  <td
                    key={d}
                    className={`cell ${row.kind}-cell${row.signed ? netClass(v) : ''}`}
                  >
                    {fmt(v)}
                  </td>
                );
              })}
              <td
                className={`cell ${row.kind}-cell${row.signed ? netClass(rowTotal) : ''}`}
                style={{ background: 'var(--n-100)', fontWeight: 600 }}
              >
                {rowTotal.toLocaleString()}
              </td>
            </tr>
          );
        })}
        {dayComments !== undefined && (
          <tr>
            <td className="row-label">Comments</td>
            {dayLabels.map((_dl, d) => (
              <td key={d} className="cell comment-cell">
                {editable ? (
                  <input
                    type="text"
                    className="comment-input"
                    value={dayComments?.[String(d)] ?? ''}
                    onChange={(e) => onChangeDayComment?.(d, e.target.value)}
                  />
                ) : (
                  <span style={{ padding: '0 8px' }}>{dayComments?.[String(d)] ?? ''}</span>
                )}
              </td>
            ))}
            <td className="cell" style={{ background: 'var(--n-100)' }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function GroupRows({
  group,
  groupIndex,
  props,
  scales,
}: {
  group: ReturnType<typeof categoryGroups>[number];
  groupIndex: number;
  props: ForecastGridProps;
  scales: GridScales;
}) {
  const {
    categories,
    dayLabels,
    values,
    collapsedGroups,
    onToggleGroup,
    requested,
    mismatched,
  } = props;
  const numDays = dayLabels.length;
  const totalScale = scales.totals;
  // Only a named section can collapse — loose line items have nothing to
  // collapse into.
  const collapsible = Boolean(group.label) && Boolean(onToggleGroup);
  const collapsed = collapsible && (collapsedGroups?.has(groupIndex) ?? false);
  const questions = questionsInGroup(group.idxs, requested);
  const mismatches = mismatchesInGroup(group.idxs, mismatched);
  // A section with nothing in it says so on its own row. Collapsed, a row of
  // "—" across every column is indistinguishable from a section of zeros
  // somebody actually forecast, and it is worth knowing which you are looking
  // at before opening it. On a forecast where NOTHING is filled in yet the
  // mark goes on every section and so tells you nothing — it is held back
  // until there is something for an empty section to be empty next to.
  const empty =
    hasAnyValue(values) && groupIsEmpty(categories, values, group.idxs, numDays);
  // Alternating tint so one section is visibly a different block from the
  // next, rather than twelve identical rows running together.
  const band = groupIndex % 2 === 0 ? ' band-a' : ' band-b';

  return (
    <>
      {group.label && (
        <tr
          className={`section-row${band}${collapsed ? ' section-collapsed' : ''}${
            questions > 0 ? ' section-questioned' : ''
          }${mismatches > 0 ? ' section-mismatched' : ''}${empty ? ' section-empty' : ''}`}
        >
          {/* The whole label cell toggles the section — the caret button is
              signage, not the only target. */}
          <td
            className={`row-label${collapsible ? ' row-label-toggle' : ''}`}
            onClick={collapsible ? () => onToggleGroup?.(groupIndex) : undefined}
            role={collapsible ? 'button' : undefined}
            tabIndex={collapsible ? 0 : undefined}
            aria-expanded={collapsible ? !collapsed : undefined}
            onKeyDown={
              collapsible
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleGroup?.(groupIndex);
                    }
                  }
                : undefined
            }
          >
            {collapsible ? (
              <button
                className="section-toggle"
                aria-expanded={!collapsed}
                tabIndex={-1}
                title={collapsed ? 'Show the line items' : 'Collapse to the section total'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleGroup?.(groupIndex);
                }}
              >
                <span className="section-caret" aria-hidden="true">
                  {collapsed ? '▸' : '▾'}
                </span>
                {group.label}
                {empty && <span className="section-no-activity">no activity</span>}
                <SectionQuestions count={questions} />
                <SectionMismatches count={mismatches} />
              </button>
            ) : (
              <>
                {group.label}
                {empty && <span className="section-no-activity">no activity</span>}
                <SectionQuestions count={questions} />
                <SectionMismatches count={mismatches} />
              </>
            )}
          </td>
          {/* Collapsed, the band itself carries the section's numbers. */}
          {collapsed
            ? dayLabels.map((_dl, d) => {
                const v = groupValue(categories, values, group.idxs, d);
                return (
                  <td
                    key={d}
                    className="cell subtotal-cell"
                    style={fill(v, bandScale(scales.byGroup, groupIndex))}
                  >
                    {fmt(v)}
                  </td>
                );
              })
            : Array.from({ length: numDays }).map((_, i) => <td key={i} />)}
          {collapsed ? (
            (() => {
              const t = groupTotal(categories, values, group.idxs, numDays);
              return (
                <td
                  className="cell row-total-cell"
                  style={{ fontWeight: 600, ...(fill(t, totalScale) ?? {}) }}
                >
                  {t.toLocaleString()}
                </td>
              );
            })()
          ) : (
            <td />
          )}
        </tr>
      )}
      {!collapsed &&
        group.idxs.map((catIdx) => {
          const isSubtotal = categories[catIdx].subtotal === true;
          return (
            <tr key={catIdx} className={band + (isSubtotal ? ' subtotal-row' : '')}>
              <td className={`row-label ${isSubtotal ? 'subtotal' : 'indent'}`}>
                {categories[catIdx].label}
              </td>
              {dayLabels.map((_dl, d) => (
                <EditableCell
                  key={d}
                  catIdx={catIdx}
                  dayIdx={d}
                  props={props}
                  scale={bandScale(scales.byCat, catIdx)}
                />
              ))}
              {(() => {
                const rowTotal = isSubtotal
                  ? subtotalTotal(categories, values, catIdx, numDays)
                  : catTotal(values, catIdx, numDays);
                return (
                  <td
                    className="cell row-total-cell"
                    style={{ fontWeight: 600, ...(fill(rowTotal, totalScale) ?? {}) }}
                  >
                    {rowTotal.toLocaleString()}
                  </td>
                );
              })()}
            </tr>
          );
        })}
    </>
  );
}

// ---------------------------------------------------------------------------
// grouped: rows = days, columns = categories (standard workbook layout)
// ---------------------------------------------------------------------------
function GroupedGrid(props: ForecastGridProps & { scales: GridScales }) {
  const {
    categories,
    dayLabels,
    values,
    startingBalance,
    dayComments,
    editable,
    onChangeDayComment,
    showColumnTotals,
    collapsedGroups,
    onToggleGroup,
    requested,
    mismatched,
    scales,
  } = props;
  const numDays = dayLabels.length;
  const numCats = categories.length;
  const groups = categoryGroups(categories);
  // A running balance only means something once an opening balance is given,
  // so the whole column appears and disappears with it.
  const hasBalance = startingBalance !== null;
  // The per-day Comments column renders only where the screen passes the
  // day-comment store in — the submission grid no longer does.
  const showComments = dayComments !== undefined;
  /** Net cash flow across the whole horizon — the figure both total rows end on. */
  const horizonNet = Array.from({ length: numDays }, (_v, d) =>
    dayNet(numCats, values, d),
  ).reduce((a, b) => a + b, 0);
  // With sections across the columns, collapsing one replaces its columns with
  // a single total column — so the body renders this list, not `categories`.
  const isCollapsed = (gi: number) =>
    Boolean(groups[gi].label) && Boolean(onToggleGroup) && (collapsedGroups?.has(gi) ?? false);
  const columns = useMemo(() => {
    const out: { gi: number; catIdx: number | null; band: string; end: boolean }[] = [];
    groups.forEach((g, gi) => {
      const band = gi % 2 === 0 ? ' band-a' : ' band-b';
      if (isCollapsed(gi)) {
        out.push({ gi, catIdx: null, band, end: true });
        return;
      }
      g.idxs.forEach((catIdx, i) =>
        out.push({ gi, catIdx, band, end: i === g.idxs.length - 1 }),
      );
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, collapsedGroups, onToggleGroup]);

  return (
    <table className="forecast-grid" data-rows="days">
      {/* Two separate header strips: the section bands float in their own box
          above, and every column label sits together in the box below — so
          "which section" and "which line item" never blur into one row. */}
      <thead>
        <tr className="band-row">
          <th className="row-label-h band-spacer" aria-hidden="true" />
          {groups.map((g, gi) =>
            g.label ? (
              // The whole band is the toggle, so a section can always be
              // reopened AND reclosed by clicking its name — not only the
              // caret, which is easy to miss on a wide expanded section.
              <th
                key={gi}
                colSpan={isCollapsed(gi) ? 1 : g.idxs.length}
                className={`day-h section-band${gi % 2 === 0 ? ' band-a' : ' band-b'}${
                  onToggleGroup ? ' band-toggle' : ''
                }${questionsInGroup(g.idxs, requested) > 0 ? ' section-questioned' : ''}${
                  mismatchesInGroup(g.idxs, mismatched) > 0 ? ' section-mismatched' : ''
                }`}
                onClick={onToggleGroup ? () => onToggleGroup(gi) : undefined}
                role={onToggleGroup ? 'button' : undefined}
                tabIndex={onToggleGroup ? 0 : undefined}
                aria-expanded={onToggleGroup ? !isCollapsed(gi) : undefined}
                title={
                  onToggleGroup
                    ? isCollapsed(gi)
                      ? 'Show the line items'
                      : 'Collapse to the section total'
                    : undefined
                }
                onKeyDown={
                  onToggleGroup
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onToggleGroup(gi);
                        }
                      }
                    : undefined
                }
              >
                {onToggleGroup ? (
                  <span className="section-toggle">
                    <span className="section-caret" aria-hidden="true">
                      {isCollapsed(gi) ? '▸' : '▾'}
                    </span>
                    {g.label}
                    {hasAnyValue(values) && groupIsEmpty(categories, values, g.idxs, numDays) && (
                      <span className="section-no-activity">no activity</span>
                    )}
                    <SectionQuestions count={questionsInGroup(g.idxs, requested)} />
                    <SectionMismatches count={mismatchesInGroup(g.idxs, mismatched)} />
                  </span>
                ) : (
                  <>
                    {g.label}
                    {hasAnyValue(values) && groupIsEmpty(categories, values, g.idxs, numDays) && (
                      <span className="section-no-activity">no activity</span>
                    )}
                    <SectionQuestions count={questionsInGroup(g.idxs, requested)} />
                    <SectionMismatches count={mismatchesInGroup(g.idxs, mismatched)} />
                  </>
                )}
              </th>
            ) : (
              <th key={`u${gi}`} colSpan={g.idxs.length} className="band-spacer" aria-hidden="true" />
            ),
          )}
          {showComments && <th className="band-spacer" aria-hidden="true" />}
          <th className="band-spacer" aria-hidden="true" />
          {hasBalance && <th className="band-spacer" aria-hidden="true" />}
        </tr>
        <tr className="label-row">
          <th className="row-label-h">Date</th>
          {columns.map((col) =>
            // A collapsed section's single column header reopens it, so the
            // way back is never further than the thing you are looking at.
            col.catIdx === null ? (
              <th
                key={`g${col.gi}`}
                className={`day-h group-end${col.band}${onToggleGroup ? ' band-toggle' : ''}${
                  questionsInGroup(groups[col.gi].idxs, requested) > 0 ? ' section-questioned' : ''
                }${
                  mismatchesInGroup(groups[col.gi].idxs, mismatched) > 0 ? ' section-mismatched' : ''
                }`}
                onClick={onToggleGroup ? () => onToggleGroup(col.gi) : undefined}
                role={onToggleGroup ? 'button' : undefined}
                tabIndex={onToggleGroup ? 0 : undefined}
                title="Show the line items"
                onKeyDown={
                  onToggleGroup
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onToggleGroup(col.gi);
                        }
                      }
                    : undefined
                }
              >
                {/* The count sits on the section band above this header, so
                    repeating it here would say the same thing twice in two
                    adjacent rows. The blue edge is enough. */}
                Section total
              </th>
            ) : (
              <th
                key={col.catIdx}
                className={`day-h${col.end ? ' group-end' : ''}${col.band}`}
              >
                {categories[col.catIdx].label}
              </th>
            ),
          )}
          {showComments && (
            <th className="day-h" style={{ minWidth: 160 }}>
              Comments
            </th>
          )}
          <th className="day-h total-h">Total</th>
          {hasBalance && <th className="day-h total-h">Running Total</th>}
        </tr>
      </thead>
      <tbody>
        {hasBalance && (
          <tr className="section-row">
            <td className="row-label">Starting Balance</td>
            {/* One filler per visible column (plus Comments where shown) —
                collapsing a section changes how many that is. */}
            {Array.from({ length: columns.length + (showComments ? 1 : 0) }).map((_, i) => (
              <td key={i} />
            ))}
            <td className="cell total-cell">{startingBalance.toLocaleString()}</td>
            <td className="cell total-cell">{startingBalance.toLocaleString()}</td>
          </tr>
        )}
        {dayLabels.map((dl, dayIdx) => (
          <tr key={dayIdx}>
            <td className="row-label">
              {dl.dow} · {dl.dm}
            </td>
            {columns.map((col) =>
              col.catIdx === null ? (
                (() => {
                  const v = groupValue(categories, values, groups[col.gi].idxs, dayIdx);
                  return (
                    <td
                      key={`g${col.gi}`}
                      className={`cell subtotal-cell group-end${col.band}`}
                      style={fill(v, bandScale(scales.byGroup, col.gi))}
                    >
                      {fmt(v)}
                    </td>
                  );
                })()
              ) : (
                <EditableCell
                  key={col.catIdx}
                  catIdx={col.catIdx}
                  dayIdx={dayIdx}
                  props={props}
                  scale={bandScale(scales.byCat, col.catIdx)}
                  extraClass={`${col.end ? 'group-end' : ''}${col.band}`}
                />
              ),
            )}
            {showComments && (
              <td className="cell comment-cell">
                {editable ? (
                  <input
                    type="text"
                    className="comment-input"
                    value={dayComments?.[String(dayIdx)] ?? ''}
                    placeholder=""
                    onChange={(e) => onChangeDayComment?.(dayIdx, e.target.value)}
                  />
                ) : (
                  <span style={{ padding: '0 8px' }}>{dayComments?.[String(dayIdx)] ?? ''}</span>
                )}
              </td>
            )}
            {(() => {
              const net = dayNet(numCats, values, dayIdx);
              return (
                <>
                  <td
                    className={`cell subtotal-cell${netClass(net)}`}
                    style={fill(net, scales.totals)}
                  >
                    {fmt(net)}
                  </td>
                  {hasBalance && (
                    <td
                      className="cell running-total-cell"
                      style={fill(runningBalance(numCats, values, startingBalance, dayIdx), scales.balances)}
                    >
                      {runningBalance(numCats, values, startingBalance, dayIdx).toLocaleString()}
                    </td>
                  )}
                </>
              );
            })()}
          </tr>
        ))}
        {showColumnTotals && (
          <tr className="column-totals-row">
            <td className="row-label total">Column Total</td>
            {columns.map((col) => (
              <td key={col.catIdx ?? `g${col.gi}`} className="cell total-cell">
                {fmt(
                  col.catIdx === null
                    ? groupTotal(categories, values, groups[col.gi].idxs, numDays)
                    : categories[col.catIdx].subtotal
                      ? subtotalTotal(categories, values, col.catIdx, numDays)
                      : catTotal(values, col.catIdx, numDays),
                )}
              </td>
            ))}
            {showComments && <td className="cell total-cell" />}
            <td className={`cell total-cell${netClass(horizonNet)}`}>
              {horizonNet.toLocaleString()}
            </td>
            {hasBalance && (
              <td className="cell total-cell">
                {runningBalance(numCats, values, startingBalance, numDays - 1).toLocaleString()}
              </td>
            )}
          </tr>
        )}
        <tr>
          <td className="row-label total">TOTAL</td>
          {/* Per visible column, so the row stays aligned when a section is
              collapsed down to its single total column. */}
          {columns.map((col) => (
            <td key={col.catIdx ?? `g${col.gi}`} className="cell total-cell">
              {fmt(
                col.catIdx === null
                  ? groupTotal(categories, values, groups[col.gi].idxs, numDays)
                  : categories[col.catIdx].subtotal
                    ? subtotalTotal(categories, values, col.catIdx, numDays)
                    : catTotal(values, col.catIdx, numDays),
              )}
            </td>
          ))}
          {showComments && <td className="cell total-cell" />}
          <td className={`cell total-cell${netClass(horizonNet)}`}>
            {horizonNet.toLocaleString()}
          </td>
          {hasBalance && (
            <td className="cell total-cell">
              {runningBalance(numCats, values, startingBalance, numDays - 1).toLocaleString()}
            </td>
          )}
        </tr>
      </tbody>
    </table>
  );
}
