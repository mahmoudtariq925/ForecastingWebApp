import type { ClipboardEvent } from 'react';
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
  runningBalance,
  type GridValues,
} from './gridMath';

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
}

/**
 * The forecast grid, rendered in the template's layout:
 * - `days-across`: line items down the rows, one column per working day.
 * - `grouped`: one row per working day, categories across columns under
 *   group bands with Comments / Total / Running total (standard workbook).
 * Values are keyed `${catIdx}-${dayIdx}` in both layouts.
 */
export function ForecastGrid(props: ForecastGridProps) {
  return props.layout === 'grouped' ? <GroupedGrid {...props} /> : <DaysAcrossGrid {...props} />;
}

function EditableCell({
  catIdx,
  dayIdx,
  props,
  extraClass = '',
}: {
  catIdx: number;
  dayIdx: number;
  props: ForecastGridProps;
  extraClass?: string;
}) {
  const { values, flags, editable, onChangeCell, onPaste, onCellClick } = props;
  const key = cellKey(catIdx, dayIdx);
  const val = catValue(values, catIdx, dayIdx);
  const flagged = flags.has(key);
  const cls = `cell ${flagged ? 'variance-flag' : ''} ${extraClass}`.trim();

  if (!editable) {
    return <td className={cls}>{fmt(val)}</td>;
  }
  return (
    <td className={cls} onClick={() => flagged && onCellClick?.(catIdx, dayIdx)}>
      <input
        value={val === 0 ? '' : val}
        data-cat={catIdx}
        data-day={dayIdx}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[€$,\s]/g, ''));
          onChangeCell?.(catIdx, dayIdx, Number.isFinite(n) ? n : 0);
        }}
        onPaste={(e) => onPaste?.(catIdx, dayIdx, e)}
      />
    </td>
  );
}

// ---------------------------------------------------------------------------
// days-across: rows = line items, columns = days
// ---------------------------------------------------------------------------
function DaysAcrossGrid(props: ForecastGridProps) {
  const { categories, dayLabels, values, startingBalance, dayComments, editable, onChangeDayComment } =
    props;
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
          <GroupRows key={gi} group={g} props={props} />
        ))}
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
}: {
  group: ReturnType<typeof categoryGroups>[number];
  props: ForecastGridProps;
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
      {group.idxs.map((catIdx) => (
        <tr key={catIdx}>
          <td className="row-label indent">{categories[catIdx].label}</td>
          {dayLabels.map((_dl, d) => (
            <EditableCell key={d} catIdx={catIdx} dayIdx={d} props={props} />
          ))}
          <td className="cell" style={{ background: '#ebe9e0', fontWeight: 600 }}>
            {catTotal(values, catIdx, numDays).toLocaleString()}
          </td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// grouped: rows = days, columns = categories (standard workbook layout)
// ---------------------------------------------------------------------------
function GroupedGrid(props: ForecastGridProps) {
  const {
    categories,
    dayLabels,
    values,
    startingBalance,
    dayComments,
    editable,
    onChangeDayComment,
  } = props;
  const numDays = dayLabels.length;
  const numCats = categories.length;
  const groups = categoryGroups(categories);

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
            <th key={i} className="day-h">
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
              <EditableCell key={catIdx} catIdx={catIdx} dayIdx={dayIdx} props={props} />
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
            <td className="cell subtotal-cell">{fmt(dayNet(numCats, values, dayIdx))}</td>
            <td className="cell total-cell">
              {runningBalance(numCats, values, startingBalance, dayIdx).toLocaleString()}
            </td>
          </tr>
        ))}
        <tr>
          <td className="row-label total">TOTAL</td>
          {categories.map((_cat, catIdx) => (
            <td key={catIdx} className="cell total-cell">
              {fmt(catTotal(values, catIdx, numDays))}
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
