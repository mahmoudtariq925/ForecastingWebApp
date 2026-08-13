// ============================================================================
// Real .xlsx read/write built on exceljs (dynamically imported so the library
// is only downloaded when an import/export actually happens).
//
// Template structure is DERIVED FROM THE WORKBOOK rather than naming
// conventions. Two layouts are supported (auto-detected on upload/import;
// on-screen the orientation is toggled dynamically on the Submission view):
//
//   grouped      — the standard CF_Forecast_Template layout: one row per
//                  working day, a "Date" header column, category columns
//                  under merged group bands, Comments / Total / Running
//                  total columns and a Starting balance cell.
//   days-across  — line items down column A, one column per day. Group
//                  headers are rows with no numbers (bold or ALL-CAPS);
//                  rows containing formulas are treated as computed and
//                  recreated by the app.
//
// Exports produce a real Excel *table* that matches the UI layout, with
// live formulas for the Total / Running total / Total Inflows / Total
// Outflows / Net rows rather than static values.
// ============================================================================
import type {
  Cycle,
  ForecastTemplate,
  Submission,
  TemplateCategory,
  TemplateLayout,
} from '../types';
import type { DayLabel } from '../data/periods';
import type { GridValues } from '../components/submissions/gridMath';
import { catValue, categoryGroups } from '../components/submissions/gridMath';
import { downloadBlob, XLSX_MIME } from './download';

// exceljs' Worksheet/Cell types are only needed structurally here.
type Worksheet = {
  name: string;
  rowCount: number;
  columnCount: number;
  getRow(r: number): {
    getCell(c: number): XCell;
  };
  getCell(r: number, c: number): XCell;
  getColumn(c: number): { width?: number; numFmt?: string };
  addTable(t: unknown): unknown;
  mergeCells(range: string): void;
  model: { merges?: string[] };
};
type XCell = {
  value: unknown;
  text?: string;
  font?: { bold?: boolean };
  numFmt?: string;
  formula?: string;
  alignment?: unknown;
  fill?: unknown;
};

async function getExcelJS() {
  const mod = await import('exceljs');
  return mod.default ?? mod;
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 1-based column index → Excel letters. */
function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellText(cell: XCell): string {
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

function cellNumber(cell: XCell): number | null {
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

function cellDate(cell: XCell): Date | null {
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

function hasFormula(cell: XCell): boolean {
  const v = cell.value as unknown;
  return Boolean(
    cell.formula ||
      (v &&
        typeof v === 'object' &&
        (('formula' in (v as object)) || 'sharedFormula' in (v as object))),
  );
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

// ---------------------------------------------------------------------------
// Structure detection + parsing
// ---------------------------------------------------------------------------

interface GroupedHeader {
  headerRow: number;
  dateCol: number;
  categoryCols: { col: number; label: string }[];
  commentsCol?: number;
}

function findGroupedHeader(ws: Worksheet): GroupedHeader | null {
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

function colFromLetter(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
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
function detectLayoutOf(ws: Worksheet): TemplateLayout {
  return findGroupedHeader(ws) ? 'grouped' : 'days-across';
}

export interface ParsedTemplate {
  layout: TemplateLayout;
  categories: TemplateCategory[];
}

/**
 * Parse an uploaded .xlsx into a template structure. `layout` forces a
 * parser; omit it to auto-detect.
 */
export async function parseTemplateFile(
  file: File,
  layout?: TemplateLayout | 'auto',
): Promise<ParsedTemplate> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0] as unknown as Worksheet;
  if (!ws) throw new Error('The workbook has no worksheets.');

  const resolved: TemplateLayout =
    !layout || layout === 'auto' ? detectLayoutOf(ws) : layout;
  const categories =
    resolved === 'grouped' ? parseGroupedStructure(ws) : parseDaysAcrossStructure(ws);
  return { layout: resolved, categories };
}

// ---------------------------------------------------------------------------
// Value import
// ---------------------------------------------------------------------------

export interface ImportedValues {
  values: GridValues;
  dayComments: Record<string, string>;
  startingBalance?: number;
  matched: number;
}

function findStartingBalance(ws: Worksheet): number | undefined {
  for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.min(ws.columnCount, 40); c++) {
      if (!/starting\s*balance/i.test(cellText(row.getCell(c)))) continue;
      for (let cc = c + 1; cc <= c + 3; cc++) {
        const n = cellNumber(row.getCell(cc));
        if (n !== null) return n;
      }
      const below = cellNumber(ws.getRow(r + 1).getCell(c));
      if (below !== null) return below;
    }
  }
  return undefined;
}

/**
 * Import values from an .xlsx into an existing template's grid. The file's
 * own layout is auto-detected, so either orientation can be imported into
 * any template. Categories are matched by label; grouped files align rows
 * to horizon dates when the Date column parses, otherwise sequentially.
 */
export async function parseValuesFile(
  file: File,
  template: ForecastTemplate,
  dates: Date[],
): Promise<ImportedValues> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0] as unknown as Worksheet;
  if (!ws) throw new Error('The workbook has no worksheets.');
  return parseValuesWorksheet(ws, template, dates);
}

/**
 * Import values from a .csv. The rows are loaded into an in-memory worksheet
 * and parsed by the exact same matcher as .xlsx files, so both formats
 * support both layouts and identical label matching.
 */
export async function parseValuesCsv(
  file: File,
  template: ForecastTemplate,
  dates: Date[],
): Promise<ImportedValues> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Import');
  for (const row of parseCsvText(await file.text())) {
    sheet.addRow(row.map(coerceCsvCell));
  }
  return parseValuesWorksheet(sheet as unknown as Worksheet, template, dates);
}

