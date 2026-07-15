// ============================================================================
// Real .xlsx read/write built on exceljs (dynamically imported so the library
// is only downloaded when an import/export actually happens).
//
// Template file convention (documented in the Templates screen):
//   - First worksheet, row labels in column A.
//   - ALL-CAPS labels           → section headers      (e.g. "INFLOWS")
//   - Labels starting "Total"   → computed subtotal rows
//   - Labels starting "Net"     → computed grand-total row
//   - Everything else           → editable data rows
// ============================================================================
import type { Cycle, ForecastTemplate, Submission, TemplateRow } from '../types';
import type { DayLabel } from '../data/periods';
import type { GridValues } from '../components/submissions/gridMath';
import { dayValue, rowTotal } from '../components/submissions/gridMath';
import { downloadBlob, XLSX_MIME } from './download';

async function getExcelJS() {
  const mod = await import('exceljs');
  return mod.default ?? mod;
}

function classifyLabel(label: string): TemplateRow['kind'] {
  if (/^total\b/i.test(label)) return 'subtotal';
  if (/^net\b/i.test(label)) return 'total';
  const hasLetters = /[a-zA-Z]/.test(label);
  if (hasLetters && label === label.toUpperCase()) return 'section';
  return 'data';
}

/** Parse an uploaded .xlsx template file into a row structure. */
export async function parseTemplateFile(file: File): Promise<TemplateRow[]> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no worksheets.');

  const rows: TemplateRow[] = [];
  ws.eachRow((row) => {
    const label = String(row.getCell(1).text ?? '').trim();
    if (!label) return;
    // Skip an obvious header row like "Cash Flow Category".
    if (rows.length === 0 && /categor|line item/i.test(label)) return;
    rows.push({ label, kind: classifyLabel(label) });
  });

  if (!rows.some((r) => r.kind === 'data')) {
    throw new Error(
      'No data rows found. Put row labels in column A of the first sheet — ' +
        'ALL-CAPS rows become sections, "Total …" rows become subtotals.',
    );
  }
  return rows;
}

/**
 * Import values from an .xlsx into an existing template's grid. Rows are
 * matched by label (case-insensitive) against the template's data rows;
 * numeric cells in columns B… map to day 1….
 */
export async function parseValuesFile(
  file: File,
  templateRows: TemplateRow[],
  numDays: number,
): Promise<{ values: GridValues; matched: number }> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no worksheets.');

  const rowIdxByLabel = new Map<string, number>();
  templateRows.forEach((row, i) => {
    if (row.kind === 'data') rowIdxByLabel.set(row.label.trim().toLowerCase(), i);
  });

  const values: GridValues = {};
  let matched = 0;
  ws.eachRow((row) => {
    const label = String(row.getCell(1).text ?? '').trim().toLowerCase();
    const rowIdx = rowIdxByLabel.get(label);
    if (rowIdx === undefined) return;
    matched++;
    for (let day = 0; day < numDays; day++) {
      const cell = row.getCell(day + 2);
      const raw = cell.value;
      let n: number | null = null;
      if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string') {
        const cleaned = Number(raw.replace(/[€$,\s]/g, ''));
        if (Number.isFinite(cleaned)) n = cleaned;
      } else if (raw && typeof raw === 'object' && 'result' in raw) {
        const res = (raw as { result?: unknown }).result;
        if (typeof res === 'number') n = res;
      }
      if (n !== null) values[`${rowIdx}-${day}`] = Math.round(n);
    }
  });

  if (matched === 0) {
    throw new Error(
      'No rows in the file matched the template line items. ' +
        'Row labels in column A must match the template (e.g. "Customer Receipts").',
    );
  }
  return { values, matched };
}

/** Export a forecast grid (with computed subtotals/totals) as an .xlsx download. */
export async function exportGridXlsx(
  templateRows: TemplateRow[],
  dayLabels: DayLabel[],
  values: GridValues,
  filename: string,
  sheetName = 'Forecast',
): Promise<void> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  ws.addRow([
    'Cash Flow Category',
    ...dayLabels.map((dl, i) => `D${i + 1} (${dl.dow} ${dl.dm})`),
    'Total',
  ]);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(1).width = 28;

  templateRows.forEach((row, rowIdx) => {
    if (row.kind === 'section') {
      const r = ws.addRow([row.label]);
      r.font = { bold: true };
      return;
    }
    ws.addRow([
      row.label,
      ...dayLabels.map((_dl, i) => dayValue(templateRows, values, rowIdx, i)),
      rowTotal(templateRows, values, rowIdx, dayLabels.length),
    ]);
  });

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf, filename, XLSX_MIME);
}

/** Generate a bare template .xlsx from a row structure (for download). */
export async function exportTemplateXlsx(
  template: ForecastTemplate,
  numDays = 31,
): Promise<void> {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Template');
  ws.addRow(['Cash Flow Category', ...Array.from({ length: numDays }, (_v, i) => `D${i + 1}`)]);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(1).width = 28;
  template.rows.forEach((row) => {
    const r = ws.addRow([row.label]);
    if (row.kind !== 'data') r.font = { bold: true };
  });
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf, `${template.name.replace(/\s+/g, '-')}.xlsx`, XLSX_MIME);
}

// ---------------------------------------------------------------------------
// Tabular exports (dashboard Export modal) in xlsx / csv / json.
// ---------------------------------------------------------------------------
export type TableExport = { name: string; header: string[]; rows: (string | number)[][] };

export function cyclesTable(cycles: Cycle[]): TableExport {
  return {
    name: 'Cycles',
    header: ['Cycle ID', 'Period', 'Closes', 'Status', 'Submissions', 'Total (€M)'],
    rows: cycles.map((c) => [c.id, `${c.start} → +30d`, c.closes, c.status, c.subs, c.total]),
  };
}

export function submissionsTable(subs: Submission[]): TableExport {
  return {
    name: 'Submissions',
    header: ['Period', 'Entity', 'Template', 'Status', 'Flags', 'Updated'],
    rows: subs.map((s) => [
      s.period,
      s.entity,
      s.templateId,
      s.status,
      s.flags.length,
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
  ws.addRow(table.header);
  ws.getRow(1).font = { bold: true };
  table.rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf, `${baseName}.xlsx`, XLSX_MIME);
}
