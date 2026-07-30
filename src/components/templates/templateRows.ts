// ============================================================================
// Conversion between the flat template contract (`TemplateCategory[]`, where
// a section is just a `group` label repeated on its members) and the row list
// the spreadsheet editor works with (where a section is its own row).
//
// Keeping this outside the component means both authoring paths — Excel
// upload and the in-browser editor — produce exactly the same structure, and
// the mapping is testable on its own.
// ============================================================================
import type { TemplateCategory } from '../../types';

export type EditorRowKind = 'section' | 'item' | 'subtotal';

export interface EditorRow {
  /** Stable key for React and for cell focus, not persisted. */
  id: string;
  kind: EditorRowKind;
  label: string;
}

let seq = 0;
export function newRowId(): string {
  seq += 1;
  return `r${seq}-${Math.round(performance.now() * 1000)}`;
}

export function makeRow(kind: EditorRowKind, label = ''): EditorRow {
  return { id: newRowId(), kind, label };
}

/** Expand stored categories into editor rows, re-creating section rows. */
export function rowsFromCategories(categories: TemplateCategory[]): EditorRow[] {
  const rows: EditorRow[] = [];
  let currentGroup: string | undefined;
  for (const cat of categories) {
    if (cat.group && cat.group !== currentGroup) {
      rows.push(makeRow('section', cat.group));
      currentGroup = cat.group;
    } else if (!cat.group) {
      currentGroup = undefined;
    }
    rows.push(makeRow(cat.subtotal ? 'subtotal' : 'item', cat.label));
  }
  return rows;
}

/** Flatten editor rows back into the stored category contract. */
export function categoriesFromRows(rows: EditorRow[]): TemplateCategory[] {
  const out: TemplateCategory[] = [];
  let currentGroup: string | undefined;
  for (const row of rows) {
    if (row.kind === 'section') {
      currentGroup = row.label.trim() || undefined;
      continue;
    }
    const label = row.label.trim();
    if (!label) continue; // blank rows are dropped on save
    out.push({
      label,
      ...(currentGroup ? { group: currentGroup } : {}),
      ...(row.kind === 'subtotal' ? { subtotal: true as const } : {}),
    });
  }
  return out;
}

/**
 * Category index for each editor row (section rows and blank rows have none),
 * so the editor can address `${catIdx}-${periodIdx}` default values exactly
 * the way submissions do.
 */
export function categoryIndexByRow(rows: EditorRow[]): (number | null)[] {
  let catIdx = 0;
  return rows.map((row) =>
    row.kind === 'section' || !row.label.trim() ? null : catIdx++,
  );
}

/**
 * Move a row from one index to another (drag-and-drop reorder), returning a
 * new list. Splice-based rather than swap-based so a row dragged several
 * places lands exactly where it was dropped.
 */
export function reorderRows(rows: EditorRow[], from: number, to: number): EditorRow[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to > rows.length) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(from < to ? to - 1 : to, 0, moved);
  return next;
}

/**
 * The rows a section owns: everything after it up to the next section. Used
 * to give a new section its own subtotal and to shade a section's span.
 */
export function sectionSpan(rows: EditorRow[], sectionIdx: number): number[] {
  if (rows[sectionIdx]?.kind !== 'section') return [];
  const out: number[] = [];
  for (let i = sectionIdx + 1; i < rows.length; i++) {
    if (rows[i].kind === 'section') break;
    out.push(i);
  }
  return out;
}

/**
 * Index of the section each row belongs to (-1 = outside any section), so the
 * canvas can band alternating sections in either orientation.
 */
export function sectionIndexByRow(rows: EditorRow[]): number[] {
  let section = -1;
  return rows.map((row) => {
    if (row.kind === 'section') section += 1;
    return section;
  });
}

/** Human summary used in the editor header and the template list. */
export function structureSummary(rows: EditorRow[]): string {
  const items = rows.filter((r) => r.kind === 'item' && r.label.trim()).length;
  const sections = rows.filter((r) => r.kind === 'section' && r.label.trim()).length;
  const subtotals = rows.filter((r) => r.kind === 'subtotal' && r.label.trim()).length;
  const parts = [`${items} line item${items === 1 ? '' : 's'}`];
  if (sections) parts.push(`${sections} section${sections === 1 ? '' : 's'}`);
  if (subtotals) parts.push(`${subtotals} subtotal${subtotals === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
