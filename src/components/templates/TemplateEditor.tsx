import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { TopBar } from '../layout/TopBar';
import { useDialog } from '../common/dialogContext';
import { ForecastGrid } from '../submissions/ForecastGrid';
import { currentWeekKey, periodsOf, templateDayLabels } from '../../data/periods';
import { currentUser } from '../../data/session';
import {
  categoriesFromRows,
  categoryIndexByRow,
  makeRow,
  rowsFromCategories,
  structureSummary,
  type EditorRow,
  type EditorRowKind,
} from './templateRows';
import type {
  ForecastTemplate,
  PeriodGranularity,
  TemplateLayout,
} from '../../types';

const EMPTY_FLAGS = new Set<string>();

const GRANULARITIES: { value: PeriodGranularity; label: string }[] = [
  { value: 'day', label: 'Working days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
];

const ROW_KIND_LABELS: Record<EditorRowKind, string> = {
  section: 'Section',
  item: 'Line item',
  subtotal: 'Subtotal',
};

/** A blank template to start a new one from. */
function starterRows(): EditorRow[] {
  return [
    makeRow('section', 'Operating'),
    makeRow('item', 'Customer Receipts'),
    makeRow('item', 'Supplier Payments'),
    makeRow('subtotal', 'Operating Net'),
    makeRow('item', 'Other'),
  ];
}

interface TemplateEditorProps {
  /** Template being edited; omit to author a new one. */
  template?: ForecastTemplate | null;
  onSave: (template: ForecastTemplate) => void;
  onCancel: () => void;
}

/**
 * Spreadsheet-style template editor: rows are the forecast structure
 * (sections, line items, computed subtotals) and columns are the forecast
 * periods. Cells hold optional starting values that new submissions are
 * seeded with. Saving produces exactly the same `ForecastTemplate` shape an
 * uploaded .xlsx does, so both authoring routes stay interchangeable.
 */
export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const { confirm, notify } = useDialog();
  const week = currentWeekKey();

  const [name, setName] = useState(template?.name ?? 'New Forecast Template');
  const [description, setDescription] = useState(template?.description ?? '');
  const [layout, setLayout] = useState<TemplateLayout>(template?.layout ?? 'days-across');
  const [rows, setRows] = useState<EditorRow[]>(() =>
    template ? rowsFromCategories(template.categories) : starterRows(),
  );
  const initialPeriods = periodsOf(template);
  const [periodCount, setPeriodCount] = useState(initialPeriods.count);
  const [granularity, setGranularity] = useState<PeriodGranularity>(initialPeriods.granularity);
  const [values, setValues] = useState<Record<string, number>>(
    () => ({ ...(template?.defaultValues ?? {}) }),
  );
  const [preview, setPreview] = useState(false);
  const labelRefs = useRef(new Map<string, HTMLInputElement>());

  const previewTemplate = useMemo<ForecastTemplate>(
    () => ({
      id: template?.id ?? 'draft',
      name: name.trim() || 'Untitled template',
      uploadedAt: template?.uploadedAt ?? new Date().toISOString(),
      uploadedBy: template?.uploadedBy ?? currentUser().name,
      assignedEntities: template?.assignedEntities ?? [],
      layout,
      categories: categoriesFromRows(rows),
      periods: { count: periodCount, granularity },
      defaultValues: values,
      description: description.trim() || undefined,
      builtInEditor: true,
    }),
    [template, name, layout, rows, periodCount, granularity, values, description],
  );

  const dayLabels = useMemo(
    () => templateDayLabels(previewTemplate, week),
    [previewTemplate, week],
  );
  const catIdxByRow = useMemo(() => categoryIndexByRow(rows), [rows]);

  // ---- Row operations -----------------------------------------------------
  const updateRow = (id: string, patch: Partial<EditorRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const insertRow = (index: number, kind: EditorRowKind) => {
    const row = makeRow(kind);
    setRows((prev) => [...prev.slice(0, index), row, ...prev.slice(index)]);
    // Focus the new row's label once it has rendered.
    requestAnimationFrame(() => labelRefs.current.get(row.id)?.focus());
  };

  const removeRow = (index: number) =>
    setRows((prev) => prev.filter((_r, i) => i !== index));

  const moveRow = (index: number, delta: number) =>
    setRows((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const onLabelKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertRow(index + 1, rows[index].kind === 'section' ? 'item' : rows[index].kind);
    } else if (e.key === 'ArrowDown' && rows[index + 1]) {
      e.preventDefault();
      labelRefs.current.get(rows[index + 1].id)?.focus();
    } else if (e.key === 'ArrowUp' && rows[index - 1]) {
      e.preventDefault();
      labelRefs.current.get(rows[index - 1].id)?.focus();
    }
  };

  // ---- Column operations --------------------------------------------------
  const addPeriod = () => setPeriodCount((n) => Math.min(n + 1, 120));

  const removePeriod = (periodIdx: number) => {
    if (periodCount <= 1) return;
    // Drop the column's values and shift later columns down one index so the
    // stored keys keep matching the visible grid.
    setValues((prev) => {
      const next: Record<string, number> = {};
      for (const [key, v] of Object.entries(prev)) {
        const [c, d] = key.split('-').map(Number);
        if (d === periodIdx) continue;
        next[`${c}-${d > periodIdx ? d - 1 : d}`] = v;
      }
      return next;
    });
    setPeriodCount((n) => n - 1);
  };

  const setCell = (catIdx: number, periodIdx: number, raw: string) => {
    const n = Number(raw.replace(/[€$,\s]/g, ''));
    setValues((prev) => {
      const next = { ...prev };
      if (!raw.trim() || !Number.isFinite(n) || n === 0) delete next[`${catIdx}-${periodIdx}`];
      else next[`${catIdx}-${periodIdx}`] = n;
      return next;
    });
  };

  // ---- Save ---------------------------------------------------------------
  const save = async () => {
    const categories = categoriesFromRows(rows);
    if (!name.trim()) {
      await notify({ tone: 'error', message: 'Give the template a name before saving.' });
      return;
    }
    if (categories.filter((c) => !c.subtotal).length === 0) {
      await notify({
        tone: 'error',
        message: 'Add at least one line item — a template needs something to forecast.',
      });
      return;
    }
    const blanks = rows.filter((r) => !r.label.trim()).length;
    if (blanks > 0) {
      const ok = await confirm({
        title: 'Blank rows',
        message: `${blanks} row${blanks === 1 ? ' has' : 's have'} no label and will be dropped. Save anyway?`,
        confirmLabel: 'Save Template',
      });
      if (!ok) return;
    }
    onSave({
      ...previewTemplate,
      id: template?.id ?? `tpl-${Date.now()}`,
      name: name.trim(),
      categories,
      uploadedAt: new Date().toISOString(),
      uploadedBy: template?.uploadedBy ?? currentUser().name,
      // A structure authored here supersedes any previously uploaded file.
      fileName: template?.builtInEditor === false ? template.fileName : undefined,
    });
  };

  const cancel = async () => {
    const ok = await confirm({
      title: 'Discard changes',
      message: 'Close the editor without saving? Any changes to this template are lost.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok) onCancel();
  };

  const summary = structureSummary(rows);

  return (
    <div className="view active">
      <TopBar
        crumb={`Administration · ${template ? 'Edit Template' : 'New Template'}`}
        title="Template Builder"
        actions={
          <>
            <span className="tag">{summary}</span>
            <button
              className={`btn ${preview ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPreview((p) => !p)}
            >
              {preview ? 'Back to Editing' : 'Preview'}
            </button>
            <button className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save}>
              Save Template
            </button>
          </>
        }
      />
      <div className="content">
        {/* ---------- Template settings ---------- */}
        <div className="panel">
          <div className="panel-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Template Name</label>
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="Template name"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description (optional)</label>
                <input
                  className="form-input"
                  placeholder="e.g. Weekly direct cash flow for EU entities"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Default Orientation</label>
                <select
                  className="form-select"
                  value={layout}
                  onChange={(e) => setLayout(e.target.value as TemplateLayout)}
                  aria-label="Default orientation"
                >
                  <option value="days-across">Dates across columns</option>
                  <option value="grouped">Dates down rows</option>
                </select>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Submitters can flip this at any time on the forecast screen.
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Forecast Periods</label>
                <div className="row-flex">
                  <input
                    className="form-input"
                    style={{ width: 90, textAlign: 'right', fontFamily: 'var(--mono)' }}
                    value={periodCount}
                    aria-label="Number of periods"
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, ''));
                      setPeriodCount(Math.max(1, Math.min(Number.isFinite(n) ? n : 1, 120)));
                    }}
                  />
                  <select
                    className="form-select"
                    style={{ width: 'auto' }}
                    value={granularity}
                    onChange={(e) => setGranularity(e.target.value as PeriodGranularity)}
                    aria-label="Period granularity"
                  >
                    {GRANULARITIES.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Columns run from the Monday of the forecast week.
                </div>
              </div>
            </div>
          </div>
        </div>

        {preview ? (
          <>
            <div className="section-header">
              <h2>Preview</h2>
              <span className="tag">exactly how submitters will see it</span>
            </div>
            <div className="panel">
              <div className="grid-toolbar">
                <div className="grid-info">
                  <strong>{previewTemplate.name}</strong> ·{' '}
                  <span className="text-muted">
                    {summary} · {periodCount} {granularity} period
                    {periodCount === 1 ? '' : 's'} · read-only preview
                  </span>
                </div>
              </div>
              <div className="forecast-grid-wrap">
                <ForecastGrid
                  categories={previewTemplate.categories}
                  layout={layout}
                  dayLabels={dayLabels}
                  values={values}
                  flags={EMPTY_FLAGS}
                  startingBalance={0}
                  editable={false}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="section-header">
              <h2>Structure</h2>
              <span className="tag">
                click a cell to edit · Enter adds a row · values seed new forecasts
              </span>
            </div>
            <div className="panel">
              <div className="forecast-grid-wrap">
                <table className="forecast-grid sheet-grid">
                  <thead>
                    <tr>
                      <th className="sheet-gutter-h" />
                      <th className="row-label-h">Row Label</th>
                      {Array.from({ length: periodCount }, (_v, i) => (
                        <th key={i} className="day-h">
                          <div className="sheet-col-head">
                            <span>
                              P{i + 1}
                              <span className="dow">{dayLabels[i]?.dm ?? ''}</span>
                            </span>
                            {periodCount > 1 && (
                              <button
                                className="chip-remove"
                                title={`Remove period ${i + 1}`}
                                aria-label={`Remove period ${i + 1}`}
                                onClick={() => removePeriod(i)}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="day-h">
                        <button className="sheet-add-col" onClick={addPeriod} title="Add a period">
                          + Period
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const catIdx = catIdxByRow[index];
                      const isSection = row.kind === 'section';
                      const isSubtotal = row.kind === 'subtotal';
                      return (
                        <tr key={row.id} className={isSection ? 'section-row' : undefined}>
                          <td className="sheet-gutter">
                            <div className="sheet-row-actions">
                              <button
                                title="Move up"
                                aria-label="Move row up"
                                disabled={index === 0}
                                onClick={() => moveRow(index, -1)}
                              >
                                ↑
                              </button>
                              <button
                                title="Move down"
                                aria-label="Move row down"
                                disabled={index === rows.length - 1}
                                onClick={() => moveRow(index, 1)}
                              >
                                ↓
                              </button>
                              <button
                                title="Delete row"
                                aria-label="Delete row"
                                className="danger"
                                onClick={() => removeRow(index)}
                              >
                                ×
                              </button>
                            </div>
                          </td>
                          <td className={`row-label ${isSubtotal ? 'subtotal' : ''}`}>
                            <div className="sheet-label-cell">
                              <select
                                className="sheet-kind"
                                value={row.kind}
                                aria-label={`Row ${index + 1} type`}
                                onChange={(e) =>
                                  updateRow(row.id, { kind: e.target.value as EditorRowKind })
                                }
                              >
                                {(Object.keys(ROW_KIND_LABELS) as EditorRowKind[]).map((k) => (
                                  <option key={k} value={k}>
                                    {ROW_KIND_LABELS[k]}
                                  </option>
                                ))}
                              </select>
                              <input
                                ref={(el) => {
                                  if (el) labelRefs.current.set(row.id, el);
                                  else labelRefs.current.delete(row.id);
                                }}
                                className="sheet-label-input"
                                value={row.label}
                                placeholder={
                                  isSection
                                    ? 'Section name…'
                                    : isSubtotal
                                      ? 'Subtotal name…'
                                      : 'Line item name…'
                                }
                                onChange={(e) => updateRow(row.id, { label: e.target.value })}
                                onKeyDown={(e) => onLabelKeyDown(e, index)}
                              />
                            </div>
                          </td>
                          {Array.from({ length: periodCount }, (_v, p) => {
                            if (isSection) return <td key={p} className="cell" />;
                            if (isSubtotal || catIdx === null) {
                              return (
                                <td key={p} className="cell subtotal-cell">
                                  {isSubtotal ? 'auto' : '—'}
                                </td>
                              );
                            }
                            const val = values[`${catIdx}-${p}`];
                            return (
                              <td key={p} className="cell">
                                <input
                                  value={val === undefined ? '' : val}
                                  placeholder="0"
                                  aria-label={`${row.label || `Row ${index + 1}`} period ${p + 1}`}
                                  onChange={(e) => setCell(catIdx, p, e.target.value)}
                                />
                              </td>
                            );
                          })}
                          <td className="cell" />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid-toolbar" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="row-flex">
                  <button
                    className="btn btn-ghost"
                    onClick={() => insertRow(rows.length, 'item')}
                  >
                    + Line Item
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => insertRow(rows.length, 'section')}
                  >
                    + Section
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => insertRow(rows.length, 'subtotal')}
                  >
                    + Subtotal
                  </button>
                </div>
                <div className="grid-info">
                  <span className="text-muted">
                    Subtotals sum the line items above them within their section — they are
                    computed, never typed.
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
