import { useMemo, useState, type ClipboardEvent } from 'react';
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
  isPartialNumber,
  parseCellNumber,
  runningBalance,
  subtotalTotal,
  subtotalValue,
  type GridValues,
} from './gridMath';
import { heatColor, NEUTRAL_SCALE, useHeatScale, type HeatScale } from './heatmap';

const fmt = (v: number) => (v === 0 ? '—' : v.toLocaleString());

export interface ForecastGridProps {
  categories: TemplateCategory[];
  layout: TemplateLayout;
  dayLabels: DayLabel[];
  values: GridValues;
  flags: Set<string>;
  startingBalance: number;
  dayComments?: Record<string, string>;
  editable: boolean;
  onChangeCell?: (catIdx: number, dayIdx: number, value: number) => void;
  /** Paste starting at a cell; the editor maps rows/cols per layout. */
  onPaste?: (catIdx: number, dayIdx: number, e: ClipboardEvent<HTMLInputElement>) => void;
  onCellClick?: (catIdx: number, dayIdx: number) => void;
  onChangeDayComment?: (dayIdx: number, comment: string) => void;
  /** Diverging heatmap on the numeric cells (on by default). */
  heatmap?: boolean;
  /** Extra pinned row/column summing every line item per period. */
  showColumnTotals?: boolean;
}

/**
 * One scale per family of magnitudes. A single shared scale would be
 * useless here: horizon totals are ~20x a daily cell and running balances
 * bigger still, so one scale crushes every data cell to the minimum tint.
 * Each family is normalised against its own visible range, all sharing the
 * same fixed midpoint of 0.
 */
interface GridScales {
  /** Line-item and subtotal cells. */
  values: HeatScale;
  /** Trailing Total column / Net row. */
  totals: HeatScale;
  /** Running-total (closing balance) column. */
  balances: HeatScale;
}

