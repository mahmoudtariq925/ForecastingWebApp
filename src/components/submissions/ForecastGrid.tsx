import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { TemplateLayout } from '../../types';
import { sectionIsIntercompany, type EntityOption, type GridCategory } from '../../data/customRows';
import { weekBandsOf, type DayLabel } from '../../data/periods';
import {
  catTotal,
  catValue,
  categoryGroups,
  type CategoryGroup,
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
  /**
   * Every line the grid shows: the template's, plus the rows the submitter
   * added under its sections. A custom row is a row like any other — see
   * `gridCategories`.
   */
  categories: GridCategory[];
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
   * Add a row to a section. Given, every section header carries a `+` — the
   * one gesture that makes a forecast the submitter's own rather than the
   * template's.
   */
  onAddRow?: (section: string, parent?: string) => void;
  /** Rename one of those rows (free-text sections only). */
  onRenameRow?: (rowId: string, label: string) => void;
  /** Point one at a legal entity (intercompany sections). */
  onSetRowEntity?: (rowId: string, entity: string) => void;
  /** Remove one, and its figures with it. */
  onRemoveRow?: (rowId: string) => void;
  /** The legal entities an intercompany row may name, ISO code first. */
  entityOptions?: EntityOption[];
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
  onChangeDayComment?: (dayIdx: number, comment: string) => void;
  /**
   * Conditional formatting, and what each cell is shaded AGAINST.
   *
   * `row` (the default) scales every line item against itself — the colour
   * then answers "is this a big week for receivables?". `grid` puts every
   * data cell on one scale, which answers "where is the money in this
   * forecast at all?" and washes the smaller lines out entirely. `off` is
   * neither: a plain grid of numbers, for anyone who reads the figures and
   * finds the colour in the way. All three are legitimate, so the forecast
   * screen offers the choice rather than deciding for everyone.
   */
  heatmapMode?: 'row' | 'grid' | 'off';
  /**
   * Draw the horizon's WEEKS over its dates: a band per week, a rule where
   * one week ends, and the last working day of each shaded.
   *
   * Twenty date columns in a row give the eye nothing to count by, and a
   * forecast is discussed a week at a time ("what does week 3 look like"). The
   * grid that a template is AUTHORED in has no weeks to show — a template is
   * a shape, not a horizon — so this is the forecast screen's alone.
   */
  weekBands?: boolean;
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
  /** Line-item cells, indexed by category. */
  byCat: HeatScale[];
  /** The trailing Total column, for the lines that are typed into. */
  totals: HeatScale;
}

/** Recompute the colour extremes from the cells currently on screen. */
function useGridScales(props: ForecastGridProps): GridScales {
  const { categories, values, dayLabels, heatmapMode = 'row' } = props;
  const heatmap = heatmapMode !== 'off';
  const heatmapScope = heatmapMode;
  const numDays = dayLabels.length;
  const numCats = categories.length;

  // One band per line item — or, when the whole grid is one scale, the same
  // band repeated so every cell is measured against the forecast's extremes.
  //
  // A row the SUBMITTER added takes no band at all. Those rows are what an
  // expanded section is made of, and they are read as a breakdown — "which of
  // these adds up to the section total" — where a second colour scale running
  // underneath the first says nothing the numbers do not, and turns an opened
  // section into a block of colour. The section's own figures keep theirs.
  const catScales = useHeatScales(() => {
    if (!heatmap) return [];
    const rows = Array.from({ length: numCats }, (_v, c) =>
      // Neither a subtotal (computed, never shaded) nor a row the submitter
      // added (read as a breakdown of the section above it) takes a band.
      categories[c]?.customRowId !== undefined || categories[c]?.subtotal
        ? []
        : Array.from({ length: numDays }, (_x, d) => catValue(values, c, d)),
    );
    if (heatmapScope === 'row') return rows;
    const all = rows.flat();
    return rows.map((band) => (band.length === 0 ? [] : all));
  }, [heatmap, heatmapScope, categories, values, numDays, numCats]);

  // The trailing Total column, over the lines that carry one — a subtotal's
  // total is a subtotal, so it is neither shaded nor part of the scale.
  const totalScale = useHeatScale(() => {
    if (!heatmap) return [];
    const out: number[] = [];
    for (let c = 0; c < numCats; c++) {
      if (categories[c]?.subtotal) continue;
      out.push(catTotal(values, c, numDays));
    }
    return out;
  }, [heatmap, categories, values, numDays, numCats]);

  return useMemo(
    () =>
      heatmap
        ? { byCat: catScales, totals: totalScale }
        : { byCat: [], totals: NEUTRAL_SCALE },
    [heatmap, catScales, totalScale],
  );
}