/** Route an uploaded values file to the right parser by extension. */
export async function parseValuesUpload(
  file: File,
  template: ForecastTemplate,
  dates: Date[],
): Promise<ImportedValues> {
  return file.name.toLowerCase().endsWith('.csv')
    ? parseValuesCsv(file, template, dates)
    : parseValuesFile(file, template, dates);
}

/** Minimal CSV reader: quoted fields, embedded commas/quotes/newlines. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const push = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    push();
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') push();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** CSV cells arrive as text: recover numbers and dates so the worksheet
 * matcher treats them exactly like their .xlsx equivalents. */
function coerceCsvCell(raw: string): string | number | Date | null {
  const s = raw.trim();
  if (s === '') return null;
  // 1,234.56 / (500) negative / plain numbers
  const negative = /^\(.*\)$/.test(s);
  const numText = s.replace(/^\((.*)\)$/, '$1').replace(/[,\s€£$]/g, '');
  if (numText !== '' && !isNaN(Number(numText))) {
    return negative ? -Number(numText) : Number(numText);
  }
  // ISO (2026-07-27) and European (27/07/2026) dates
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  const euMatch = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (euMatch) return new Date(Number(euMatch[3]), Number(euMatch[2]) - 1, Number(euMatch[1]));
  return s;
}

function parseValuesWorksheet(
  ws: Worksheet,
  template: ForecastTemplate,
  dates: Date[],
): ImportedValues {
  const catIdxByLabel = new Map<string, number>();
  template.categories.forEach((cat, i) => catIdxByLabel.set(norm(cat.label), i));

  const values: GridValues = {};
  const dayComments: Record<string, string> = {};
  const startingBalance = findStartingBalance(ws);
  const dayByIso = new Map(dates.map((d, i) => [iso(d), i]));
  let matched = 0;

  const header = findGroupedHeader(ws);
  if (header) {
    // Grouped file: one row per day.
    const colToCat = new Map<number, number>();
    for (const { col, label } of header.categoryCols) {
      const idx = catIdxByLabel.get(norm(label));
      if (idx !== undefined) {
        colToCat.set(col, idx);
        matched++;
      }
    }
    if (matched === 0) {
      throw new Error(
        'No columns in the file matched the template line items (e.g. "Receivables").',
      );
    }
    let seq = 0;
    for (let r = header.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const date = cellDate(row.getCell(header.dateCol));
      // Stop at the TOTAL row (formulas) or after the horizon.
      if (hasFormula(row.getCell([...colToCat.keys()][0] ?? header.dateCol + 1))) break;
      let dayIdx: number | undefined;
      if (date) dayIdx = dayByIso.get(iso(date));
      if (dayIdx === undefined) {
        if (!date && seq >= dates.length) break;
        dayIdx = date ? undefined : seq;
      }
      seq++;
      if (dayIdx === undefined || dayIdx >= dates.length) continue;
      for (const [col, catIdx] of colToCat) {
        const n = cellNumber(row.getCell(col));
        if (n !== null) values[`${catIdx}-${dayIdx}`] = Math.round(n);
      }
      if (header.commentsCol) {
        const comment = cellText(row.getCell(header.commentsCol));
        if (comment) dayComments[String(dayIdx)] = comment;
      }
    }
  } else {
    // Days-across file: one row per line item, day values from column B on.
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const label = cellText(row.getCell(1)) || cellText(row.getCell(2));
      const catIdx = catIdxByLabel.get(norm(label));
      if (catIdx === undefined) continue;
      matched++;
      for (let d = 0; d < dates.length; d++) {
        const n = cellNumber(row.getCell(d + 2));
        if (n !== null) values[`${catIdx}-${d}`] = Math.round(n);
      }
    }
    if (matched === 0) {
      throw new Error(
        'No rows in the file matched the template line items (labels in column A).',
      );
    }
  }

  return { values, dayComments, startingBalance, matched };
}