/** Recompute the colour extremes from the cells currently on screen. */
function useGridScales(props: ForecastGridProps): GridScales {
  const { categories, values, startingBalance, dayLabels, heatmap = true } = props;
  const numDays = dayLabels.length;
  const numCats = categories.length;

  const valueScale = useHeatScale(() => {
    if (!heatmap) return [];
    const out: number[] = [];
    for (let c = 0; c < numCats; c++) {
      for (let d = 0; d < numDays; d++) {
        out.push(
          categories[c]?.subtotal
            ? subtotalValue(categories, values, c, d)
            : catValue(values, c, d),
        );
      }
    }
    return out;
  }, [heatmap, categories, values, numDays, numCats]);

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
    if (!heatmap) return [];
    const out: number[] = [];
    for (let d = 0; d < numDays; d++) {
      out.push(runningBalance(numCats, values, startingBalance, d));
    }
    return out;
  }, [heatmap, values, numCats, numDays, startingBalance]);

  return useMemo(
    () =>
      heatmap
        ? { values: valueScale, totals: totalScale, balances: balanceScale }
        : { values: NEUTRAL_SCALE, totals: NEUTRAL_SCALE, balances: NEUTRAL_SCALE },
    [heatmap, valueScale, totalScale, balanceScale],
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
  const { categories, values, flags, editable, onChangeCell, onPaste, onCellClick } = props;
  const key = cellKey(catIdx, dayIdx);
  const flagged = flags.has(key);

  // Computed subtotal rows are never editable — the app derives them.
  if (categories[catIdx]?.subtotal) {
    const sub = subtotalValue(categories, values, catIdx, dayIdx);
    return (
      <td className={`cell subtotal-cell ${extraClass}`.trim()} style={fill(sub, scale)}>
        {fmt(sub)}
      </td>
    );
  }

  const val = catValue(values, catIdx, dayIdx);
  const cls = `cell ${flagged ? 'variance-flag' : ''} ${extraClass}`.trim();
  // A variance flag keeps its amber background — it outranks the heatmap.
  const style = flagged ? undefined : fill(val, scale);

  if (!editable) {
    return (
      <td className={cls} style={style}>
        {fmt(val)}
      </td>
    );
  }
  return (
    <td className={cls} style={style} onClick={() => flagged && onCellClick?.(catIdx, dayIdx)}>
      <NumberCell
        value={val}
        catIdx={catIdx}
        dayIdx={dayIdx}
        onChange={(n) => onChangeCell?.(catIdx, dayIdx, n)}
        onPaste={(e) => onPaste?.(catIdx, dayIdx, e)}
      />
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
  onChange: (value: number) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
}) {
  // null = not being edited, so the cell shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      value={draft ?? (value === 0 ? '' : String(value))}
      data-cat={catIdx}
      data-day={dayIdx}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseCellNumber(raw);
        // Commit whatever parses; leave partial input ("-", "1.") on screen
        // as typed rather than replacing it with a half-finished number.
        if (parsed !== null) onChange(parsed);
        else if (!isPartialNumber(raw)) onChange(0);
      }}
      onBlur={() => {
        // Settle on the stored value: "1." shows as 1, junk clears to blank.
        if (draft !== null) onChange(parseCellNumber(draft) ?? 0);
        setDraft(null);
      }}
      onPaste={(e) => {
        setDraft(null);
        onPaste(e);
      }}
    />
  );
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

  const computedRows: { label: string; day: (d: number) => number; kind: string }[] = [
    { label: 'Total Inflows', day: (d) => dayInflows(numCats, values, d), kind: 'subtotal' },
    { label: 'Total Outflows', day: (d) => dayOutflows(numCats, values, d), kind: 'subtotal' },
    { label: 'Net Cash Flow', day: (d) => dayNet(numCats, values, d), kind: 'total' },
    {
      label: 'Closing Balance',
      day: (d) => runningBalance(numCats, values, startingBalance, d),
      kind: 'total',
    },
  ];

  return (
    <table className="forecast-grid">
      <thead>
        <tr>
          <th className="row-label-h">Cash Flow Category</th>
          {dayLabels.map((dl, i) => (
            <th key={i} className="day-h">
              D{i + 1}
              <span className="dow">
                {dl.dow} {dl.dm}
              </span>
            </th>
          ))}
          <th className="day-h" style={{ background: '#e7e4dc' }}>
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g, gi) => (
          <GroupRows
            key={gi}
            group={g}
            props={props}
            scale={scales.values}
            totalScale={scales.totals}
          />
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
        {computedRows.map((row) => (
          <tr key={row.label}>
            <td className={`row-label ${row.kind}`}>{row.label}</td>
            {dayLabels.map((_dl, d) => (
              <td key={d} className={`cell ${row.kind}-cell`}>
                {fmt(row.day(d))}
              </td>
            ))}
            <td
              className={`cell ${row.kind}-cell`}
              style={{ background: '#ebe9e0', fontWeight: 600 }}
            >
              {row.label === 'Closing Balance'
                ? row.day(numDays - 1).toLocaleString()
                : Array.from({ length: numDays }, (_v, d) => row.day(d))
                    .reduce((a, b) => a + b, 0)
                    .toLocaleString()}
            </td>
          </tr>
        ))}
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
            <td className="cell" style={{ background: '#ebe9e0' }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function GroupRows({
  group,
  props,
  scale,
  totalScale,
}: {
  group: ReturnType<typeof categoryGroups>[number];
  props: ForecastGridProps;
  scale: HeatScale;
  totalScale: HeatScale;
}) {
  const { categories, dayLabels, values } = props;
  const numDays = dayLabels.length;
  return (
    <>
      {group.label && (
        <tr className="section-row">
          <td className="row-label">{group.label}</td>
          {Array.from({ length: numDays + 1 }).map((_, i) => (
            <td key={i} />
          ))}
        </tr>
      )}
      {group.idxs.map((catIdx) => {
        const isSubtotal = categories[catIdx].subtotal === true;
        return (
          <tr key={catIdx}>
            <td className={`row-label ${isSubtotal ? 'subtotal' : 'indent'}`}>
              {categories[catIdx].label}
            </td>
            {dayLabels.map((_dl, d) => (
              <EditableCell key={d} catIdx={catIdx} dayIdx={d} props={props} scale={scale} />
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
    scales,
  } = props;
  const numDays = dayLabels.length;
  const numCats = categories.length;
  const groups = categoryGroups(categories);
  // Only the final column of each band gets a vertical rule.
  const groupEnds = useMemo(
    () => new Set(groups.map((g) => g.idxs[g.idxs.length - 1])),
    [groups],
  );

  return (
    <table className="forecast-grid">
      <thead>
        <tr>
          <th className="row-label-h" rowSpan={2}>
            Date
          </th>
          {groups.map((g, gi) =>
            g.label ? (
              <th key={gi} colSpan={g.idxs.length} className="day-h">
                {g.label}
              </th>
            ) : (
              g.idxs.map((i) => <th key={`u${i}`} rowSpan={1} className="day-h" />)
            ),
          )}
          <th className="day-h" rowSpan={2} style={{ minWidth: 160 }}>
            Comments
          </th>
          <th className="day-h" rowSpan={2} style={{ background: '#e7e4dc' }}>
            Total
          </th>
          <th className="day-h" rowSpan={2} style={{ background: '#e7e4dc' }}>
            Running Total
          </th>
        </tr>
        <tr>
          {categories.map((cat, i) => (
            <th key={i} className={`day-h${groupEnds.has(i) ? ' group-end' : ''}`}>
              {cat.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="section-row">
          <td className="row-label">Starting Balance</td>
          {Array.from({ length: numCats + 1 }).map((_, i) => (
            <td key={i} />
          ))}
          <td className="cell total-cell">{startingBalance.toLocaleString()}</td>
          <td className="cell total-cell">{startingBalance.toLocaleString()}</td>
        </tr>
        {dayLabels.map((dl, dayIdx) => (
          <tr key={dayIdx}>
            <td className="row-label">
              {dl.dow} · {dl.dm}
            </td>
            {categories.map((_cat, catIdx) => (
              <EditableCell
                key={catIdx}
                catIdx={catIdx}
                dayIdx={dayIdx}
                props={props}
                scale={scales.values}
                extraClass={groupEnds.has(catIdx) ? 'group-end' : ''}
              />
            ))}
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
            {(() => {
              const net = dayNet(numCats, values, dayIdx);
              const bal = runningBalance(numCats, values, startingBalance, dayIdx);
              return (
                <>
                  <td className="cell subtotal-cell" style={fill(net, scales.totals)}>
                    {fmt(net)}
                  </td>
                  <td className="cell running-total-cell" style={fill(bal, scales.balances)}>
                    {bal.toLocaleString()}
                  </td>
                </>
              );
            })()}
          </tr>
        ))}
        {showColumnTotals && (
          <tr className="column-totals-row">
            <td className="row-label total">Column Total</td>
            {categories.map((cat, catIdx) => (
              <td key={catIdx} className="cell total-cell">
                {fmt(
                  cat.subtotal
                    ? subtotalTotal(categories, values, catIdx, numDays)
                    : catTotal(values, catIdx, numDays),
                )}
              </td>
            ))}
            <td className="cell total-cell" />
            <td className="cell total-cell">
              {Array.from({ length: numDays }, (_v, d) => dayNet(numCats, values, d))
                .reduce((a, b) => a + b, 0)
                .toLocaleString()}
            </td>
            <td className="cell total-cell">
              {runningBalance(numCats, values, startingBalance, numDays - 1).toLocaleString()}
            </td>
          </tr>
        )}
        <tr>
          <td className="row-label total">TOTAL</td>
          {categories.map((cat, catIdx) => (
            <td key={catIdx} className="cell total-cell">
              {fmt(
                cat.subtotal
                  ? subtotalTotal(categories, values, catIdx, numDays)
                  : catTotal(values, catIdx, numDays),
              )}
            </td>
          ))}
          <td className="cell total-cell" />
          <td className="cell total-cell">
            {Array.from({ length: numDays }, (_v, d) => dayNet(numCats, values, d))
              .reduce((a, b) => a + b, 0)
              .toLocaleString()}
          </td>
          <td className="cell total-cell">
            {runningBalance(numCats, values, startingBalance, numDays - 1).toLocaleString()}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
