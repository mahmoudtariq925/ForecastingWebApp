import type { TemplateCategory } from '../../types';

/** Cell values keyed `${catIdx}-${dayIdx}`, EUR thousands. */
export type GridValues = Record<string, number>;

export const cellKey = (catIdx: number, dayIdx: number) => `${catIdx}-${dayIdx}`;

// ---------------------------------------------------------------------------
// Number entry
//
// One parser for everything a treasury number can arrive as — typed by hand or
// pasted out of Excel. `Number()` alone rejected or silently mangled most
// real-world forms: accounting negatives "(500)", currency prefixes "£900",
// the Unicode minus Excel emits, and non-breaking-space thousands separators
// used across European locales.
// ---------------------------------------------------------------------------

/** Characters Excel and European locales use for a minus sign. */
const MINUS = /[\u2212\u2013\u2014]/g;
/** Currency symbols and separators that carry no numeric meaning. */
const NOISE = /[\s\u00a0\u202f'\u2019`\u20ac$\u00a3\u00a5]/g;

/**
 * Parse one entered/pasted cell into a number.
 *
 * Returns `null` when the text is not a number at all (a label, a stray
 * word), so callers can skip it rather than write a silent zero. An empty
 * string is a deliberate blank and parses to 0.
 */
export function parseCellNumber(raw: string): number | null {
  let text = String(raw ?? '').trim();
  if (text === '') return 0;

  text = text.replace(MINUS, '-');
  // Accounting notation: (500) and -(500) both mean minus 500.
  let negative = false;
  const parens = /^-?\((.*)\)$/.exec(text);
  if (parens) {
    negative = true;
    text = parens[1];
  }
  // A trailing minus ("500-") is what some ERP exports produce.
  if (/-$/.test(text)) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  text = text.replace(NOISE, '');
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }
  if (text === '') return 0;

  // Thousands separator vs decimal comma: whichever separator appears last is
  // the decimal one (1.234,56 and 1,234.56 both mean 1234.56).
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    text = text.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma !== -1) {
    // A lone comma is a decimal point only when it isn't grouping digits.
    text = /,\d{3}(\D|$)/.test(text) ? text.split(',').join('') : text.replace(',', '.');
  }

  if (!/^\d*\.?\d*$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * True while `raw` is on its way to becoming a number ("-", "1.", "(2").
 * Such text has to stay in the input as typed instead of being parsed and
 * echoed back, which is what used to eat the minus sign and the decimal
 * point mid-keystroke.
 */
export function isPartialNumber(raw: string): boolean {
  return /^-?\(?-?[\d.,]*$/.test(
    String(raw ?? '')
      .replace(MINUS, '-')
      .replace(NOISE, '')
      .trim(),
  );
}

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
