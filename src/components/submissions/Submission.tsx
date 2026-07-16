import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { ErrorView, LoadingView } from '../common/Async';
import { ForecastGrid } from './ForecastGrid';
import { cellKey, type GridValues } from './gridMath';
import { generateGridValues, seedFor, STANDARD_TEMPLATE_ID } from '../../data/demoData';
import {
  currentWeekKey,
  dayLabelsForWeek,
  horizonDates,
  HORIZON_DAYS,
  HORIZON_WEEKS,
  listYears,
  monthName,
  prevWeekKey,
  weekLabel,
  weekLabelShort,
  weeksInMonth,
  weekYearMonth,
} from '../../data/periods';
import {
  getOrCreateSubmission,
  getPriorValues,
  isVariance,
  priorValueFor,
  templatesForEntity,
} from '../../data/submissionService';
import { useApi } from '../../hooks/useApi';
import {
  getEntities,
  getSettings,
  getTemplates,
  listSubmissions,
  putSubmission,
} from '../../api/resources';
import { exportSubmissionXlsx, parseValuesFile } from '../../utils/excel';
import type { ForecastTemplate, Settings, Submission as SubmissionModel, SubmissionStatus } from '../../types';

export function Submission() {
  const base = useApi(() => Promise.all([getEntities(), getTemplates(), getSettings()]));
  const [entity, setEntity] = useState<string | null>(null);
  const [week, setWeek] = useState(currentWeekKey());
  const [templateId, setTemplateId] = useState<string | null>(null);

  // Weeks that already hold a saved submission for this entity (history dots).
  const saved = useApi(
    () => (entity ? listSubmissions({ entity }) : Promise.resolve([])),
    [entity, base.data],
  );

  if (base.error)
    return <ErrorView crumb="Submission" title="Forecast Entry" message={base.error} onRetry={base.reload} />;
  if (!base.data) return <LoadingView crumb="Submission" title="Forecast Entry" />;

  const [entities, templates, settings] = base.data;
  const activeEntity = entity ?? entities[0]?.name ?? '';
  const available = templatesForEntity(templates, activeEntity);
  const template = available.find((t) => t.id === templateId) ?? available[0] ?? null;
  const savedWeeks = new Set((saved.data ?? []).map((s) => s.period));

  const { year, month } = weekYearMonth(week);
  const weekOptions = weeksInMonth(year, month);
  const setYearMonth = (y: number, m: number) => {
    const weeks = weeksInMonth(y, m);
    if (weeks.length > 0) setWeek(weeks[0]);
  };

  if (!template) {
    return (
      <div className="view active">
        <TopBar crumb="Submission" title="Forecast Entry" />
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
      {/* Remount the loader whenever the selection changes so data reloads. */}
      <SubmissionLoader
        key={`${activeEntity}:${week}:${template.id}`}
        entity={activeEntity}
        week={week}
        template={template}
        settings={settings}
        onSaved={saved.reload}
        selectors={
          <>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={activeEntity}
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
              value={year}
              onChange={(e) => setYearMonth(Number(e.target.value), month)}
              aria-label="Year"
            >
              {listYears().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={month}
              onChange={(e) => setYearMonth(year, Number(e.target.value))}
              aria-label="Month"
            >
              {Array.from({ length: 12 }, (_v, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              aria-label="Week"
            >
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w)}
                  {savedWeeks.has(w) ? ' ●' : ''}
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

interface LoaderProps {
  entity: string;
  week: string;
  template: ForecastTemplate;
  settings: Settings;
  selectors: React.ReactNode;
  onSaved: () => void;
}

/** Fetches (or creates) the submission + prior-week values, then renders the editor. */
function SubmissionLoader(props: LoaderProps) {
  const { entity, week, template } = props;
  const { data, error, loading, reload } = useApi(
    () =>
      Promise.all([
        getOrCreateSubmission(entity, week, template),
        getPriorValues(entity, week, template),
      ]),
    [],
  );
  const crumb = `Submission · ${weekLabelShort(week)} · ${entity}`;
  if (error) return <ErrorView crumb={crumb} title="Forecast Entry" message={error} onRetry={reload} />;
  if (loading || !data) return <LoadingView crumb={crumb} title="Forecast Entry" />;
  return <SubmissionEditor {...props} initial={data[0]} prior={data[1]} />;
}

interface VarianceCell {
  key: string;
  label: string;
  day: number;
  prior: number | null;
  current: number;
}

interface EditorProps extends LoaderProps {
  initial: SubmissionModel;
  prior: { values: GridValues; stored: boolean };
}

function SubmissionEditor({
  entity,
  week,
  template,
  settings,
  selectors,
  onSaved,
  initial,
  prior,
}: EditorProps) {
  const dates = useMemo(() => horizonDates(week), [week]);
  const dayLabels = useMemo(() => dayLabelsForWeek(week), [week]);
  const numCats = template.categories.length;

  const [values, setValues] = useState<GridValues>(initial.values);
  const [flags, setFlags] = useState<Set<string>>(new Set(initial.flags));
  const [comments, setComments] = useState<Record<string, string>>(initial.comments ?? {});
  const [dayComments, setDayComments] = useState<Record<string, string>>(
    initial.dayComments ?? {},
  );
  const [startingBalance, setStartingBalance] = useState<number>(initial.startingBalance ?? 0);
  const [status, setStatus] = useState<SubmissionStatus>(initial.status);
  const [varianceCell, setVarianceCell] = useState<VarianceCell | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const importInput = useRef<HTMLInputElement>(null);

  // Debounced persistence: edits update `latest` immediately, the PUT is
  // batched; Save Draft / Submit flush right away.
  const latest = useRef<SubmissionModel>(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const firstSave = useRef(true);
  useEffect(() => () => clearTimeout(timer.current), []);

  interface Snapshot {
    values?: GridValues;
    flags?: Set<string>;
    comments?: Record<string, string>;
    dayComments?: Record<string, string>;
    startingBalance?: number;
    status?: SubmissionStatus;
  }
  const persist = (snap: Snapshot = {}, immediate = false) => {
    latest.current = {
      period: week,
      entity,
      templateId: template.id,
      status: snap.status ?? status,
      values: snap.values ?? values,
      flags: [...(snap.flags ?? flags)],
      comments: snap.comments ?? comments,
      dayComments: snap.dayComments ?? dayComments,
      startingBalance: snap.startingBalance ?? startingBalance,
      updatedAt: new Date().toISOString(),
    };
    clearTimeout(timer.current);
    const run = () =>
      putSubmission(latest.current)
        .then(() => {
          if (firstSave.current) {
            firstSave.current = false;
            onSaved();
          }
        })
        .catch((err) =>
          console.error('Saving submission failed:', err instanceof Error ? err.message : err),
        );
    if (immediate) run();
    else timer.current = setTimeout(run, 400);
  };

  const reflag = (v: GridValues, keys: Iterable<string>, base: Set<string>): Set<string> => {
    const next = new Set(base);
    for (const key of keys) {
      const [c, d] = key.split('-').map(Number);
      if (isVariance(v[key] || 0, priorValueFor(prior.values, c, d), settings)) next.add(key);
      else next.delete(key);
    }
    return next;
  };

  const setCell = (catIdx: number, dayIdx: number, value: number) => {
    const key = cellKey(catIdx, dayIdx);
    const nextValues = { ...values, [key]: value };
    const nextFlags = reflag(nextValues, [key], flags);
    setValues(nextValues);
    setFlags(nextFlags);
    persist({ values: nextValues, flags: nextFlags });
  };

  const handlePaste = (
    startCat: number,
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
        // Pasted rows/cols follow the on-screen orientation.
        const catIdx = template.layout === 'grouped' ? startCat + ci : startCat + ri;
        const dayIdx = template.layout === 'grouped' ? startDay + ri : startDay + ci;
        if (catIdx >= numCats || dayIdx >= HORIZON_DAYS) return;
        const n = Number(raw.replace(/[€$,\s]/g, ''));
        if (!Number.isFinite(n)) return;
        const key = cellKey(catIdx, dayIdx);
        nextValues[key] = n;
        touched.push(key);
      });
    });
    const nextFlags = reflag(nextValues, touched, flags);
    setValues(nextValues);
    setFlags(nextFlags);
    persist({ values: nextValues, flags: nextFlags });
  };

  const setDayComment = (dayIdx: number, comment: string) => {
    const next = { ...dayComments, [String(dayIdx)]: comment };
    if (!comment) delete next[String(dayIdx)];
    setDayComments(next);
    persist({ dayComments: next });
  };

  const setBalance = (v: number) => {
    setStartingBalance(v);
    persist({ startingBalance: v });
  };

  const reset = () => {
    if (!confirm('Reset all values?')) return;
    if (template.id === STANDARD_TEMPLATE_ID) {
      const { values: v, flags: f } = generateGridValues(
        template.categories,
        week,
        seedFor(`${entity}:${week}`),
        true,
      );
      setValues(v);
      setFlags(new Set(f));
      persist({ values: v, flags: new Set(f) }, true);
    } else {
      setValues({});
      setFlags(new Set());
      persist({ values: {}, flags: new Set() }, true);
    }
  };

  const copyPrior = () => {
    const prevKey = prevWeekKey(week);
    setValues({ ...prior.values });
    setFlags(new Set());
    persist({ values: { ...prior.values }, flags: new Set() }, true);
    alert(
      prior.stored
        ? `Copied your saved ${weekLabel(prevKey)} submission. Edit as needed.`
        : `Loaded prior-week values for ${weekLabel(prevKey)}. Edit as needed.`,
    );
  };

  const handleImport = async (file: File) => {
    try {
      const imported = await parseValuesFile(file, template, dates);
      const nextValues = { ...values, ...imported.values };
      const nextFlags = reflag(nextValues, Object.keys(imported.values), flags);
      const nextDayComments = { ...dayComments, ...imported.dayComments };
      const nextBalance = imported.startingBalance ?? startingBalance;
      setValues(nextValues);
      setFlags(nextFlags);
      setDayComments(nextDayComments);
      setStartingBalance(nextBalance);
      persist(
        {
          values: nextValues,
          flags: nextFlags,
          dayComments: nextDayComments,
          startingBalance: nextBalance,
        },
        true,
      );
      alert(
        `Imported ${imported.matched} line item${imported.matched === 1 ? '' : 's'} from ${file.name}` +
          (imported.startingBalance !== undefined ? ' (incl. starting balance).' : '.'),
      );
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openVariance = (catIdx: number, dayIdx: number) => {
    const key = cellKey(catIdx, dayIdx);
    setCommentDraft(comments[key] ?? '');
    setVarianceCell({
      key,
      label: template.categories[catIdx]?.label ?? '',
      day: dayIdx + 1,
      prior: priorValueFor(prior.values, catIdx, dayIdx),
      current: values[key] || 0,
    });
  };

  const saveComment = () => {
    if (!varianceCell) return;
    const nextComments = { ...comments, [varianceCell.key]: commentDraft.trim() };
    if (!commentDraft.trim()) delete nextComments[varianceCell.key];
    setComments(nextComments);
    persist({ comments: nextComments }, true);
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
        const [c, d] = uncommented[0].split('-').map(Number);
        openVariance(c, d);
        return;
      }
    }
    setStatus('submitted');
    persist({ status: 'submitted' }, true);
    alert('Forecast submitted for approval.');
  };

  const exportGrid = () => {
    exportSubmissionXlsx({
      template,
      entity,
      weekLabel: weekLabelShort(week),
      dates,
      dayLabels,
      values,
      startingBalance,
      dayComments,
      filename: `${entity.replace(/\s+/g, '-')}-${week}-forecast.xlsx`,
    }).catch((err) =>
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  };

  const varianceDelta =
    varianceCell && varianceCell.prior !== null
      ? ((varianceCell.current - varianceCell.prior) /
          Math.max(Math.abs(varianceCell.prior), 1)) *
        100
      : null;

  return (
    <>
      <TopBar
        crumb={`Submission · ${weekLabelShort(week)} · ${entity}`}
        title="Forecast Entry"
        actions={
          <>
            <StatusPill status={status === 'draft' ? 'submitted' : status} label={status} />
            <button className="btn btn-ghost" onClick={() => persist({}, true)}>
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
                Cells exceeding ±{settings.varianceThreshold}% vs the prior week require
                commentary before submission. Click a flagged cell to explain it.
              </span>
              <span>
                {flags.size} flagged · {uncommented.length} need commentary
              </span>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-toolbar-left">{selectors}</div>
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
            <div className="grid-toolbar-left">
              <div className="grid-info">
                <strong>{template.name}</strong> ·{' '}
                <span className="text-muted">
                  EUR thousands · {HORIZON_WEEKS}-week horizon · {HORIZON_DAYS} working days ·
                  inflows +, outflows −
                </span>
              </div>
              <span className="paste-hint">⌘V · Paste from Excel supported</span>
            </div>
            <div className="row-flex">
              <label className="form-label" style={{ margin: 0 }}>
                Starting Balance
              </label>
              <input
                className="form-input"
                style={{ width: 120, textAlign: 'right', fontFamily: 'var(--mono)' }}
                value={startingBalance}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[€$,\s]/g, ''));
                  setBalance(Number.isFinite(n) ? n : 0);
                }}
                aria-label="Starting balance"
              />
            </div>
          </div>
          <div className="forecast-grid-wrap">
            <ForecastGrid
              categories={template.categories}
              layout={template.layout}
              dayLabels={dayLabels}
              values={values}
              flags={flags}
              startingBalance={startingBalance}
              dayComments={dayComments}
              editable
              onChangeCell={setCell}
              onPaste={handlePaste}
              onCellClick={openVariance}
              onChangeDayComment={setDayComment}
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
                  {varianceDelta === null
                    ? 'new period'
                    : `${varianceDelta > 0 ? '+' : ''}${varianceDelta.toFixed(1)}%`}
                </span>
              </div>
              <div className="row">
                <span>
                  Prior:{' '}
                  {varianceCell.prior === null
                    ? '—'
                    : `€${varianceCell.prior.toLocaleString()}k`}
                </span>
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
