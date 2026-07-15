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
