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
 * A line as the GRID holds it: a template category, or one of the rows a
 * submitter added under one. The extra fields are optional, so a plain
 * `TemplateCategory[]` is still a valid argument.
 */
type GridLine = TemplateCategory & {
  /** Set on a row the submitter added. */
  customRowId?: string;
  /** The label of the line that row breaks down, if any. */
  parentLabel?: string;
};

/**
 * The sections of a forecast, in reading order — section rows in the
 * days-across layout, header bands in the grouped one.
 *
 * A NAMED section gathers every line that carries its label, wherever the
 * line sits in the array. That is what lets a submitter's own rows be
 * APPENDED to the categories (which keeps every existing cell key meaning
 * what it meant) and still render where they belong.
 *
 * And where they belong is UNDER THE LINE THEY BREAK DOWN: "Customer A" is
 * part of Receivables, not something loose at the foot of Trade AR & AP, and
 * a section holding both receivables and payables cannot put every added row
 * in one pile at the bottom and still be read. So each line is followed by
 * its own rows; rows belonging to no line (or to one the template no longer
 * has) fall to the end of the section, and the computed subtotal after them,
 * so it stays what everything above it adds up to.
 */
export function categoryGroups(categories: readonly GridLine[]): CategoryGroup[] {
  const out: CategoryGroup[] = [];
  const byLabel = new Map<string, CategoryGroup>();
  /** Which group holds the line of a given label — where its rows go. */
  const groupOfLine = new Map<string, CategoryGroup>();
  const key = (label: string | undefined) => (label ?? '').trim().toLowerCase();

  // The TEMPLATE's own lines first: they decide what the sections are, and a
  // row can only be placed once the line it belongs to has one.
  categories.forEach((cat, i) => {
    if (cat.customRowId !== undefined) return;
    let group: CategoryGroup;
    if (cat.group) {
      const existing = byLabel.get(key(cat.group));
      if (existing) group = existing;
      else {
        group = { label: cat.group, idxs: [] };
        byLabel.set(key(cat.group), group);
        out.push(group);
      }
    } else {
      const last = out[out.length - 1];
      if (last && last.label === undefined) group = last;
      else {
        group = { label: undefined, idxs: [] };
        out.push(group);
      }
    }
    group.idxs.push(i);
    if (!cat.subtotal && !groupOfLine.has(key(cat.label))) groupOfLine.set(key(cat.label), group);
  });

  // Then the rows somebody added: into the group holding the line they break
  // down — which is how a row under a line that belongs to no section (CAPEX,
  // say) lands beside it rather than in a group of its own at the end.
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    if (cat.customRowId === undefined) continue;
    const target =
      (cat.parentLabel !== undefined ? groupOfLine.get(key(cat.parentLabel)) : undefined) ??
      (cat.group ? byLabel.get(key(cat.group)) : undefined);
    if (target) {
      target.idxs.push(i);
      continue;
    }
    // Nothing to belong to: its own group, at the end, rather than dropped.
    const last = out[out.length - 1];
    if (last && last.label === undefined && cat.group === undefined) last.idxs.push(i);
    else out.push({ label: cat.group, idxs: [i] });
  }

  for (const group of out) {
    group.idxs = orderSectionLines(categories, group.idxs);
  }
  return out;
}

/** One section's lines: each template line, then the rows added under it. */
function orderSectionLines(categories: readonly GridLine[], idxs: number[]): number[] {
  const lines = idxs.filter((i) => !categories[i]?.subtotal && !categories[i]?.customRowId);
  const rows = idxs.filter((i) => categories[i]?.customRowId !== undefined);
  const totals = idxs.filter((i) => categories[i]?.subtotal);
  const key = (label: string | undefined) => (label ?? '').trim().toLowerCase();
  const parents = new Set(lines.map((i) => key(categories[i].label)));

  const out: number[] = [];
  for (const line of lines) {
    out.push(line);
    for (const row of rows) {
      if (key(categories[row].parentLabel) === key(categories[line].label)) out.push(row);
    }
  }
  // Rows belonging to the section itself, and any orphaned by a template edit
  // that renamed or removed the line they were under.
  for (const row of rows) {
    const parent = categories[row].parentLabel;
    if (parent === undefined || !parents.has(key(parent))) out.push(row);
  }
  return [...out, ...totals];
}

/**
 * A section's own total for one period: the sum of its INPUT line items.
 *
 * Computed from the items rather than read off a subtotal row, so a section
 * collapses to a correct number whether or not the template happens to carry
 * one — and subtotals are excluded so nothing is counted twice.
 */
export function groupValue(
  categories: TemplateCategory[],
  values: GridValues,
  idxs: number[],
  dayIdx: number,
): number {
  let sum = 0;
  for (const i of idxs) {
    if (categories[i]?.subtotal) continue;
    sum += catValue(values, i, dayIdx);
  }
  return sum;
}

/** A section's total across the whole horizon. */
export function groupTotal(
  categories: TemplateCategory[],
  values: GridValues,
  idxs: number[],
  numDays: number,
): number {
  let sum = 0;
  for (let d = 0; d < numDays; d++) sum += groupValue(categories, values, idxs, d);
  return sum;
}

/**
 * Whether anything at all has been forecast yet.
 *
 * The difference between "this section is empty" and "nothing is filled in
 * yet" matters: on a blank forecast every section is empty, so marking them
 * all as having no activity says nothing, and folding them all away would
 * hide the form the submitter came to fill in.
 */
export function hasAnyValue(values: GridValues): boolean {
  for (const key in values) {
    if (values[key] !== 0) return true;
  }
  return false;
}

/**
 * Whether a section has no figures at all across the whole horizon.
 *
 * Tested cell by cell rather than on the section total: a section holding
 * +100 and −100 nets to zero and is very much not empty, and hiding it would
 * hide the two figures that cancelled.
 *
 * A stored 0 counts as empty because that is exactly how the grid draws it —
 * as "—", the same as a cell nobody has touched.
 */
export function groupIsEmpty(
  categories: TemplateCategory[],
  values: GridValues,
  idxs: number[],
  numDays: number,
): boolean {
  for (const i of idxs) {
    if (categories[i]?.subtotal) continue;
    for (let d = 0; d < numDays; d++) {
      if (catValue(values, i, d) !== 0) return false;
    }
  }
  return true;
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
  // A section's total is the section, all of it: its template lines and the
  // rows the submitter added under it, wherever those sit in the array.
  // Walking backwards would stop at the last template line and leave every
  // added row out of the total it is part of.
  if (target.group) {
    const key = target.group.trim().toLowerCase();
    categories.forEach((cat, i) => {
      if (cat.subtotal || !cat.group) return;
      if (cat.group.trim().toLowerCase() !== key) return;
      sum += catValue(values, i, dayIdx);
    });
    return sum;
  }
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
