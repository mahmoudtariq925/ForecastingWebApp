import type { TemplateRow } from '../../types';

export type GridValues = Record<string, number>;

/**
 * Value of a single cell for a given row + day. Data rows read from `values`;
 * `subtotal` rows sum the data rows since the previous section/subtotal
 * boundary; `total` rows sum all subtotals (or, for templates without
 * subtotals, all data rows).
 */
export function dayValue(
  rows: TemplateRow[],
  values: GridValues,
  rowIdx: number,
  dayIdx: number,
): number {
  const row = rows[rowIdx];
  if (!row || row.kind === 'section') return 0;
  if (row.kind === 'data') return values[`${rowIdx}-${dayIdx}`] || 0;

  if (row.kind === 'subtotal') {
    let sum = 0;
    for (let r = rowIdx - 1; r >= 0; r--) {
      const kind = rows[r].kind;
      if (kind !== 'data') break;
      sum += values[`${r}-${dayIdx}`] || 0;
    }
    return sum;
  }

  // total
  const subtotalIdxs = rows
    .map((r, i) => (r.kind === 'subtotal' ? i : -1))
    .filter((i) => i >= 0);
  if (subtotalIdxs.length > 0) {
    return subtotalIdxs.reduce((sum, i) => sum + dayValue(rows, values, i, dayIdx), 0);
  }
  return rows.reduce(
    (sum, r, i) => (r.kind === 'data' ? sum + (values[`${i}-${dayIdx}`] || 0) : sum),
    0,
  );
}

/** Sum of a row across all days (the trailing Total column). */
export function rowTotal(
  rows: TemplateRow[],
  values: GridValues,
  rowIdx: number,
  numDays: number,
): number {
  let total = 0;
  for (let i = 0; i < numDays; i++) total += dayValue(rows, values, rowIdx, i);
  return total;
}
