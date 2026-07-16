// ============================================================================
// Workbook structure parsing shared by the browser (grid value imports) and
// the API server (authoritative template parsing on upload). Runs on exceljs,
// which is dynamically imported so the browser only downloads it on demand.
//
// Template structure is DERIVED FROM THE WORKBOOK rather than naming
// conventions. Two layouts are supported (auto-detectable):
//
//   grouped      — the standard CF_Forecast_Template layout: one row per
//                  working day, a "Date" header column, category columns
//                  under merged group bands, Comments / Total / Running
//                  total columns and a Starting balance cell.
//   days-across  — line items down column A, one column per day. Group
//                  headers are rows with no numbers; rows containing
//                  formulas are treated as computed and recreated by the app.
// ============================================================================
import type { TemplateCategory, TemplateLayout } from './types';

// exceljs' Worksheet/Cell types are only needed structurally here.
export type Worksheet = {
  name: string;
  rowCount: number;
  columnCount: number;
  getRow(r: number): {
    getCell(c: number): XCell;
  };
  getCell(r: number, c: number): XCell;
  model: { merges?: string[] };
};
export type XCell = {
  value: unknown;
  text?: string;
  font?: { bold?: boolean };
  formula?: string;
};

export async function getExcelJS() {
  const mod = await import('exceljs');
  return mod.default ?? mod;
}

export const norm = (s: unknown) =>
  String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 1-based column index → Excel letters. */
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colFromLetter(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function cellText(cell: XCell): string {
  // cell.text throws on merged cells whose master value is null (exceljs
  // MergeValue.toString on null), so guard the accessor.
  try {
    const t = cell.text;
    if (t !== undefined && t !== null) return String(t).trim();
  } catch {
    /* fall through to raw value */
  }
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const res = (v as { result?: unknown }).result;
    if (res !== undefined && res !== null) return String(res).trim();
    return '';
  }
  return String(v).trim();
}

export function cellNumber(cell: XCell): number | null {
  const v = cell.value as unknown;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[€$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === 'object') {
    const res = (v as { result?: unknown }).result;
    if (typeof res === 'number') return res;
  }
  return null;
}

export function cellDate(cell: XCell): Date | null {
  const v = cell.value as unknown;
  if (v instanceof Date) return v;
  if (v && typeof v === 'object') {
    const res = (v as { result?: unknown }).result;
    if (res instanceof Date) return res;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export function hasFormula(cell: XCell): boolean {
  const v = cell.value as unknown;
  return Boolean(
    cell.formula ||
      (v &&
        typeof v === 'object' &&
        ('formula' in (v as object) || 'sharedFormula' in (v as object))),
  );
}

// Non-category columns in grouped-layout files.
const RESERVED_HEADERS = new Set([
  '',
  'country',
  'currency',
  'weekday',
  'date',
  'comments',
  'comment',
  'total',
  'running total',
  'running balance',
  'dropdown',
]);

export interface GroupedHeader {
  headerRow: number;
  dateCol: number;
  categoryCols: { col: number; label: string }[];
  commentsCol?: number;
}

export function findGroupedHeader(ws: Worksheet): GroupedHeader | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 25); r++) {
    const row = ws.getRow(r);
    let dateCol = 0;
    for (let c = 1; c <= Math.min(ws.columnCount, 60); c++) {
      if (norm(cellText(row.getCell(c))) === 'date') {
        dateCol = c;
        break;
      }
    }
    if (!dateCol) continue;
    const categoryCols: { col: number; label: string }[] = [];
    let commentsCol: number | undefined;
    for (let c = dateCol + 1; c <= Math.min(ws.columnCount, 80); c++) {
      const label = cellText(row.getCell(c));
      const n = norm(label);
      if (n === 'comments' || n === 'comment') {
        commentsCol = c;
        continue;
      }
      if (RESERVED_HEADERS.has(n)) continue;
      if (label) categoryCols.push({ col: c, label });
    }
    if (categoryCols.length >= 2) return { headerRow: r, dateCol, categoryCols, commentsCol };
  }
  return null;
}

