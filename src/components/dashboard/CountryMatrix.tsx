import { Fragment } from 'react';
import { heatColor, heatScaleFrom } from '../submissions/heatmap';
import type { CategoryCountryMatrix } from '../../data/dashboardService';

interface CountryMatrixProps {
  matrix: CategoryCountryMatrix;
}

const fmt = (v: number) => (Math.round(v) === 0 ? '—' : Math.round(v).toLocaleString());

/**
 * The four-week outlook read the other way round: line items down the rows,
 * countries across the columns.
 *
 * The chart answers "when does the money move"; this answers "who and what",
 * which is the question you have the moment the chart shows you something
 * unexpected. Both are built from the same aggregation, so the row totals
 * here add up to the columns there — and both follow the country selector and
 * the period a click on the chart has filtered to.
 *
 * Conditional formatting is per ROW, like the forecast grid: a line item is
 * shaded against the same line item elsewhere, so the colour says "which
 * country drives receivables" rather than "receivables are bigger than tax",
 * which the labels already say.
 */
export function CountryMatrix({ matrix }: CountryMatrixProps) {
  const { countries, rows, countryTotals, grandTotal } = matrix;

  if (countries.length === 0) {
    return (
      <div className="empty-state">
        <div className="ic">▦</div>
        <p>No countries selected. Pick at least one above to see the breakdown.</p>
      </div>
    );
  }

  return (
    <div className="matrix-wrap">
      <table className="matrix-table">
        <thead>
          <tr>
            <th className="matrix-row-h">Line item</th>
            {countries.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
            <th className="num matrix-total-h">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            // Each row carries its own scale, fixed at a midpoint of zero.
            const scale = heatScaleFrom(countries.map((c) => row.byCountry[c] ?? 0));
            const newSection = row.group && row.group !== rows[i - 1]?.group;
            return (
              <Fragment key={i}>
                {newSection && (
                  <tr className="matrix-section">
                    <td colSpan={countries.length + 2}>{row.group}</td>
                  </tr>
                )}
                <tr>
                  <td className="matrix-row-label">{row.label}</td>
                  {countries.map((c) => {
                    const v = row.byCountry[c] ?? 0;
                    const background = heatColor(v, scale);
                    return (
                      <td key={c} className="num" style={background ? { background } : undefined}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                  <td className="num matrix-total">{fmt(row.total)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="matrix-row-label">Net cash flow</td>
            {countries.map((c) => {
              const v = countryTotals[c] ?? 0;
              return (
                <td
                  key={c}
                  className={`num matrix-total${v < 0 ? ' net-negative' : v > 0 ? ' net-positive' : ''}`}
                >
                  {fmt(v)}
                </td>
              );
            })}
            <td
              className={`num matrix-total${
                grandTotal < 0 ? ' net-negative' : grandTotal > 0 ? ' net-positive' : ''
              }`}
            >
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
