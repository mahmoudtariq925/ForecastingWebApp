import { useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { ForecastGrid } from './ForecastGrid';
import type { GridValues } from './gridMath';
import { entities, generateGridValues, seedFor, STANDARD_TEMPLATE_ID } from '../../data/mockData';
import {
  dayLabelsForPeriod,
  DEFAULT_PERIOD,
  listPeriods,
  periodLabel,
  prevPeriodKey,
} from '../../data/periods';
import {
  getOrCreateSubmission,
  getPriorValues,
  isVariance,
  templatesForEntity,
} from '../../data/submissionService';
import {
  loadSettings,
  loadSubmission,
  loadTemplates,
  periodsWithSubmissions,
  saveSubmission,
} from '../../storage/localStorage';
import { exportGridXlsx, parseValuesFile } from '../../utils/excel';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { ForecastTemplate, SubmissionStatus } from '../../types';

export function Submission() {
  const templates = useMemo(() => loadTemplates(), []);
  const [entity, setEntity] = useState(entities[0]?.name ?? 'Netherlands');
  const [period, setPeriod] = useState(DEFAULT_PERIOD);

  const available = templatesForEntity(templates, entity);
  const [templateId, setTemplateId] = useState(available[0]?.id ?? '');
  const template =
    available.find((t) => t.id === templateId) ?? available[0] ?? null;

  // Periods that already hold a saved submission for this entity (history).
  const savedPeriods = useMemo(() => periodsWithSubmissions(entity), [entity]);

  if (!template) {
    return (
      <div className="view active">
        <TopBar crumb="Submission" title="30-Day Forecast Entry" />
        <div className="content">
          <div className="panel">
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No forecast templates available. Upload one under Admin → Templates.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view active">
      {/* Remount the grid whenever the selection changes so state reloads. */}
      <SubmissionEditor
        key={`${entity}:${period}:${template.id}`}
        entity={entity}
        period={period}
        template={template}
        selectors={
          <>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              aria-label="Entity"
            >
              {entities.map((en) => (
                <option key={en.name} value={en.name}>
                  {en.name}
                </option>
              ))}
            </select>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Reporting period"
            >
              {listPeriods().map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {savedPeriods.has(p.key) ? ' ●' : ''}
                </option>
              ))}
            </select>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={template.id}
              onChange={(e) => setTemplateId(e.target.value)}
              aria-label="Forecast template"
            >
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </>
        }
      />
    </div>
  );
}

interface VarianceCell {
  key: string;
  label: string;
  day: number;
  prior: number;
  current: number;
}

interface EditorProps {
  entity: string;
  period: string;
  template: ForecastTemplate;
  selectors: React.ReactNode;
}