/** Resolve group bands from the row above the header (merges + 1-col carry). */
function groupBands(ws: Worksheet, header: GroupedHeader): Map<number, string> {
  const bandRow = header.headerRow - 1;
  const bands = new Map<number, string>();
  if (bandRow < 1) return bands;

  // Merged ranges on the band row: master value spans the whole range.
  const merged = new Map<number, string>();
  for (const range of ws.model.merges ?? []) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!m || Number(m[2]) !== bandRow || Number(m[4]) !== bandRow) continue;
    const from = colFromLetter(m[1]);
    const to = colFromLetter(m[3]);
    const label = cellText(ws.getRow(bandRow).getCell(from));
    if (!label) continue;
    for (let c = from; c <= to; c++) merged.set(c, label);
  }

  let lastLabelCol = -10;
  let lastLabel = '';
  for (const { col } of header.categoryCols) {
    if (merged.has(col)) {
      bands.set(col, merged.get(col)!);
      continue;
    }
    const label = cellText(ws.getRow(bandRow).getCell(col));
    if (label && norm(label) !== 'dropdown') {
      bands.set(col, label);
      lastLabelCol = col;
      lastLabel = label;
    } else if (col === lastLabelCol + 1 && lastLabel) {
      // Unmerged two-column band (label written once): carry a single column.
      bands.set(col, lastLabel);
      lastLabelCol = col;
    }
  }
  return bands;
}

function parseGroupedStructure(ws: Worksheet): TemplateCategory[] {
  const header = findGroupedHeader(ws);
  if (!header) {
    throw new Error(
      'Could not find the header row — grouped templates need a "Date" column followed by category columns.',
    );
  }
  const bands = groupBands(ws, header);
  return header.categoryCols.map(({ col, label }) => ({
    label,
    group: bands.get(col),
  }));
}

function parseDaysAcrossStructure(ws: Worksheet): TemplateCategory[] {
  const categories: TemplateCategory[] = [];
  let group: string | undefined;
  let sawAnyRow = false;

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = cellText(row.getCell(1)) || cellText(row.getCell(2));
    if (!label) continue;

    // Inspect the rest of the row.
    let numeric = 0;
    let textCells = 0;
    let formula = false;
    for (let c = 2; c <= Math.min(ws.columnCount, 60); c++) {
      const cell = row.getCell(c);
      if (hasFormula(cell)) formula = true;
      else if (cellNumber(cell) !== null) numeric++;
      else if (cellText(cell)) textCells++;
    }

    // Header row (e.g. "Category | D1 | D2 …"): first row with several text cells.
    if (!sawAnyRow && textCells >= 3 && numeric === 0) {
      sawAnyRow = true;
      continue;
    }
    sawAnyRow = true;

    // Rows whose values are formulas are computed rows — the app recreates them.
    if (formula) continue;

    // A label with no numbers is a group header (bold and ALL-CAPS both count).
    if (numeric === 0 && textCells === 0) {
      group = label;
      continue;
    }
    categories.push({ label, group });
  }

  if (categories.length === 0) {
    throw new Error('No line items found. Put row labels in the first column of the sheet.');
  }
  return categories;
}

/** Which layout does this worksheet look like? */
export function detectLayoutOf(ws: Worksheet): TemplateLayout {
  return findGroupedHeader(ws) ? 'grouped' : 'days-across';
}

export interface ParsedTemplate {
  layout: TemplateLayout;
  categories: TemplateCategory[];
}

/**
 * Parse .xlsx bytes into a template structure. `layout` forces a parser;
 * omit or pass 'auto' to auto-detect. Works in the browser and on Node.
 */
export async function parseTemplateBuffer(
  data: ArrayBuffer | Uint8Array,
  layout?: TemplateLayout | 'auto',
): Promise<ParsedTemplate> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  // exceljs accepts both ArrayBuffer and Node Buffer here.
  await wb.xlsx.load(data as ArrayBuffer);
  const ws = wb.worksheets[0] as unknown as Worksheet;
  if (!ws) throw new Error('The workbook has no worksheets.');

  const resolved: TemplateLayout = !layout || layout === 'auto' ? detectLayoutOf(ws) : layout;
  const categories =
    resolved === 'grouped' ? parseGroupedStructure(ws) : parseDaysAcrossStructure(ws);
  return { layout: resolved, categories };
}