/** The scale a band uses, falling back to neutral (no tint) when absent. */
const bandScale = (scales: HeatScale[], index: number): HeatScale =>
  scales[index] ?? NEUTRAL_SCALE;

/**
 * How many of a section's cells are in a marked set.
 *
 * Collapsing a section hides the marked cells in it, and with them the only
 * sign that someone is waiting on an answer — so the section band says it.
 */
function cellsInGroup(idxs: number[], marked: Set<string> | undefined): number {
  if (!marked || marked.size === 0) return 0;
  const inGroup = new Set(idxs);
  let count = 0;
  for (const key of marked) {
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

/** Whether the reader may add rows to this forecast at all. */
function canAddRows(props: ForecastGridProps): boolean {
  return Boolean(props.onAddRow) && props.editable;
}

/**
 * Whether a SECTION header carries the `+` itself.
 *
 * Normally it does not: a row breaks down a LINE, so the `+` belongs on the
 * line — under Receivables for a customer, under Payables for a supplier, and
 * a section holding both cannot answer "which of these is this row part of?"
 * from one button at the top. A section with no lines of its own is the
 * exception; without this it would be the one place a row could never be
 * added.
 */
function sectionTakesAddButton(
  props: ForecastGridProps,
  group: CategoryGroup,
): boolean {
  if (!canAddRows(props) || !group.label) return false;
  return !group.idxs.some(
    (i) => !props.categories[i]?.subtotal && props.categories[i]?.customRowId === undefined,
  );
}

/** The `+` that makes a line — or a section with none — a place rows go. */
function AddRowButton({
  section,
  parent,
  intercompany,
  onAddRow,
}: {
  section: string;
  /** The line the row will break down; omitted for a section-level `+`. */
  parent?: string;
  intercompany: boolean;
  onAddRow: (section: string, parent?: string) => void;
}) {
  const under = parent ?? section;
  return (
    <button
      type="button"
      className="section-add-row"
      title={
        intercompany
          ? `Add a counterparty under ${under} — rows here name a group company`
          : `Add a row under ${under} — name it whatever this line is made of`
      }
      aria-label={`Add a row under ${under}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onAddRow(section, parent);
      }}
    >
      +
    </button>
  );
}

/**
 * The name of one line.
 *
 * A template line is a label. A row the SUBMITTER added is a small editor:
 * free text where the section is theirs to describe, and a legal-entity
 * dropdown where it is intercompany — free text there would be an amount that
 * can never reach the entity it names, so the picker is the only way in. A
 * MIRRORED row is neither: it is another entity's statement, shown with where
 * it came from and nothing to edit.
 */
function RowName({ catIdx, props }: { catIdx: number; props: ForecastGridProps }) {
  const { categories, editable, entityOptions = [], onRenameRow, onSetRowEntity, onRemoveRow } =
    props;
  const cat = categories[catIdx];
  const rowId = cat?.customRowId;
  if (rowId === undefined) return <>{cat?.label}</>;

  const mirrored = cat.source !== undefined;
  const canEdit = editable && !mirrored;
  const options = cat.entityName && !entityOptions.some((o) => o.name === cat.entityName)
    ? [...entityOptions, { name: cat.entityName, code: cat.label, country: '' }]
    : entityOptions;

  return (
    <span className="custom-row-name">
      <span className="custom-row-mark" aria-hidden="true">
        ↳
      </span>
      {canEdit && cat.intercompany === true && onSetRowEntity ? (
        <select
          className="row-entity-select"
          data-row-id={rowId}
          value={cat.entityName ?? ''}
          aria-label="Counterparty legal entity"
          title={cat.entityName ?? 'Pick the legal entity this row is about'}
          onChange={(e) => onSetRowEntity(rowId, e.target.value)}
        >
          <option value="">Entity…</option>
          {options.map((o) => (
            <option key={o.name} value={o.name}>
              {o.code} · {o.name}
            </option>
          ))}
        </select>
      ) : canEdit && onRenameRow ? (
        <input
          className="row-name-input"
          data-row-id={rowId}
          value={cat.customLabel ?? ''}
          placeholder="Name this row…"
          aria-label="Row name"
          onChange={(e) => onRenameRow(rowId, e.target.value)}
        />
      ) : (
        <span className="row-name-static" title={cat.entityName ?? cat.label}>
          {cat.label}
        </span>
      )}
      {mirrored && (
        <span
          className={`row-source-tag${cat.late ? ' late' : ''}`}
          title={
            cat.late
              ? `Mirrored from ${cat.source} — it arrived after this forecast was submitted`
              : `Mirrored from ${cat.source}'s forecast — they enter it, you read it`
          }
        >
          from {cat.source}
          {cat.late ? ' · late' : ''}
        </span>
      )}
      {canEdit && onRemoveRow && (
        <button
          type="button"
          className="row-remove"
          title="Remove this row and its figures"
          aria-label={`Remove row ${cat.label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onRemoveRow(rowId)}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** Inline background for a numeric cell, or undefined to leave it plain. */
function fill(value: number, scale: HeatScale): { background: string } | undefined {
  const background = heatColor(value, scale);
  return background ? { background } : undefined;
}

/**
 * The extra classes a date column carries: the last working day of a week,
 * and the week's closing edge.
 *
 * Friday is where a treasury week is read from — it is the day balances are
 * struck against — and after twenty identical columns the eye needs somewhere
 * to stop. Shading it does both jobs at once: it marks the day AND divides
 * the weeks, without a rule heavy enough to cut the row in half.
 */
function dayColumnClass(
  labels: DayLabel[],
  bands: { from: number; span: number }[],
): (dayIdx: number) => string {
  const edges = new Set(bands.map((b) => b.from + b.span - 1));
  // The last column of the horizon closes nothing — the grid's own edge is
  // already there.
  edges.delete(labels.length - 1);
  return (dayIdx: number) => {
    const friday = labels[dayIdx]?.dow === 'Fri';
    return `${friday ? ' day-friday' : ''}${edges.has(dayIdx) ? ' week-edge' : ''}`;
  };
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

  // Computed subtotal rows are never editable — the app derives them — and
  // never shaded. Conditional formatting says "this figure stands out among
  // the ones like it"; a subtotal is not one of the figures, it is what they
  // add up to, and colouring it puts the loudest cell of a section on the one
  // line nobody typed.
  if (categories[catIdx]?.subtotal) {
    const sub = subtotalValue(categories, values, catIdx, dayIdx);
    return (
      <td className={`cell subtotal-cell ${extraClass}${focus}`.trim()}>{fmt(sub)}</td>
    );
  }

  const val = catValue(values, catIdx, dayIdx);
  const cat = categories[catIdx];
  /**
   * A row mirrored in from another entity's forecast is that entity's
   * statement, not this one's: it is read here and edited there. Both sides
   * then hold the same figure by construction, which is the whole reason the
   * group position nets to zero.
   */
  const mirrored = cat?.source !== undefined;
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
  // `cell-input` marks the cells a value can be typed into — the only ones
  // that lift under the pointer (see the raise-on-hover rule in the CSS).
  const typeable = editable && !toAnswer && !mirrored;
  const cls = `cell ${flagged ? 'variance-flag' : ''} ${asked ? 'comment-requested' : ''} ${
    replied ? 'comment-answered' : ''
  } ${cat?.customRowId !== undefined ? 'cell-custom' : ''} ${
    mirrored ? 'cell-mirrored' : ''
  } ${clickable ? 'cell-askable' : ''} ${typeable ? 'cell-input' : ''} ${extraClass}${focus}`
    .replace(/\s+/g, ' ')
    .trim();
  // A variance flag keeps its amber background — it outranks the heatmap.
  const style = flagged ? undefined : fill(val, scale);
  const open = () => onCellClick?.(catIdx, dayIdx);

  // A read-only grid has nothing else a click could mean, so the whole cell
  // opens the dialog — and so does a cell waiting on an answer, where the
  // dialog is the whole job. Both carry the cell coordinates an editable one
  // does, so a deep link ("explain THIS cell") still finds and scrolls to it,
  // and Enter opens the one the keyboard has landed on.
  if (!typeable) {
    return (
      <td
        className={cls}
        style={style}
        data-cat={catIdx}
        data-day={dayIdx}
        onClick={clickable ? open : undefined}
        role={toAnswer ? 'button' : undefined}
        tabIndex={toAnswer ? 0 : undefined}
        title={
          toAnswer
            ? editable
              ? 'Open the question on this cell and answer it'
              : 'Open the question on this cell'
            : mirrored
              ? `Mirrored from ${cat?.source}'s forecast — they enter this figure, you read it`
              : undefined
        }
        onKeyDown={
          toAnswer
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open();
                  return;
                }
                moveWithKeyboard(e);
              }
            : undefined
        }
      >
        {fmt(val)}
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
          aria-label={`Comment on ${categories[catIdx]?.label ?? 'this cell'}, period ${dayIdx + 1}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
        >
          ?
        </button>
      )}
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
          // Escape abandons an edit IN PROGRESS. With no draft there is no
          // edit to abandon, and `committedBefore` is then stale — it is only
          // refreshed when typing starts, so anything that changed the value
          // by another route (a paste, an undo, a figure corrected in the
          // dialog) left it holding a figure from before that change.
          // Restoring it regardless is how pressing Escape after pasting a
          // block put the pre-paste number back into the cell the paste
          // started from, silently corrupting one corner of the block.
          if (draft === null) return;
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
  const bands = props.weekBands ? weekBandsOf(dayLabels) : [];
  const columnClass = dayColumnClass(dayLabels, bands);

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
        {/* The weeks, over the dates they cover — the unit a forecast is
            actually discussed in. Drawn as separate boxes, exactly like the
            section bands in the other orientation. */}
        {bands.length > 1 && (
          <tr className="band-row">
            <th className="row-label-h band-spacer" aria-hidden="true" />
            {bands.map((band) => (
              <th
                key={band.from}
                colSpan={band.span}
                className="day-h week-band"
                title={`ISO week ${band.isoWeek} · ${band.range}`}
              >
                {band.label}
                <span className="week-band-range">{band.range}</span>
              </th>
            ))}
            <th className="band-spacer" aria-hidden="true" />
          </tr>
        )}
        <tr className="label-row">
          <th className="row-label-h">Cash Flow Category</th>
          {/* The date IS the column's name. A "D1…Dn" index above it added a
              line of text to every header for something no one refers to — a
              forecast is discussed as "Friday the 14th", never as "D5". */}
          {dayLabels.map((dl, i) => (
            <th key={i} className={`day-h${columnClass(i)}`}>
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
              <td key={d} className={`cell total-cell${columnClass(d)}`}>
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
        {dayComments !== undefined && (
          <tr>
            <td className="row-label">Comments</td>
            {dayLabels.map((_dl, d) => (
              <td key={d} className={`cell comment-cell${columnClass(d)}`}>
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
      {/* WHAT THE FORECAST ADDS UP TO, in its own block.
          These four are a different kind of row from everything above them —
          nothing here is typed into, and all of it is derived. Sitting in the
          same body as the input rows they read as four more lines of the
          forecast, and the eye had to find where the entering stopped and the
          arithmetic began. A `tfoot` puts them under their own rule, on their
          own ground, and pins them to the foot of the scrolling grid so the
          bottom line is readable without scrolling to it. */}
      <tfoot className="forecast-totals">
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
                    className={`cell ${row.kind}-cell${row.signed ? netClass(v) : ''}${columnClass(d)}`}
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
      </tfoot>
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
    onAddRow,
  } = props;
  const numDays = dayLabels.length;
  const totalScale = scales.totals;
  const columnClass = dayColumnClass(
    dayLabels,
    props.weekBands ? weekBandsOf(dayLabels) : [],
  );
  // Rows added under an intercompany section name a legal entity; everywhere
  // else the submitter names them.
  const intercompany = sectionIsIntercompany(categories, group.idxs);

  // Only a named section can collapse — loose line items have nothing to
  // collapse into.
  const collapsible = Boolean(group.label) && Boolean(onToggleGroup);
  const collapsed = collapsible && (collapsedGroups?.has(groupIndex) ?? false);
  const questions = cellsInGroup(group.idxs, requested);
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
  /**
   * A line that belongs to no section — CAPEX and Other on the standard
   * template.
   *
   * It took the same tint and the same indent as the lines INSIDE a section,
   * so expanding a section ran its contents straight on into the loose lines
   * underneath with nothing to say where one ended and the other began. It
   * gets its own ground and sits at the label column's left edge, where a
   * line that is nobody's child belongs.
   */
  const loose = !group.label;

  return (
    <>
      {group.label && (
        <tr
          className={`section-row${band}${collapsed ? ' section-collapsed' : ''}${
            questions > 0 ? ' section-questioned' : ''
          }${empty ? ' section-empty' : ''}`}
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
                {intercompany && (
                  <span className="section-tag" title="Rows in this section are legal entities">
                    IC
                  </span>
                )}
                {empty && <span className="section-no-activity">no activity</span>}
                <SectionQuestions count={questions} />
              </button>
            ) : (
              <>
                {group.label}
                {intercompany && (
                  <span className="section-tag" title="Rows in this section are legal entities">
                    IC
                  </span>
                )}
                {empty && <span className="section-no-activity">no activity</span>}
                <SectionQuestions count={questions} />
              </>
            )}
            {sectionTakesAddButton(props, group) && group.label && (
              <AddRowButton
                section={group.label}
                intercompany={intercompany}
                onAddRow={(section, parent) => {
                  // Adding to a folded section would put the new row out of
                  // sight, so the section opens with it.
                  if (collapsed) onToggleGroup?.(groupIndex);
                  onAddRow?.(section, parent);
                }}
              />
            )}
          </td>
          {/* The band carries the section's numbers whether it is open or
              shut. Collapsed they ARE the section; open they are what its
              lines add up to, which is the figure a reader checks a line
              against — and having to collapse the section to see it meant
              never seeing the two together. Open, they are drawn back so the
              lines below stay the thing being read. */}
          {dayLabels.map((_dl, d) => {
            const v = groupValue(categories, values, group.idxs, d);
            return (
              <td
                key={d}
                className={`cell subtotal-cell${
                  collapsed ? '' : ' section-open-total'
                }${columnClass(d)}`}
              >
                {fmt(v)}
              </td>
            );
          })}
          {(() => {
            const t = groupTotal(categories, values, group.idxs, numDays);
            return (
              <td
                className={`cell row-total-cell${collapsed ? '' : ' section-open-total'}`}
                style={collapsed ? { fontWeight: 600 } : undefined}
              >
                {t.toLocaleString()}
              </td>
            );
          })()}
        </tr>
      )}
      {!collapsed &&
        group.idxs.map((catIdx, position) => {
          const isSubtotal = categories[catIdx].subtotal === true;
          const custom = categories[catIdx].customRowId !== undefined;
          // The section's own rows end where its computed total begins, and
          // that is where "add a row" belongs — under the rows it will join,
          // above the figure it will change.
          const next = categories[group.idxs[position + 1]];
          const parentLabel = custom
            ? categories[catIdx].parentLabel
            : categories[catIdx].label;
          /**
           * The last line of one line's block: this row is a row somebody
           * added, and nothing under the same line follows it. That is where
           * "add another" belongs — under the rows it will join.
           */
          const endOfBlock =
            custom &&
            parentLabel !== undefined &&
            (next === undefined ||
              next.customRowId === undefined ||
              next.parentLabel !== parentLabel);
          return (
            <Fragment key={catIdx}>
            <tr
              className={
                (loose ? ' group-loose' : band) +
                (isSubtotal ? ' subtotal-row' : '') +
                (custom ? ' custom-row' : '')
              }
            >
              <td
                className={`row-label ${
                  isSubtotal ? 'subtotal' : loose ? 'standalone' : 'indent'
                }${custom ? ' row-label-custom' : ''}`}
              >
                <RowName catIdx={catIdx} props={props} />
                {/* A row breaks down a LINE, so the `+` sits on the line —
                    one under Receivables, another under Payables, and each
                    adds to its own. */}
                {!isSubtotal && !custom && canAddRows(props) && (
                  <AddRowButton
                    section={group.label ?? ''}
                    parent={categories[catIdx].label}
                    intercompany={categories[catIdx].intercompany === true}
                    onAddRow={(section, parent) => onAddRow?.(section, parent)}
                  />
                )}
              </td>
              {dayLabels.map((_dl, d) => (
                <EditableCell
                  key={d}
                  catIdx={catIdx}
                  dayIdx={d}
                  props={props}
                  scale={bandScale(scales.byCat, catIdx)}
                  extraClass={columnClass(d).trim()}
                />
              ))}
              {(() => {
                const rowTotal = isSubtotal
                  ? subtotalTotal(categories, values, catIdx, numDays)
                  : catTotal(values, catIdx, numDays);
                return (
                  <td
                    className="cell row-total-cell"
                    style={{
                      fontWeight: 600,
                      ...(isSubtotal ? {} : (fill(rowTotal, totalScale) ?? {})),
                    }}
                  >
                    {rowTotal.toLocaleString()}
                  </td>
                );
              })()}
            </tr>
            {/* Only under a line that already HAS rows: an invitation under
                every line of the template would be as many of them as there
                are lines, and the `+` on the line is the way in. */}
            {endOfBlock && canAddRows(props) && (
              <AddRowLine
                section={group.label ?? ''}
                parent={parentLabel}
                intercompany={categories[catIdx].intercompany === true}
                columns={numDays + 1}
                band={band}
                onAddRow={onAddRow}
              />
            )}
            </Fragment>
          );
        })}
      {/* A section with no lines of its own still has to be fillable. */}
      {!collapsed && sectionTakesAddButton(props, group) && group.label && (
        <AddRowLine
          section={group.label}
          intercompany={intercompany}
          columns={numDays + 1}
          band={band}
          onAddRow={onAddRow}
        />
      )}
    </>
  );
}

/** The "add a row" line that closes an expanded section. */
function AddRowLine({
  section,
  parent,
  intercompany,
  columns,
  band,
  onAddRow,
}: {
  section: string;
  /** The line these rows break down; omitted for a section with no lines. */
  parent?: string;
  intercompany: boolean;
  columns: number;
  band: string;
  onAddRow?: (section: string, parent?: string) => void;
}) {
  return (
    <tr className={`add-row-line${band}`}>
      <td className="row-label indent">
        <button
          type="button"
          className="add-row-btn"
          onClick={() => onAddRow?.(section, parent)}
          title={
            intercompany
              ? `Add a counterparty under ${parent ?? section} — the amount lands in their forecast too`
              : `Add another row under ${parent ?? section}`
          }
        >
          + {intercompany ? 'Add counterparty' : 'Add row'}
        </button>
      </td>
      <td colSpan={columns} />
    </tr>
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
    onAddRow,
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
  // Where each week starts, so a run of day rows can be given its own line —
  // and never on the first row, where the header is already the divider.
  const bandStart = useMemo(() => {
    const out = new Map<number, { label: string; range: string }>();
    if (!props.weekBands) return out;
    for (const band of weekBandsOf(dayLabels)) {
      if (band.from === 0) continue;
      out.set(band.from, { label: band.label, range: band.range });
    }
    return out;
  }, [props.weekBands, dayLabels]);
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
  /** Every column right of the date label — what a full-width row spans. */
  const bodyColumns = columns.length + (showComments ? 1 : 0) + 1 + (hasBalance ? 1 : 0);

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
                }${cellsInGroup(g.idxs, requested) > 0 ? ' section-questioned' : ''}`}
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
                    <SectionQuestions count={cellsInGroup(g.idxs, requested)} />
                  </span>
                ) : (
                  <>
                    {g.label}
                    {hasAnyValue(values) && groupIsEmpty(categories, values, g.idxs, numDays) && (
                      <span className="section-no-activity">no activity</span>
                    )}
                    <SectionQuestions count={cellsInGroup(g.idxs, requested)} />
                  </>
                )}
                {sectionTakesAddButton(props, g) && (
                  <AddRowButton
                    section={g.label}
                    intercompany={sectionIsIntercompany(categories, g.idxs)}
                    onAddRow={(section, parent) => {
                      if (isCollapsed(gi)) onToggleGroup?.(gi);
                      onAddRow?.(section, parent);
                    }}
                  />
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
                  cellsInGroup(groups[col.gi].idxs, requested) > 0 ? ' section-questioned' : ''
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
                className={`day-h${col.end ? ' group-end' : ''}${col.band}${
                  categories[col.catIdx].customRowId !== undefined ? ' day-h-custom' : ''
                }`}
              >
                <RowName catIdx={col.catIdx} props={props} />
                {categories[col.catIdx].customRowId === undefined &&
                  categories[col.catIdx].subtotal !== true &&
                  canAddRows(props) && (
                    <AddRowButton
                      section={groups[col.gi].label ?? ''}
                      parent={categories[col.catIdx].label}
                      intercompany={categories[col.catIdx].intercompany === true}
                      onAddRow={(section, parent) => onAddRow?.(section, parent)}
                    />
                  )}
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
          <Fragment key={dayIdx}>
          {/* With the dates down the rows, a week is a run of rows — so it is
              announced by a line of its own rather than by a band overhead. */}
          {bandStart.get(dayIdx) && (
            <tr className="week-divider">
              <td className="row-label">
                {bandStart.get(dayIdx)?.label}
                <span className="week-band-range">{bandStart.get(dayIdx)?.range}</span>
              </td>
              <td colSpan={bodyColumns} />
            </tr>
          )}
          <tr className={dl.dow === 'Fri' ? 'row-friday' : undefined}>
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
                  <td className={`cell subtotal-cell${netClass(net)}`}>{fmt(net)}</td>
                  {hasBalance && (
                    <td className="cell running-total-cell">
                      {runningBalance(numCats, values, startingBalance, dayIdx).toLocaleString()}
                    </td>
                  )}
                </>
              );
            })()}
          </tr>
          </Fragment>
        ))}
      </tbody>
      {/* The horizon's arithmetic, under its own rule — see the note on the
          other orientation's `tfoot`. Dates run down the rows here, so what
          separates is the LAST rows rather than the last columns, but it is
          the same distinction: above, what was entered; below, what it comes
          to. */}
      <tfoot className="forecast-totals">
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
      </tfoot>
    </table>
  );
}
