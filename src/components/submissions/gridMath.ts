import { dayLabels, lineItems } from '../../data/mockData';

export const NUM_DAYS = dayLabels.length;

// Member row indices for the computed rows (fixed by lineItems order).
const INFLOW_ROWS = [1, 2, 3];
const OUTFLOW_ROWS = [6, 7, 8, 9, 10, 11];

export type GridValues = Record<string, number>;

/** Value of a single cell for a given row + day, computing subtotal/total rows. */
export function dayValue(values: GridValues, rowIdx: number, dayIdx: number): number {
  const item = lineItems[rowIdx];
  if (item.section) return 0;
  if (item.isSubtotal) {
    const rows = item.label === 'Total Inflows' ? INFLOW_ROWS : OUTFLOW_ROWS;
    return rows.reduce((sum, r) => sum + (values[`${r}-${dayIdx}`] || 0), 0);
  }
  if (item.isTotal) {
    return dayValue(values, 4, dayIdx) + dayValue(values, 12, dayIdx);
  }
  return values[`${rowIdx}-${dayIdx}`] || 0;
}

/** Sum of a row across all days (the trailing Total column). */
export function rowTotal(values: GridValues, rowIdx: number): number {
  let total = 0;
  for (let i = 0; i < NUM_DAYS; i++) total += dayValue(values, rowIdx, i);
  return total;
}
