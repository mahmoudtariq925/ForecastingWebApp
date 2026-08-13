import { Fragment, useMemo, useState } from 'react';
import { heatColor, heatScaleFrom, STRONG_HEAT } from '../submissions/heatmap';
import { countryCode } from '../../data/countryCodes';
import type { CategoryCountryMatrix, MatrixRow } from '../../data/dashboardService';

interface CountryMatrixProps {
  matrix: CategoryCountryMatrix;
}

const fmt = (v: number) => (Math.round(v) === 0 ? '—' : Math.round(v).toLocaleString());

/** A banded group of line items, with the section total that stands in for it. */
interface Section {
  /** Undefined for line items the template does not group (CAPEX, Other). */
  group?: string;
  rows: MatrixRow[];
  /** Section total per country, used when the band is folded away. */
  byCountry: Record<string, number>;
  total: number;
}

/** Group consecutive rows into their template sections, summing each band. */
function toSections(rows: MatrixRow[], countries: string[]): Section[] {
  const out: Section[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (!last || last.group !== row.group) {
      out.push({ group: row.group, rows: [row], byCountry: { ...row.byCountry }, total: row.total });
      continue;
    }
    last.rows.push(row);
    last.total += row.total;
    for (const c of countries) last.byCountry[c] = (last.byCountry[c] ?? 0) + (row.byCountry[c] ?? 0);
  }
  return out;
}

/**
 * The outlook read the other way round: line items down the rows, countries
 * across the columns.
 *
 * The chart answers "when does the money move"; this answers "who and what",
 * which is the question you have the moment the chart shows you something
 * unexpected. Both are built from the same aggregation, so the row totals here
 * add up to the columns there — and both follow the country selector and the
 * periods a click on the chart has filtered to.
 *
 * Sections open FOLDED, showing one total per band. Twelve line items across
 * eleven countries is a wall of 130 numbers before you have asked anything;
 * starting at section level means the first thing you read is where the money
 * is, and you open the band that looks wrong.
 *
 * Conditional formatting is per ROW, like the forecast grid: a line item is
 * shaded against the same line item elsewhere, so the colour says "which
 * country drives receivables" rather than "receivables are bigger than tax",
 * which the labels already say.
 */
export function CountryMatrix({ matrix }: CountryMatrixProps) {
  const { countries, rows, countryTotals, grandTotal } = matrix;
  const sections = useMemo(() => toSections(rows, countries), [rows, countries]);
  // Collapsed by default: the set holds the bands that have been opened.
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (group: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  if (countries.length === 0) {
    return (
      <div className="empty-state">
        <div className="ic">▦</div>
        <p>No countries selected. Pick at least one above to see the breakdown.</p>
      </div>
    );
  }

  /**
   * One row of country figures, shaded against ITSELF: white at zero, running
   * to green at that line item's largest inflow and red at its largest
   * outflow. The scale is per row because the question the colour answers is
   * "which country drives THIS line", not "is this line bigger than payroll",
   * which the labels already say.
   *
   * At the grid's own strength these tints were barely there on a table this
   * size, so the summary strength is used — here the colour is what is being
   * read, not something sitting behind dense type.
   */
  const cells = (byCountry: Record<string, number>, extraClass = '') => {
    const scale = heatScaleFrom(countries.map((c) => byCountry[c] ?? 0));
    return countries.map((c) => {
      const v = byCountry[c] ?? 0;
      const background = heatColor(v, scale, STRONG_HEAT);
      return (
        <td
          key={c}
          className={`num${extraClass}`}
          style={background ? { background } : undefined}
        >
          {fmt(v)}
        </td>
      );
    });
  };

  return (
    <div className="matrix-wrap">
      <table className="matrix-table">
        <thead>
          <tr>
            <th className="matrix-row-h">Line item</th>
            {/* ISO codes: eleven full country names set the column width and
                pushed the figures off the panel. The name is in the tooltip. */}
            {countries.map((c) => (
              <th key={c} className="num" title={c}>
                {countryCode(c)}
              </th>
            ))}
            <th className="num matrix-total-h">Total</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section, i) => {
            // Ungrouped line items have no band to fold; show them as they are.
            if (!section.group) {
              return (
                <Fragment key={`plain-${i}`}>
                  {section.rows.map((row) => (
                    <tr key={row.label}>
                      <td className="matrix-row-label">{row.label}</td>
                      {cells(row.byCountry)}
                      <td className="num matrix-total">{fmt(row.total)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            }
            const isOpen = open.has(section.group);
            return (
              <Fragment key={section.group}>
                {/* ONE row per section, carrying its own totals — the shape the
                    consolidated forecast uses. A band row above a "… total"
                    row said the section's name twice and spent two lines of a
                    short panel saying nothing new. */}
                <tr className="matrix-section-total">
                  <td className="matrix-row-label">
                    <button
                      type="button"
                      className="matrix-section-toggle"
                      aria-expanded={isOpen}
                      onClick={() => toggle(section.group!)}
                      title={isOpen ? 'Fold this section back to its total' : 'Show the line items'}
                    >
                      <span className="section-caret" aria-hidden="true">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      {section.group}
                    </button>
                  </td>
                  {cells(section.byCountry, ' matrix-band-total')}
                  <td className="num matrix-total">{fmt(section.total)}</td>
                </tr>
                {isOpen &&
                  section.rows.map((row) => (
                    <tr key={row.label}>
                      <td className="matrix-row-label indent">{row.label}</td>
                      {cells(row.byCountry)}
                      <td className="num matrix-total">{fmt(row.total)}</td>
                    </tr>
                  ))}
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
