import { useMemo, type ClipboardEvent } from 'react';
import { dayLabels, lineItems } from '../../data/mockData';
import { dayValue, rowTotal, NUM_DAYS, type GridValues } from './gridMath';

interface ForecastGridProps {
  values: GridValues;
  flags: Set<string>;
  editable: boolean;
  onChangeCell?: (rowIdx: number, dayIdx: number, value: number) => void;
  onPaste?: (rowIdx: number, dayIdx: number, e: ClipboardEvent<HTMLInputElement>) => void;
  onCellClick?: (rowIdx: number, dayIdx: number) => void;
}

/**
 * The 30-day forecast grid. Data rows are editable inputs when `editable`;
 * subtotal / total rows and the trailing column are computed live from
 * `values`. Variance-flagged cells (keys in `flags`) get the amber marker.
 */
export function ForecastGrid({
  values,
  flags,
  editable,
  onChangeCell,
  onPaste,
  onCellClick,
}: ForecastGridProps) {
  const fmt = (v: number) => (v === 0 ? '—' : v.toLocaleString());

  const rows = useMemo(() => lineItems.map((item, rowIdx) => ({ item, rowIdx })), []);

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
        {rows.map(({ item, rowIdx }) => {
          if (item.section) {
            return (
              <tr key={rowIdx} className="section-row">
                <td className="row-label">{item.section}</td>
                {Array.from({ length: NUM_DAYS + 1 }).map((_, i) => (
                  <td key={i} />
                ))}
              </tr>
            );
          }

          const labelClass = item.isSubtotal ? 'subtotal' : item.isTotal ? 'total' : 'indent';
          const isData = !item.isSubtotal && !item.isTotal;

          return (
            <tr key={rowIdx}>
              <td className={`row-label ${labelClass}`}>{item.label}</td>
              {dayLabels.map((dl, i) => {
                const key = `${rowIdx}-${i}`;
                const val = dayValue(values, rowIdx, i);
                const flagged = flags.has(key);
                const cellClass = `cell ${dl.weekend ? 'weekend' : ''} ${
                  flagged ? 'variance-flag' : ''
                } ${item.isSubtotal ? 'subtotal-cell' : ''} ${item.isTotal ? 'total-cell' : ''}`.trim();

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
                className={`cell ${item.isSubtotal ? 'subtotal-cell' : item.isTotal ? 'total-cell' : ''}`}
                style={{ background: '#ebe9e0', fontWeight: 600 }}
              >
                {rowTotal(values, rowIdx).toLocaleString()}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