// ---------------------------------------------------------------------------
// Submission export — real Excel table with live formulas
// ---------------------------------------------------------------------------

export interface ExportArgs {
  template: ForecastTemplate;
  layout?: TemplateLayout;
  entity: string;
  weekLabel: string;
  dates: Date[];
  dayLabels: DayLabel[];
  values: GridValues;
  startingBalance: number;
  dayComments?: Record<string, string>;
  filename: string;
}

const NUM_FMT = '#,##0';

export async function exportSubmissionXlsx(args: ExportArgs): Promise<void> {
  const layout = args.layout ?? args.template.layout;
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  if (layout === 'grouped') buildGroupedSheet(wb, args);
  else buildDaysAcrossSheet(wb, args);
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf, args.filename, XLSX_MIME);
}

/** Ensure table column names are unique (Excel requirement). */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    return count === 0 ? n : `${n} (${count + 1})`;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildGroupedSheet(wb: any, args: ExportArgs): void {
  const { template, entity, weekLabel, dates, values, startingBalance, dayComments } = args;
  const cats = template.categories;
  const ws = wb.addWorksheet('Forecast');

  // Title + starting balance (referenced by the Running total formulas).
  ws.getCell('A1').value = `Cash Flow Forecast — ${entity} · ${weekLabel}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'Starting balance';
  ws.getCell('A2').font = { bold: true };
  ws.getCell('B2').value = startingBalance;
  ws.getCell('B2').numFmt = NUM_FMT;

  // Columns: A Weekday, B Date, then categories, Comments, Total, Running total.
  const firstCatCol = 3;
  const commentsCol = firstCatCol + cats.length;
  const totalCol = commentsCol + 1;
  const runningCol = totalCol + 1;
  const bandRow = 4;
  const headerRow = 5;
  const firstDataRow = 6;

  // Group band row with merged cells, mirroring the UI header band.
  for (const g of categoryGroups(cats)) {
    if (!g.label) continue;
    const from = firstCatCol + g.idxs[0];
    const to = firstCatCol + g.idxs[g.idxs.length - 1];
    ws.mergeCells(`${colLetter(from)}${bandRow}:${colLetter(to)}${bandRow}`);
    const cell = ws.getCell(bandRow, from);
    cell.value = g.label;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
  }

  const columnNames = uniqueNames([
    'Weekday',
    'Date',
    ...cats.map((c) => c.label),
    'Comments',
    'Total',
    'Running total',
  ]);

  const rows = dates.map((d, dayIdx) => [
    d.toLocaleDateString('en-US', { weekday: 'short' }),
    d,
    ...cats.map((_c, catIdx) => catValue(values, catIdx, dayIdx)),
    dayComments?.[String(dayIdx)] ?? '',
    0, // placeholder → formula below
    0, // placeholder → formula below
  ]);

  ws.addTable({
    name: 'CashFlowForecast',
    ref: `A${headerRow}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: columnNames.map((name, i) => ({
      name,
      filterButton: false,
      // Native Excel totals row (SUBTOTAL) per category + Total column.
      totalsRowFunction:
        i >= firstCatCol - 1 && i !== commentsCol - 1 && i !== runningCol - 1 ? 'sum' : 'none',
      totalsRowLabel: i === 1 ? 'TOTAL' : undefined,
    })),
    rows,
  });

  // Replace placeholders with live formulas.
  const firstCatL = colLetter(firstCatCol);
  const lastCatL = colLetter(commentsCol - 1);
  dates.forEach((_d, dayIdx) => {
    const r = firstDataRow + dayIdx;
    ws.getCell(r, totalCol).value = { formula: `SUM(${firstCatL}${r}:${lastCatL}${r})` };
    ws.getCell(r, runningCol).value = {
      formula:
        dayIdx === 0
          ? `$B$2+${colLetter(totalCol)}${r}`
          : `${colLetter(runningCol)}${r - 1}+${colLetter(totalCol)}${r}`,
    };
  });

  // Formats & widths. Date format goes on the day cells only — column-wide
  // formatting would also hit the numeric Starting balance cell (B2).
  dates.forEach((_d, dayIdx) => {
    ws.getCell(firstDataRow + dayIdx, 2).numFmt = 'dd mmm yyyy';
  });
  ws.getColumn(2).width = 12;
  ws.getColumn(1).width = 10;
  for (let c = firstCatCol; c <= runningCol; c++) {
    if (c === commentsCol) {
      ws.getColumn(c).width = 24;
      continue;
    }
    ws.getColumn(c).numFmt = NUM_FMT;
    ws.getColumn(c).width = Math.max(12, (columnNames[c - 1]?.length ?? 10) + 2);
  }
  ws.getCell(bandRow, 1).value = '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDaysAcrossSheet(wb: any, args: ExportArgs): void {
  const { template, entity, weekLabel, dayLabels, values, startingBalance } = args;
  const cats = template.categories;
  const numDays = dayLabels.length;
  const ws = wb.addWorksheet('Forecast');

  ws.getCell('A1').value = `Cash Flow Forecast — ${entity} · ${weekLabel}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'Starting balance';
  ws.getCell('A2').font = { bold: true };
  ws.getCell('B2').value = startingBalance;
  ws.getCell('B2').numFmt = NUM_FMT;

  const headerRow = 4;
  const firstDataRow = headerRow + 1;
  const firstDayCol = 2;
  const totalCol = firstDayCol + numDays;

  const columnNames = uniqueNames([
    'Category',
    ...dayLabels.map((dl, i) => `D${i + 1} ${dl.dow} ${dl.dm}`),
    'Total',
  ]);

  // Build the row block: group bands, categories, then computed rows.
  interface RowSpec {
    label: string;
    kind: 'band' | 'data' | 'computed';
    catIdx?: number;
  }
  const specs: RowSpec[] = [];
  for (const g of categoryGroups(cats)) {
    if (g.label) specs.push({ label: g.label, kind: 'band' });
    for (const idx of g.idxs) specs.push({ label: cats[idx].label, kind: 'data', catIdx: idx });
  }
  const dataRowAt = new Map<number, number>(); // catIdx → sheet row
  specs.forEach((s, i) => {
    if (s.kind === 'data') dataRowAt.set(s.catIdx!, firstDataRow + i);
  });
  const firstCatRow = Math.min(...dataRowAt.values());
  const lastCatRow = Math.max(...dataRowAt.values());

  const computed = ['Total Inflows', 'Total Outflows', 'Net Cash Flow', 'Closing Balance'];
  const rows: (string | number)[][] = specs.map((s) => {
    if (s.kind === 'band') return [s.label, ...Array(numDays + 1).fill('')];
    return [
      s.label,
      ...dayLabels.map((_dl, d) => catValue(values, s.catIdx!, d)),
      0, // → SUM formula
    ];
  });
  computed.forEach((label) => rows.push([label, ...Array(numDays + 1).fill(0)]));

  ws.addTable({
    name: 'CashFlowForecast',
    ref: `A${headerRow}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: columnNames.map((name) => ({ name, filterButton: false })),
    rows,
  });

  // Formulas: per-day computed rows + per-row Total column.
  const inflowRow = firstDataRow + specs.length;
  const outflowRow = inflowRow + 1;
  const netRow = inflowRow + 2;
  const closingRow = inflowRow + 3;

  for (let d = 0; d < numDays; d++) {
    const L = colLetter(firstDayCol + d);
    const range = `${L}${firstCatRow}:${L}${lastCatRow}`;
    ws.getCell(inflowRow, firstDayCol + d).value = { formula: `SUMIF(${range},">0")` };
    ws.getCell(outflowRow, firstDayCol + d).value = { formula: `SUMIF(${range},"<0")` };
    ws.getCell(netRow, firstDayCol + d).value = { formula: `SUM(${range})` };
    ws.getCell(closingRow, firstDayCol + d).value = {
      formula:
        d === 0
          ? `$B$2+${L}${netRow}`
          : `${colLetter(firstDayCol + d - 1)}${closingRow}+${L}${netRow}`,
    };
  }
  const firstDayL = colLetter(firstDayCol);
  const lastDayL = colLetter(firstDayCol + numDays - 1);
  for (const [, r] of dataRowAt) {
    ws.getCell(r, totalCol).value = { formula: `SUM(${firstDayL}${r}:${lastDayL}${r})` };
  }
  for (const r of [inflowRow, outflowRow, netRow]) {
    ws.getCell(r, totalCol).value = { formula: `SUM(${firstDayL}${r}:${lastDayL}${r})` };
  }
  ws.getCell(closingRow, totalCol).value = { formula: `${lastDayL}${closingRow}` };

  // Styling: bold bands + computed rows, number formats, widths.
  specs.forEach((s, i) => {
    if (s.kind === 'band') ws.getRow(firstDataRow + i).font = { bold: true };
  });
  for (const r of [inflowRow, outflowRow, netRow, closingRow]) {
    ws.getRow(r).font = { bold: true };
  }
  ws.getColumn(1).width = 26;
  for (let c = firstDayCol; c <= totalCol; c++) {
    ws.getColumn(c).numFmt = NUM_FMT;
    ws.getColumn(c).width = 11;
  }
}

