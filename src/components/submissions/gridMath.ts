import type { TemplateCategory } from '../../types';

/** Cell values keyed `${catIdx}-${dayIdx}`, EUR thousands. */
export type GridValues = Record<string, number>;

export const cellKey = (catIdx: number, dayIdx: number) => `${catIdx}-${dayIdx}`;

export function catValue(values: GridValues, catIdx: number, dayIdx: number): number {
  return values[cellKey(catIdx, dayIdx)] || 0;
}

/**
 * Sign convention (standard workbook): inflows are entered positive and
 * outflows negative, so per-day inflow/outflow totals are just the positive /
 * negative parts and the day total is the plain sum.
 */
export function dayInflows(numCats: number, values: GridValues, dayIdx: number): number {
  let s = 0;
  for (let c = 0; c < numCats; c++) s += Math.max(0, catValue(values, c, dayIdx));
  return s;
}

export function dayOutflows(numCats: number, values: GridValues, dayIdx: number): number {
  let s = 0;
  for (let c = 0; c < numCats; c++) s += Math.min(0, catValue(values, c, dayIdx));
  return s;
}

export function dayNet(numCats: number, values: GridValues, dayIdx: number): number {
  let s = 0;
  for (let c = 0; c < numCats; c++) s += catValue(values, c, dayIdx);
  return s;
}

/** Closing balance after `dayIdx`: starting balance + cumulative net. */
export function runningBalance(
  numCats: number,
  values: GridValues,
  startingBalance: number,
  dayIdx: number,
): number {
  let s = startingBalance;
  for (let d = 0; d <= dayIdx; d++) s += dayNet(numCats, values, d);
  return s;
}

/** Sum of one category across the horizon (trailing Total column / row). */
export function catTotal(values: GridValues, catIdx: number, numDays: number): number {
  let s = 0;
  for (let d = 0; d < numDays; d++) s += catValue(values, catIdx, d);
  return s;
}

export interface CategoryGroup {
  /** Band label, or undefined for ungrouped categories. */
  label?: string;
  /** Indices into the template's categories array. */
  idxs: number[];
}

/**
 * Consecutive runs of categories sharing the same group band, in template
 * order — drives section rows (days-across) and header bands (grouped).
 */
export function categoryGroups(categories: TemplateCategory[]): CategoryGroup[] {
  const out: CategoryGroup[] = [];
  categories.forEach((cat, i) => {
    const last = out[out.length - 1];
    if (last && last.label === cat.group) last.idxs.push(i);
    else out.push({ label: cat.group, idxs: [i] });
  });
  return out;
}

/**
 * Value of a computed subtotal row: the sum of the input line items above it
 * that share its group (or, for ungrouped subtotals, everything above it
 * since the previous subtotal). Subtotal rows never hold stored values, so
 * they contribute 0 to the day/grand totals and can never double count.
 */
export function subtotalValue(
  categories: TemplateCategory[],
  values: GridValues,
  catIdx: number,
  dayIdx: number,
): number {
  const target = categories[catIdx];
  if (!target?.subtotal) return 0;
  let sum = 0;
  for (let i = catIdx - 1; i >= 0; i--) {
    const cat = categories[i];
    if (!cat) break;
    if (cat.subtotal) break; // stop at the previous subtotal
    if (cat.group !== target.group) break; // stay inside the band
    sum += catValue(values, i, dayIdx);
  }
  return sum;
}

/** Total across the horizon for a computed subtotal row. */
export function subtotalTotal(
  categories: TemplateCategory[],
  values: GridValues,
  catIdx: number,
  numDays: number,
): number {
  let s = 0;
  for (let d = 0; d < numDays; d++) s += subtotalValue(categories, values, catIdx, d);
  return s;
}
