import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from './ForecastGrid';
import {
  cellKey,
  dayInflows,
  dayNet,
  dayOutflows,
  parseCellNumber,
  runningBalance,
  type GridValues,
} from './gridMath';
import { generateGridValues, seedFor, STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listEntities, seedUsers } from '../../data/appData';
import { DEMO_DATA } from '../../data/dataSource';
import {
  currentWeekKey,
  HORIZON_DAYS,
  HORIZON_WEEKS,
  periodsOf,
  templateDates,
  templateDayLabels,
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
import { currentUser } from '../../data/session';
import {
  loadSettings,
  loadSubmission,
  loadTemplates,
  loadUsers,
  periodsWithSubmissions,
  saveSubmission,
} from '../../storage/localStorage';
import { exportSubmissionXlsx, exportTemplateXlsx } from '../../utils/excel';
import { appUrl, emailForName, mailDomain, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { ForecastTemplate, SubmissionStatus, TemplateLayout } from '../../types';

/** Deep-link target used by the Review / Approvals screens. */
export interface SubmissionTarget {
  entity?: string;
  week?: string;
  templateId?: string;
}

interface SubmissionProps {
  initial?: SubmissionTarget;
  /** Restrict the entity selector (analyst scoping); undefined = all. */
  allowedEntities?: string[];
  /** Viewer role: the grid and all write actions are read-only. */
  readOnly?: boolean;
}

export function Submission({ initial, allowedEntities, readOnly = false }: SubmissionProps) {
  const templates = useMemo(() => loadTemplates(), []);
  const entities = useMemo(() => listEntities(), []);
  const selectableEntities = useMemo(
    () => (allowedEntities ? entities.filter((e) => allowedEntities.includes(e.name)) : entities),
    [allowedEntities, entities],
  );
  const [entity, setEntity] = useState(() =>
    initial?.entity && selectableEntities.some((e) => e.name === initial.entity)
      ? initial.entity
      : selectableEntities[0]?.name ?? entities[0]?.name ?? 'Netherlands',
  );
  const [week, setWeek] = useState(() => initial?.week ?? currentWeekKey());

  const available = templatesForEntity(templates, entity);
  const [templateId, setTemplateId] = useState(() => initial?.templateId ?? available[0]?.id ?? '');
  const template = available.find((t) => t.id === templateId) ?? available[0] ?? null;

  // The on-screen orientation is a view preference, not a data property:
  // null = follow the template's native layout until the user picks one.
  const [orientationOverride, setOrientationOverride] = useState<TemplateLayout | null>(null);

  // Weeks that already hold a saved submission for this entity (history).
  const savedWeeks = useMemo(() => periodsWithSubmissions(entity), [entity]);

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
      {/* Remount the editor whenever the selection changes so state reloads. */}
      <SubmissionEditor
        key={`${entity}:${week}:${template.id}`}
        entity={entity}
        week={week}
        template={template}
        orientation={orientationOverride ?? template.layout}
        onChangeOrientation={setOrientationOverride}
        readOnly={readOnly}
        selectors={
          <>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              aria-label="Entity"
            >
              {selectableEntities.map((en) => (
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

interface VarianceCell {
  key: string;
  label: string;
  day: number;
  prior: number | null;
  current: number;
}

interface EditorProps {
  entity: string;
  week: string;
  template: ForecastTemplate;
  orientation: TemplateLayout;
  onChangeOrientation: (layout: TemplateLayout) => void;
  /** Viewer role: render everything, allow no changes. */
  readOnly: boolean;
  selectors: React.ReactNode;
}

/** Everything one Ctrl+Z restores: the full editable state of a forecast. */
interface EditState {
  values: GridValues;
  flags: Set<string>;
  comments: Record<string, string>;
  dayComments: Record<string, string>;
  startingBalance: number | null;
}

/** Plenty for a working session; keeps the stack from growing unbounded. */
const UNDO_LIMIT = 100;

interface ChartOptions {
  balance: boolean;
  net: boolean;
  inflows: boolean;
  outflows: boolean;
}

function SubmissionEditor({
  entity,
  week,
  template,
  orientation,
  onChangeOrientation,
  readOnly,
  selectors,
}: EditorProps) {
  const settings = useMemo(() => loadSettings(DEFAULT_SETTINGS), []);
  const { confirm, notify } = useDialog();
  // Column set comes from the template (editor-authored ones can define
  // their own periods); templates without a `periods` block keep the
  // standard 20-working-day horizon.
  const dates = useMemo(() => templateDates(template, week), [template, week]);
  const dayLabels = useMemo(() => templateDayLabels(template, week), [template, week]);
  const numPeriods = dates.length;
  const numCats = template.categories.length;

  const prior = useMemo(() => getPriorValues(entity, week, template), [entity, week, template]);
  const initial = useMemo(
    () => getOrCreateSubmission(entity, week, template),
    [entity, week, template],
  );

  const [values, setValues] = useState<GridValues>(initial.values);
  const [flags, setFlags] = useState<Set<string>>(new Set(initial.flags));
  const [resolvedFlags] = useState<string[]>(initial.resolvedFlags ?? []);
  const [comments, setComments] = useState<Record<string, string>>(initial.comments ?? {});
  const [dayComments, setDayComments] = useState<Record<string, string>>(
    initial.dayComments ?? {},
  );
  // null = the submitter hasn't given an opening balance; the grid then
  // leaves the running-total column out until they do.
  const [startingBalance, setStartingBalance] = useState<number | null>(
    initial.startingBalance ?? null,
  );
  const [status, setStatus] = useState<SubmissionStatus>(initial.status);
  const [varianceCell, setVarianceCell] = useState<VarianceCell | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [chartOptions, setChartOptions] = useState<ChartOptions>({
    balance: true,
    net: true,
    inflows: false,
    outflows: false,
  });
  const [balanceStyle, setBalanceStyle] = useState<'solid' | 'dashed' | 'area'>('solid');
  // Text held while the starting balance is being typed (see NumberCell).
  const [balanceDraft, setBalanceDraft] = useState<string | null>(null);

  // ---- Undo / redo -------------------------------------------------------
  // A spreadsheet is expected to undo. The browser's native input undo only
  // ever knew about one text box, so Ctrl+Z inside a cell restored a stray
  // keystroke and could not touch a paste at all. These stacks hold whole
  // editable states, so one Ctrl+Z reverses an edit, a paste or a reset.
  // Which cell the current run of keystrokes belongs to, so typing "1250"
  // is one undo step rather than four.
  const lastEditedCell = useRef<string | null>(null);
  const undoStack = useRef<EditState[]>([]);
  const redoStack = useRef<EditState[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  // Bumped only by undo/redo. Cells hold the text being typed, so restoring
  // an earlier state has to discard those drafts or the old text would stay
  // on screen over the restored value; remounting the grid clears them.
  const [restoreVersion, setRestoreVersion] = useState(0);
  // Re-read the stacks whenever history changes so the buttons enable/disable.
  const canUndo = useMemo(() => {
    void historyVersion;
    return undoStack.current.length > 0;
  }, [historyVersion]);
  const canRedo = useMemo(() => {
    void historyVersion;
    return redoStack.current.length > 0;
  }, [historyVersion]);

  const snapshot = useCallback(
    (): EditState => ({
      values,
      flags: new Set(flags),
      comments: { ...comments },
      dayComments: { ...dayComments },
      startingBalance,
    }),
    [values, flags, comments, dayComments, startingBalance],
  );

  /** Record the state a mutating action is about to replace. */
  const pushUndo = useCallback(() => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    setHistoryVersion((n) => n + 1);
  }, [snapshot]);

  const applyState = (next: EditState) => {
    lastEditedCell.current = null;
    setRestoreVersion((n) => n + 1);
    setValues(next.values);
    setFlags(next.flags);
    setComments(next.comments);
    setDayComments(next.dayComments);
    setStartingBalance(next.startingBalance);
    persist({
      values: next.values,
      flags: next.flags,
      comments: next.comments,
      dayComments: next.dayComments,
      startingBalance: next.startingBalance,
    });
    setHistoryVersion((n) => n + 1);
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(snapshot());
    applyState(previous);
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(snapshot());
    applyState(next);
  };

  interface Snapshot {
    values?: GridValues;
    flags?: Set<string>;
    comments?: Record<string, string>;
    dayComments?: Record<string, string>;
    startingBalance?: number | null;
    status?: SubmissionStatus;
  }
  const persist = (snap: Snapshot = {}) => {
    saveSubmission({
      period: week,
      entity,
      templateId: template.id,
      status: snap.status ?? status,
      values: snap.values ?? values,
      flags: [...(snap.flags ?? flags)],
      resolvedFlags,
      comments: snap.comments ?? comments,
      dayComments: snap.dayComments ?? dayComments,
      startingBalance:
        'startingBalance' in snap ? (snap.startingBalance ?? null) : startingBalance,
      updatedAt: new Date().toISOString(),
    });
  };

  // Ctrl/Cmd+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo — anywhere on the screen,
  // so it works whether or not a cell has focus. Bound on the document
  // because the grid's own inputs would otherwise swallow the keystroke.
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      // Leave free-text fields (commentary, day notes) to the browser.
      const el = document.activeElement;
      const isText =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && el.dataset.cat === undefined);
      if (isText) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const reflag = (v: GridValues, keys: Iterable<string>, base: Set<string>): Set<string> => {
    const next = new Set(base);
    for (const key of keys) {
      const [c, d] = key.split('-').map(Number);
      if (isVariance(v[key] || 0, priorValueFor(prior, c, d), settings)) next.add(key);
      else next.delete(key);
    }
    return next;
  };

  const setCell = (catIdx: number, dayIdx: number, value: number) => {
    const key = cellKey(catIdx, dayIdx);
    // Typing streams a value per keystroke; coalesce a run of edits to the
    // same cell so one Ctrl+Z doesn't just remove one digit.
    if (lastEditedCell.current !== key) {
      pushUndo();
      lastEditedCell.current = key;
    }
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
    // Only trailing newlines are stripped: trimming the whole block would
    // swallow a leading empty cell and shift the paste by a column. Excel
    // emits bare CR on some platforms, so all three endings are split.
    const grid = text
      .replace(/[\r\n]+$/, '')
      .split(/\r\n|\r|\n/)
      .map((row) => row.split('\t'));

    const nextValues = { ...values };
    const touched: string[] = [];
    let clipped = 0;
    let unparsed = 0;
    grid.forEach((cols, ri) => {
      cols.forEach((raw, ci) => {
        // Pasted rows/cols follow the on-screen orientation.
        const catIdx = orientation === 'grouped' ? startCat + ci : startCat + ri;
        const dayIdx = orientation === 'grouped' ? startDay + ri : startDay + ci;
        if (catIdx >= numCats || dayIdx >= numPeriods) {
          clipped++;
          return;
        }
        const n = parseCellNumber(raw);
        if (n === null) {
          unparsed++; // a header or label caught inside the copied range
          return;
        }
        const key = cellKey(catIdx, dayIdx);
        nextValues[key] = n;
        touched.push(key);
      });
    });

    pushUndo();
    lastEditedCell.current = null;
    const nextFlags = reflag(nextValues, touched, flags);
    setValues(nextValues);
    setFlags(nextFlags);
    persist({ values: nextValues, flags: nextFlags });

    // Dropped cells used to vanish without a word — which is exactly how a
    // pasted block looked like it "didn't paste all of them".
    if (clipped > 0 || unparsed > 0) {
      const why: string[] = [];
      if (clipped > 0) why.push(`${clipped} fell outside the grid`);
      if (unparsed > 0) why.push(`${unparsed} weren't numbers`);
      void notify({
        title: 'Pasted, with some cells skipped',
        message: `Filled ${touched.length} cell${touched.length === 1 ? '' : 's'} — ${why.join(' and ')}.`,
      });
    }
  };

  const setDayComment = (dayIdx: number, comment: string) => {
    lastEditedCell.current = null;
    const next = { ...dayComments, [String(dayIdx)]: comment };
    if (!comment) delete next[String(dayIdx)];
    setDayComments(next);
    persist({ dayComments: next });
  };

  const setBalance = (v: number | null) => {
    if (lastEditedCell.current !== 'starting-balance') {
      pushUndo();
      lastEditedCell.current = 'starting-balance';
    }
    setStartingBalance(v);
    persist({ startingBalance: v });
  };

  const reset = async () => {
    // The live instance never fabricates numbers: reset always means clear.
    const reseed = DEMO_DATA && template.id === STANDARD_TEMPLATE_ID;
    const confirmed = await confirm({
      title: 'Reset forecast',
      message: reseed
        ? 'Reset all values back to the seeded demo forecast? Your edits for this week will be lost.'
        : 'Clear all values for this week? Your edits will be lost.',
      confirmLabel: 'Reset Values',
      danger: true,
    });
    if (!confirmed) return;
    pushUndo();
    lastEditedCell.current = null;
    if (reseed) {
      const { values: v, flags: f } = generateGridValues(
        template.categories,
        week,
        seedFor(`${entity}:${week}`),
        true,
      );
      setValues(v);
      setFlags(new Set(f));
      persist({ values: v, flags: new Set(f) });
    } else {
      setValues({});
      setFlags(new Set());
      persist({ values: {}, flags: new Set() });
    }
  };

  const copyPrior = async () => {
    const prevKey = prevWeekKey(week);
    const hasStored = loadSubmission(prevKey, entity, template.id) !== null;
    pushUndo();
    setValues({ ...prior });
    setFlags(new Set());
    persist({ values: { ...prior }, flags: new Set() });
    lastEditedCell.current = null;
    await notify({
      tone: 'success',
      message: hasStored
        ? `Copied your saved ${weekLabel(prevKey)} submission. Edit as needed.`
        : `Loaded prior-week values for ${weekLabel(prevKey)}. Edit as needed.`,
    });
  };

  /** Download this template's empty structure so it can be filled in offline. */
  const exportBlankTemplate = () => {
    exportTemplateXlsx(template, dates, dayLabels).catch((err) =>
      notify({
        title: 'Export failed',
        tone: 'error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  };

  const openVariance = (catIdx: number, dayIdx: number) => {
    const key = cellKey(catIdx, dayIdx);
    setCommentDraft(comments[key] ?? '');
    setVarianceCell({
      key,
      label: template.categories[catIdx]?.label ?? '',
      day: dayIdx + 1,
      prior: priorValueFor(prior, catIdx, dayIdx),
      current: values[key] || 0,
    });
  };

  const saveComment = () => {
    if (!varianceCell) return;
    const nextComments = { ...comments, [varianceCell.key]: commentDraft.trim() };
    if (!commentDraft.trim()) delete nextComments[varianceCell.key];
    setComments(nextComments);
    persist({ comments: nextComments });
    setVarianceCell(null);
  };

  const uncommented = [...flags].filter((k) => !comments[k]?.trim());

  const submit = async () => {
    if (uncommented.length > 0) {
      const addNow = await confirm({
        title: 'Commentary required',
        message: `${uncommented.length} flagged cell${uncommented.length === 1 ? '' : 's'} still need commentary before this forecast can be closed. Add it now?`,
        confirmLabel: 'Add Commentary',
        cancelLabel: 'Submit Anyway',
      });
      if (addNow) {
        const [c, d] = uncommented[0].split('-').map(Number);
        openVariance(c, d);
        return;
      }
    }
    setStatus('submitted');
    persist({ status: 'submitted' });
    await notify({ tone: 'success', message: 'Forecast submitted for approval.' });
  };

  const saveDraft = async () => {
    persist();
    await notify({ tone: 'success', message: 'Draft saved. All values are kept in this browser.' });
  };

  const exportGrid = () => {
    exportSubmissionXlsx({
      template,
      layout: orientation,
      entity,
      weekLabel: weekLabelShort(week),
      dates,
      dayLabels,
      values,
      startingBalance: startingBalance ?? 0,
      dayComments,
      filename: `${entity.replace(/\s+/g, '-')}-${week}-forecast.xlsx`,
    }).catch((err) =>
      notify({
        title: 'Export failed',
        tone: 'error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  };

  // ---- Live horizon aggregates (drive the chart + the approver email) ----
  const numDays = dayLabels.length;
  const inflowByDay = dates.map((_d, d) => dayInflows(numCats, values, d));
  const outflowByDay = dates.map((_d, d) => dayOutflows(numCats, values, d));
  const netByDay = dates.map((_d, d) => dayNet(numCats, values, d));
  const hasBalance = startingBalance !== null;
  const balanceByDay = dates.map((_d, d) =>
    runningBalance(numCats, values, startingBalance ?? 0, d),
  );
  const totalInflows = inflowByDay.reduce((a, b) => a + b, 0);
  const totalOutflows = outflowByDay.reduce((a, b) => a + b, 0);
  const totalNet = netByDay.reduce((a, b) => a + b, 0);
  const closingBalance = balanceByDay[numDays - 1] ?? startingBalance ?? 0;

  const chartSeries: ChartSeries[] = [];
  if (chartOptions.inflows)
    chartSeries.push({ label: 'Inflows', values: inflowByDay, color: CHART_COLORS.green, kind: 'bar' });
  if (chartOptions.outflows)
    chartSeries.push({ label: 'Outflows', values: outflowByDay, color: CHART_COLORS.red, kind: 'bar' });
  if (chartOptions.net)
    chartSeries.push({ label: 'Net Cash Flow', values: netByDay, color: CHART_COLORS.blue, kind: 'bar' });
  if (chartOptions.balance && hasBalance)
    chartSeries.push({
      label: 'Running Balance',
      values: balanceByDay,
      color: CHART_COLORS.accent,
      kind: balanceStyle === 'area' ? 'area' : 'line',
      dashed: balanceStyle === 'dashed',
    });

  const toggleChartOption = (key: keyof ChartOptions) =>
    setChartOptions((o) => ({ ...o, [key]: !o[key] }));

  const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

  const emailApprover = () => {
    const ent = listEntities().find((e) => e.name === entity);
    const me = currentUser();
    const domain = mailDomain(settings);
    const users = loadUsers(seedUsers());
    const to = ent ? emailForName(ent.approver, users, domain) : '';
    openEmail({
      to,
      subject: `Cash flow forecast ready for review — ${entity} · ${weekLabel(week)}`,
      body:
        `Hi ${ent?.approver ?? 'there'},\n\n` +
        `The ${entity} cash flow forecast for ${weekLabel(week)} is ready for your review in Liquid.\n\n` +
        `Status: ${status}\n` +
        `Template: ${template.name}\n` +
        (hasBalance ? `Starting balance: ${fmtK(startingBalance ?? 0)}\n` : '') +
        `Total inflows: ${fmtK(totalInflows)}\n` +
        `Total outflows: ${fmtK(totalOutflows)}\n` +
        `Net cash flow: ${fmtK(totalNet)}\n` +
        `Closing balance: ${fmtK(closingBalance)}\n` +
        `Variance flags: ${flags.size} (${uncommented.length} awaiting commentary)\n\n` +
        `Open the forecast: ${appUrl()}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
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
            {readOnly ? (
              <ViewOnlyBadge hint="Viewers have read-only access to forecasts" />
            ) : (
              <>
                <button className="btn btn-ghost" onClick={saveDraft}>
                  Save Draft
                </button>
                <button className="btn btn-primary" data-tour="submit-forecast" onClick={submit}>
                  Submit for Approval
                </button>
              </>
            )}
          </>
        }
      />
      <div className="content">
        {flags.size > 0 && (
          <div className="variance-panel" data-tour="variance-panel">
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
            <div className="grid-toolbar-left" data-tour="submission-filters">{selectors}</div>
            <div className="row-flex">
              {!readOnly && (
                <>
                  <button
                    className="btn btn-ghost"
                    data-tour="undo"
                    title="Undo (Ctrl+Z)"
                    disabled={!canUndo}
                    onClick={undo}
                  >
                    ↶ Undo
                  </button>
                  <button
                    className="btn btn-ghost"
                    data-tour="redo"
                    title="Redo (Ctrl+Shift+Z)"
                    disabled={!canRedo}
                    onClick={redo}
                  >
                    ↷ Redo
                  </button>
                </>
              )}
              <button
                className="btn btn-ghost"
                data-tour="export-template"
                title="Download this template as a blank workbook to fill in offline"
                onClick={exportBlankTemplate}
              >
                Export Template
              </button>
              <button className="btn btn-ghost" data-tour="export-excel" onClick={exportGrid}>
                Export Excel
              </button>
              <button className="btn btn-ghost" onClick={emailApprover}>
                Email Approver
              </button>
              {!readOnly && (
                <>
                  <button className="btn btn-ghost" onClick={copyPrior}>
                    Copy Prior Forecast
                  </button>
                  <button className="btn btn-ghost" onClick={reset}>
                    Reset
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="grid-toolbar" style={{ borderTop: 'none' }}>
            <div className="grid-toolbar-left">
              <div className="grid-info">
                <strong>{template.name}</strong> ·{' '}
                <span className="text-muted">
                  EUR thousands ·{' '}
                  {template.periods
                    ? `${numPeriods} ${periodsOf(template).granularity} period${numPeriods === 1 ? '' : 's'}`
                    : `${HORIZON_WEEKS}-week horizon · ${HORIZON_DAYS} working days`}{' '}
                  · inflows +, outflows −
                </span>
              </div>
              <div className="seg-toggle" role="group" aria-label="Grid orientation" data-tour="orientation-toggle">
                <button
                  className={orientation === 'days-across' ? 'active' : ''}
                  onClick={() => onChangeOrientation('days-across')}
                  title="Dates across the columns, one row per line item"
                >
                  Dates → Columns
                </button>
                <button
                  className={orientation === 'grouped' ? 'active' : ''}
                  onClick={() => onChangeOrientation('grouped')}
                  title="Dates down the rows, one column per line item"
                >
                  Dates ↓ Rows
                </button>
              </div>
              <span className="paste-hint">⌘V · Paste from Excel supported</span>
            </div>
            <div className="row-flex">
              <label className="form-label" style={{ margin: 0 }}>
                Starting Balance <span className="text-muted">(optional)</span>
              </label>
              <input
                className="form-input"
                style={{ width: 120, textAlign: 'right', fontFamily: 'var(--mono)' }}
                // Same draft-while-typing treatment as a grid cell, so a
                // negative opening balance can actually be typed.
                value={balanceDraft ?? (startingBalance === null ? '' : String(startingBalance))}
                placeholder="optional"
                disabled={readOnly}
                onChange={(e) => {
                  const raw = e.target.value;
                  setBalanceDraft(raw);
                  // Clearing the field removes the opening balance entirely,
                  // which is what hides the running-total column again.
                  if (raw.trim() === '') setBalance(null);
                  else {
                    const parsed = parseCellNumber(raw);
                    if (parsed !== null) setBalance(parsed);
                  }
                }}
                onBlur={() => {
                  if (balanceDraft !== null) {
                    setBalance(balanceDraft.trim() === '' ? null : parseCellNumber(balanceDraft));
                  }
                  setBalanceDraft(null);
                }}
                aria-label="Starting balance"
              />
              {!hasBalance && (
                <span className="text-muted" style={{ fontSize: 11 }}>
                  Enter one to show a running balance
                </span>
              )}
            </div>
          </div>
          <div className="forecast-grid-wrap" data-tour="forecast-grid">
            <ForecastGrid
              key={restoreVersion}
              categories={template.categories}
              layout={orientation}
              dayLabels={dayLabels}
              values={values}
              flags={flags}
              startingBalance={startingBalance}
              dayComments={dayComments}
              editable={!readOnly}
              onChangeCell={setCell}
              onPaste={handlePaste}
              onCellClick={openVariance}
              onChangeDayComment={setDayComment}
              showColumnTotals={template.columnTotals === true}
            />
          </div>
        </div>

        <div className="section-header">
          <h2>Running Balance Outlook</h2>
          <span className="tag">
            {weekLabelShort(week)} · €k · updates as you type
          </span>
        </div>
        <div className="panel">
          <div className="chart-controls">
            {hasBalance && (
              <label className="series-check">
                <input
                  type="checkbox"
                  checked={chartOptions.balance}
                  onChange={() => toggleChartOption('balance')}
                />
                Running Balance
              </label>
            )}
            <label className="series-check">
              <input
                type="checkbox"
                checked={chartOptions.net}
                onChange={() => toggleChartOption('net')}
              />
              Net Cash Flow
            </label>
            <label className="series-check">
              <input
                type="checkbox"
                checked={chartOptions.inflows}
                onChange={() => toggleChartOption('inflows')}
              />
              Inflows
            </label>
            <label className="series-check">
              <input
                type="checkbox"
                checked={chartOptions.outflows}
                onChange={() => toggleChartOption('outflows')}
              />
              Outflows
            </label>
            <select
              className="form-select"
              style={{ width: 'auto', marginLeft: 'auto', padding: '5px 10px' }}
              value={balanceStyle}
              onChange={(e) => setBalanceStyle(e.target.value as 'solid' | 'dashed' | 'area')}
              aria-label="Balance line style"
            >
              <option value="solid">Balance · solid line</option>
              <option value="dashed">Balance · dashed line</option>
              <option value="area">Balance · area</option>
            </select>
          </div>
          {chartSeries.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <p>Select at least one series to plot.</p>
            </div>
          ) : (
            <Chart labels={dayLabels.map((dl) => dl.dm)} series={chartSeries} unit="k" />
          )}
        </div>
      </div>

      <Modal
        open={varianceCell !== null}
        title={readOnly ? 'Variance Detail' : 'Explain Variance'}
        onClose={() => setVarianceCell(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setVarianceCell(null)}>
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button className="btn btn-primary" onClick={saveComment}>
                Save
              </button>
            )}
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
              <label className="form-label">
                {readOnly ? 'Commentary' : 'Commentary (required)'}
              </label>
              <textarea
                className="form-textarea"
                placeholder={
                  readOnly
                    ? 'No commentary provided yet.'
                    : 'Explain the driver behind this variance...'
                }
                value={commentDraft}
                disabled={readOnly}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