/**
 * Generate a blank template workbook from a template's structure (used for
 * downloading the built-in template and as an upload starting point).
 */
export async function exportTemplateXlsx(
  template: ForecastTemplate,
  dates: Date[],
  dayLabels: DayLabel[],
): Promise<void> {
  await exportSubmissionXlsx({
    template,
    entity: 'Template',
    weekLabel: 'blank',
    dates,
    dayLabels,
    values: {},
    startingBalance: 0,
    // Trailing separators trimmed: "CF Forecast (Standard)" was landing on
    // disk as "CF-Forecast-Standard-.xlsx".
    filename: `${template.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')}.xlsx`,
  });
}

// ---------------------------------------------------------------------------
// Tabular exports (dashboard Export modal) in xlsx / csv / json.
// ---------------------------------------------------------------------------
export type TableExport = { name: string; header: string[]; rows: (string | number)[][] };

/** Cycle rows for the Export modal. Counts are passed in by the caller so this
 * stays a pure formatter and cannot invent a figure of its own. */
export function cyclesTable(
  cycles: Cycle[],
  summaryFor?: (cycle: Cycle) => { received: number; expected: number; totalM: number },
): TableExport {
  return {
    name: 'Cycles',
    header: ['Cycle ID', 'Week', 'Closes', 'Status', 'Submissions', 'Total (€M)'],
    rows: cycles.map((c) => {
      const s = summaryFor?.(c);
      return [
        c.id,
        c.weekKey,
        c.closes,
        c.status === 'submitted' ? 'open' : 'closed',
        s ? `${s.received} / ${s.expected}` : '',
        s ? s.totalM : '',
      ];
    }),
  };
}