function SubmissionEditor({ entity, period, template, selectors }: EditorProps) {
  const settings = useMemo(() => loadSettings(DEFAULT_SETTINGS), []);
  const dayLabels = useMemo(() => dayLabelsForPeriod(period), [period]);
  const numDays = dayLabels.length;

  const prior = useMemo(
    () => getPriorValues(entity, period, template),
    [entity, period, template],
  );
  const initial = useMemo(
    () => getOrCreateSubmission(entity, period, template),
    [entity, period, template],
  );

  const [values, setValues] = useState<GridValues>(initial.values);
  const [flags, setFlags] = useState<Set<string>>(new Set(initial.flags));
  const [comments, setComments] = useState<Record<string, string>>(initial.comments ?? {});
  const [status, setStatus] = useState<SubmissionStatus>(initial.status);
  const [varianceCell, setVarianceCell] = useState<VarianceCell | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const importInput = useRef<HTMLInputElement>(null);

  const persist = (
    v: GridValues = values,
    f: Set<string> = flags,
    c: Record<string, string> = comments,
    s: SubmissionStatus = status,
  ) => {
    saveSubmission({
      period,
      entity,
      templateId: template.id,
      status: s,
      values: v,
      flags: [...f],
      comments: c,
      updatedAt: new Date().toISOString(),
    });
  };

  const reflag = (v: GridValues, keys: Iterable<string>, base: Set<string>): Set<string> => {
    const next = new Set(base);
    for (const key of keys) {
      if (isVariance(v[key] || 0, prior[key] || 0, settings)) next.add(key);
      else next.delete(key);
    }
    return next;
  };

  const setCell = (rowIdx: number, dayIdx: number, value: number) => {
    const key = `${rowIdx}-${dayIdx}`;
    const nextValues = { ...values, [key]: value };
    const nextFlags = reflag(nextValues, [key], flags);
    setValues(nextValues);
    setFlags(nextFlags);
    persist(nextValues, nextFlags);
  };

  const handlePaste = (
    startRow: number,
    startDay: number,
    e: ClipboardEvent<HTMLInputElement>,
  ) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const grid = text.trim().split(/\r?\n/).map((r) => r.split(/\t/));
    const nextValues = { ...values };
    const touched: string[] = [];
    grid.forEach((cols, ri) => {
      cols.forEach((raw, ci) => {
        const rowIdx = startRow + ri;
        const dayIdx = startDay + ci;
        if (dayIdx >= numDays) return;
        if (template.rows[rowIdx]?.kind !== 'data') return;
        const n = Number(raw.replace(/[€$,\s]/g, ''));
        if (!Number.isFinite(n)) return;
        const key = `${rowIdx}-${dayIdx}`;
        nextValues[key] = n;
        touched.push(key);
      });
    });
    const nextFlags = reflag(nextValues, touched, flags);
    setValues(nextValues);
    setFlags(nextFlags);
    persist(nextValues, nextFlags);
  };

  const applyValues = (v: GridValues, f: Set<string>) => {
    setValues(v);
    setFlags(f);
    persist(v, f);
  };

  const reset = () => {
    if (!confirm('Reset all values?')) return;
    if (template.id === STANDARD_TEMPLATE_ID) {
      const { values: v, flags: f } = generateGridValues(
        template.rows,
        period,
        seedFor(`${entity}:${period}`),
        true,
      );
      applyValues(v, new Set(f));
    } else {
      applyValues({}, new Set());
    }
  };

  const copyPrior = () => {
    const prevKey = prevPeriodKey(period);
    const hasStored = loadSubmission(prevKey, entity, template.id) !== null;
    applyValues({ ...prior }, new Set());
    alert(
      hasStored
        ? `Copied your saved ${periodLabel(prevKey)} submission. Edit as needed.`
        : `Loaded prior-period values for ${periodLabel(prevKey)}. Edit as needed.`,
    );
  };

  const handleImport = async (file: File) => {
    try {
      const { values: imported, matched } = await parseValuesFile(file, template.rows, numDays);
      const nextValues = { ...values, ...imported };
      const nextFlags = reflag(nextValues, Object.keys(imported), flags);
      applyValues(nextValues, nextFlags);
      alert(`Imported ${matched} line item${matched === 1 ? '' : 's'} from ${file.name}.`);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openVariance = (rowIdx: number, dayIdx: number) => {
    const key = `${rowIdx}-${dayIdx}`;
    setCommentDraft(comments[key] ?? '');
    setVarianceCell({
      key,
      label: template.rows[rowIdx]?.label ?? '',
      day: dayIdx + 1,
      prior: prior[key] || 0,
      current: values[key] || 0,
    });
  };

  const saveComment = () => {
    if (!varianceCell) return;
    const nextComments = { ...comments, [varianceCell.key]: commentDraft.trim() };
    if (!commentDraft.trim()) delete nextComments[varianceCell.key];
    setComments(nextComments);
    persist(values, flags, nextComments);
    setVarianceCell(null);
  };

  const uncommented = [...flags].filter((k) => !comments[k]?.trim());

  const submit = () => {
    if (uncommented.length > 0) {
      if (
        confirm(
          `${uncommented.length} flagged cell${uncommented.length === 1 ? '' : 's'} still need commentary. Add it now?`,
        )
      ) {
        const [rowIdx, dayIdx] = uncommented[0].split('-').map(Number);
        openVariance(rowIdx, dayIdx);
        return;
      }
    }
    setStatus('submitted');
    persist(values, flags, comments, 'submitted');
    alert('Forecast submitted for approval.');
  };

  const exportGrid = () => {
    exportGridXlsx(
      template.rows,
      dayLabels,
      values,
      `${entity.replace(/\s+/g, '-')}-${period}-forecast.xlsx`,
      periodLabel(period),
    ).catch((err) => alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  const varianceDelta = varianceCell
    ? ((varianceCell.current - varianceCell.prior) /
        Math.max(Math.abs(varianceCell.prior), 1)) *
      100
    : 0;

  return (
    <>
      <TopBar
        crumb={`Submission · ${periodLabel(period)} · ${entity}`}
        title="Forecast Entry"
        actions={
          <>
            <StatusPill status={status === 'draft' ? 'submitted' : status} label={status} />
            <button className="btn btn-ghost" onClick={() => persist()}>
              Save Draft
            </button>
            <button className="btn btn-primary" onClick={submit}>
              Submit for Approval
            </button>
          </>
        }
      />
      <div className="content">
        {flags.size > 0 && (
          <div className="variance-panel">
            <h4>⚠ Variance Flags Detected</h4>
            <div className="row">
              <span>
                Cells exceeding ±{settings.varianceThreshold}% vs prior period require commentary
                before submission. Click a flagged cell to explain it.
              </span>
              <span>
                {flags.size} flagged · {uncommented.length} need commentary
              </span>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-toolbar-left">
              {selectors}
              <span className="paste-hint">⌘V · Paste from Excel supported</span>
            </div>
            <div className="row-flex">
              <button className="btn btn-ghost" onClick={() => importInput.current?.click()}>
                Import Excel
              </button>
              <button className="btn btn-ghost" onClick={exportGrid}>
                Export Excel
              </button>
              <button className="btn btn-ghost" onClick={copyPrior}>
                Copy Prior Forecast
              </button>
              <button className="btn btn-ghost" onClick={reset}>
                Reset
              </button>
              <input
                ref={importInput}
                type="file"
                accept=".xlsx"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImport(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <div className="grid-toolbar" style={{ borderTop: 'none' }}>
            <div className="grid-info">
              <strong>{template.name}</strong> ·{' '}
              <span className="text-muted">
                EUR · Daily values in thousands · {numDays} days
              </span>
            </div>
          </div>
          <div className="forecast-grid-wrap">
            <ForecastGrid
              rows={template.rows}
              dayLabels={dayLabels}
              values={values}
              flags={flags}
              editable
              onChangeCell={setCell}
              onPaste={handlePaste}
              onCellClick={openVariance}
            />
          </div>
        </div>
      </div>

      <Modal
        open={varianceCell !== null}
        title="Explain Variance"
        onClose={() => setVarianceCell(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setVarianceCell(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveComment}>
              Save
            </button>
          </>
        }
      >
        {varianceCell && (
          <>
            <div className="variance-panel" style={{ marginBottom: 18 }}>
              <h4>Flagged Cell</h4>
              <div className="row">
                <span>
                  {varianceCell.label} · Day {varianceCell.day}
                </span>
                <span>
                  {varianceDelta > 0 ? '+' : ''}
                  {varianceDelta.toFixed(1)}%
                </span>
              </div>
              <div className="row">
                <span>Prior: €{varianceCell.prior.toLocaleString()}k</span>
                <span>Current: €{varianceCell.current.toLocaleString()}k</span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Commentary (required)</label>
              <textarea
                className="form-textarea"
                placeholder="Explain the driver behind this variance..."
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
