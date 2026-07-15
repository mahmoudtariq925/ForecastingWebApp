import type { ClipboardEvent } from 'react';
import type { TemplateRow } from '../../types';
import type { DayLabel } from '../../data/periods';
import { dayValue, rowTotal, type GridValues } from './gridMath';

interface ForecastGridProps {
  rows: TemplateRow[];
  dayLabels: DayLabel[];
  values: GridValues;
  flags: Set<string>;
  editable: boolean;
  onChangeCell?: (rowIdx: number, dayIdx: number, value: number) => void;
  onPaste?: (rowIdx: number, dayIdx: number, e: ClipboardEvent<HTMLInputElement>) => void;
  onCellClick?: (rowIdx: number, dayIdx: number) => void;
}

/**
 * The daily forecast grid, driven entirely by a template's row structure and
 * the selected period's day labels. Data rows are editable inputs when
 * `editable`; subtotal / total rows and the trailing column are computed live
 * from `values`. Variance-flagged cells (keys in `flags`) get the amber marker.
 */
export function ForecastGrid({
  rows,
  dayLabels,
  values,
  flags,
  editable,
  onChangeCell,
  onPaste,
  onCellClick,
}: ForecastGridProps) {
  const numDays = dayLabels.length;
  const fmt = (v: number) => (v === 0 ? '—' : v.toLocaleString());

  return (
    <table className="forecast-grid">
      <thead>
        <tr>
          <th className="row-label-h">Cash Flow Category</th>
          {dayLabels.map((dl, i) => (
            <th key={i} className={`day-h ${dl.weekend ? 'weekend' : ''}`}>
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
        {rows.map((row, rowIdx) => {
          if (row.kind === 'section') {
            return (
              <tr key={rowIdx} className="section-row">
                <td className="row-label">{row.label}</td>
                {Array.from({ length: numDays + 1 }).map((_, i) => (
                  <td key={i} />
                ))}
              </tr>
            );
          }

          const labelClass =
            row.kind === 'subtotal' ? 'subtotal' : row.kind === 'total' ? 'total' : 'indent';
          const isData = row.kind === 'data';

          return (
            <tr key={rowIdx}>
              <td className={`row-label ${labelClass}`}>{row.label}</td>
              {dayLabels.map((dl, i) => {
                const key = `${rowIdx}-${i}`;
                const val = dayValue(rows, values, rowIdx, i);
                const flagged = flags.has(key);
                const cellClass = `cell ${dl.weekend ? 'weekend' : ''} ${
                  flagged ? 'variance-flag' : ''
                } ${row.kind === 'subtotal' ? 'subtotal-cell' : ''} ${
                  row.kind === 'total' ? 'total-cell' : ''
                }`.trim();

                if (editable && isData) {
                  return (
                    <td
                      key={i}
                      className={cellClass}
                      onClick={() => flagged && onCellClick?.(rowIdx, i)}
                    >
                      <input
                        value={val === 0 ? '' : val}
                        data-row={rowIdx}
                        data-day={i}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/[€$,\s]/g, ''));
                          onChangeCell?.(rowIdx, i, Number.isFinite(n) ? n : 0);
                        }}
                        onPaste={(e) => onPaste?.(rowIdx, i, e)}
                      />
                    </td>
                  );
                }
                return (
                  <td key={i} className={cellClass}>
                    {fmt(val)}
                  </td>
                );
              })}
              <td
                className={`cell ${
                  row.kind === 'subtotal' ? 'subtotal-cell' : row.kind === 'total' ? 'total-cell' : ''
                }`}
                style={{ background: '#ebe9e0', fontWeight: 600 }}
              >
                {rowTotal(rows, values, rowIdx, numDays).toLocaleString()}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