export function submissionsTable(subs: Submission[]): TableExport {
  return {
    name: 'Submissions',
    header: ['Week', 'Entity', 'Template', 'Status', 'Flags', 'Starting Balance', 'Updated'],
    rows: subs.map((s) => [
      s.period,
      s.entity,
      s.templateId,
      s.status,
      s.flags.length,
      s.startingBalance ?? 0,
      s.updatedAt,
    ]),
  };
}

/** Download a TableExport in the requested format. */
export async function exportTable(
  table: TableExport,
  format: 'xlsx' | 'csv' | 'json',
  baseName: string,
): Promise<void> {
  if (format === 'json') {
    const objects = table.rows.map((row) =>
      Object.fromEntries(table.header.map((h, i) => [h, row[i]])),
    );
    downloadBlob(JSON.stringify(objects, null, 2), `${baseName}.json`, 'application/json');
    return;
  }
  if (format === 'csv') {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [table.header, ...table.rows].map((r) => r.map(esc).join(',')).join('\n');
    downloadBlob(csv, `${baseName}.csv`, 'text/csv');
    return;
  }
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(table.name);
  ws.addTable({
    name: table.name.replace(/[^\w]+/g, ''),
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: uniqueNames(table.header).map((name) => ({ name, filterButton: false })),
    rows: table.rows,
  });
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf, `${baseName}.xlsx`, XLSX_MIME);
}
