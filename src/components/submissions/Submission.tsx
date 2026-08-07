import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from './ForecastGrid';
import {
  categoryGroups,
  cellKey,
  dayInflows,
  dayNet,
  dayOutflows,
  parseCellNumber,
  runningBalance,
  type GridValues,
} from './gridMath';
import { generateGridValues, seedFor, STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listCycles, listEntities, seedUsers } from '../../data/appData';
import { DEMO_DATA } from '../../data/dataSource';
import {
  currentWeekKey,
  shiftWeeks,
  HORIZON_DAYS,
  HORIZON_WEEKS,
  periodsOf,
  rollShift,
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
  activeCycleId,
  answerCommentRequest,
  applyApprovalDecision,
  clearApprovalDecision,
  getOrCreateSubmission,
  getPriorValues,
  isVariance,
  mergedEntityStatus,
  peekSubmission,
  priorValueFor,
  requestComment,
  templatesForEntity,
} from '../../data/submissionService';
import { currentUser } from '../../data/session';
import {
  loadApprovals,
  loadCycles,
  loadDraftSnapshot,
  loadSettings,
  loadSubmission,
  loadTemplates,
  loadUsers,
  periodsWithSubmissions,
  saveDraftSnapshot,
  saveSubmission,
} from '../../storage/localStorage';
import { exportSubmissionXlsx, exportTemplateXlsx } from '../../utils/excel';
import { appUrl, emailForName, mailDomain, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type {
  CommentRequest,
  ForecastTemplate,
  SubmissionStatus,
  TemplateLayout,
} from '../../types';

/** Deep-link target used by the Review / Approvals screens. */
export interface SubmissionTarget {
  entity?: string;
  week?: string;
  templateId?: string;
  /**
   * A flagged cell (`${catIdx}-${dayIdx}`) whose commentary dialog should open
   * on arrival. Comments Review sends this so "Explain" lands on the exact
   * cell instead of leaving the submitter to hunt for it in the grid.
   */
  focusCell?: string;
}

interface SubmissionProps {
  initial?: SubmissionTarget;
  /** Restrict the entity selector (analyst scoping); undefined = all. */
  allowedEntities?: string[];
  /** Viewer role: the grid and all write actions are read-only. */
  readOnly?: boolean;
  /** Treasury: may ask the submitter for commentary on any cell. */
  canRequestComments?: boolean;
  /**
   * Non-treasury users don't pick a period or template — the active cycle
   * decides the period and Legal Entity Setup decides the template, so they
   * see a read-only cycle chip instead of the year/month/week/template pickers.
   */
  cycleManaged?: boolean;
  /** Approver: an Approve action right on the forecast they are reading. */
  canApprove?: boolean;
}

export function Submission({
  initial,
  allowedEntities,
  readOnly = false,
  canRequestComments = false,
  cycleManaged = false,
  canApprove = false,
}: SubmissionProps) {
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

  // Cycle-managed users see WHEN they are forecasting, not a period picker:
  // the active cycle decides that, and the template comes from Legal Entity
  // Setup. Only the entity remains selectable (when they cover more than one).
  const horizon = templateDates(template, week);
  const horizonEnd = horizon[horizon.length - 1];
  const fmtDay = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const isCurrentCycle = week === currentWeekKey();

  return (
    <div className="view active submission-view">
      {/* Remount the editor whenever the selection changes so state reloads. */}
      <SubmissionEditor
        key={`${entity}:${week}:${template.id}`}
        entity={entity}
        week={week}
        template={template}
        focusCell={initial?.focusCell}
        orientation={orientationOverride ?? template.layout}
        onChangeOrientation={setOrientationOverride}
        readOnly={readOnly}
        canRequestComments={canRequestComments}
        canApprove={canApprove}
        selectors={
          cycleManaged ? (
            <>
              {selectableEntities.length > 1 && (
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
              )}
              <div
                className="cycle-chip"
                data-tour="cycle-chip"
                title="The forecast period follows the cycle Treasury opened — nothing to pick here"
              >
                <span className="dot" />
                <span className="label">{isCurrentCycle ? 'This cycle' : 'Prior cycle'}</span>
                <span className="val">
                  {weekLabel(week)} – {horizonEnd ? fmtDay(horizonEnd) : ''}
                </span>
              </div>
              <span className="cycle-chip-template" title="Template is set by Treasury in Legal Entity Setup">
                {template.name}
              </span>
            </>
          ) : (
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
          )
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
  /** Flagged cell to open the commentary dialog on, if deep-linked. */
  focusCell?: string;
  orientation: TemplateLayout;
  onChangeOrientation: (layout: TemplateLayout) => void;
  /** Viewer role: render everything, allow no changes. */
  readOnly: boolean;
  /** Treasury: may ask the submitter for commentary on any cell. */
  canRequestComments: boolean;
  /** Approver: an Approve action right on the forecast they are reading. */
  canApprove: boolean;
  selectors: React.ReactNode;
}

/**
 * The guided commentary walkthrough started by Submit when flagged cells
 * still lack commentary: one variance spotlit at a time, the comment box
 * alongside, advancing to the next unexplained cell on each save.
 */
interface CommentFlow {
  queue: string[];
  idx: number;
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

/** Which measure the prior-cycle overlays plot. */
type CompareMetric = 'net' | 'balance' | 'inflows' | 'outflows';

const COMPARE_LABELS: Record<CompareMetric, string> = {
  net: 'Net Cash Flow',
  balance: 'Running Balance',
  inflows: 'Inflows',
  outflows: 'Outflows',
};

/** Distinct from the live series' colours so an overlay is never mistaken
 *  for this week's line. */
const OVERLAY_COLORS = ['#8e92a3', '#7a5ea8', '#4f8a8b', '#a86b3c'];

function SubmissionEditor({
  entity,
  week,
  template,
  focusCell,
  orientation,
  onChangeOrientation,
  readOnly,
  canRequestComments,
  canApprove,
  selectors,
}: EditorProps) {
  const settings = useMemo(() => loadSettings(DEFAULT_SETTINGS), []);
  const { confirm, notify } = useDialog();
  const activeCycle = useMemo(() => {
    const cycles = loadCycles(listCycles());
    return cycles.find((c) => c.status === 'submitted') ?? cycles[0];
  }, []);
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
  const [commentRequests, setCommentRequests] = useState<Record<string, CommentRequest>>(
    initial.commentRequests ?? {},
  );
  const [varianceCell, setVarianceCell] = useState<VarianceCell | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  /** Treasury's question, while it is being written in the cell dialog. */
  const [requestDraft, setRequestDraft] = useState('');
  /** Guided commentary walkthrough (submit with unexplained variances). */
  const [flow, setFlow] = useState<CommentFlow | null>(null);
  const [flowDraft, setFlowDraft] = useState('');
  /** Which side of the screen the walkthrough panel sits on — always the
   *  side AWAY from the spotlit cell, so cell and box are visible together. */
  const [flowSide, setFlowSide] = useState<'left' | 'right'>('right');
  /**
   * Cells still needing a number, spotlit after a submit attempt. null = not
   * validating; an empty set never happens (nothing to point at → submit).
   */
  const [needInput, setNeedInput] = useState<Set<string> | null>(null);
  const [chartOptions, setChartOptions] = useState<ChartOptions>({
    balance: true,
    net: true,
    inflows: false,
    outflows: false,
  });
  const [balanceStyle, setBalanceStyle] = useState<'solid' | 'dashed' | 'area'>('solid');
  /** Earlier forecast weeks overlaid on the chart for comparison. */
  const [compareWeeks, setCompareWeeks] = useState<string[]>([]);
  const [compareMetric, setCompareMetric] = useState<CompareMetric>('net');
  // Text held while the starting balance is being typed (see NumberCell).
  const [balanceDraft, setBalanceDraft] = useState<string | null>(null);

  // Sections start collapsed for anyone who came to READ the forecast —
  // treasury, approvers, viewers — because the shape is the point and every
  // line item is noise. Whoever is entering the numbers needs them open.
  const groupsList = useMemo(() => categoryGroups(template.categories), [template]);
  const sections = useMemo(
    () => groupsList.map((g, gi) => (g.label ? gi : -1)).filter((gi) => gi >= 0),
    [groupsList],
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(() =>
    readOnly || canRequestComments ? new Set(sections) : new Set(),
  );
  const toggleGroup = (gi: number) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gi)) next.delete(gi);
      else next.add(gi);
      return next;
    });

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
    commentRequests?: Record<string, CommentRequest>;
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
      commentRequests: snap.commentRequests ?? commentRequests,
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

  const setCell = (catIdx: number, dayIdx: number, value: number | null) => {
    const key = cellKey(catIdx, dayIdx);
    // Typing streams a value per keystroke; coalesce a run of edits to the
    // same cell so one Ctrl+Z doesn't just remove one digit.
    if (lastEditedCell.current !== key) {
      pushUndo();
      lastEditedCell.current = key;
    }
    const nextValues = { ...values };
    // Clearing removes the value rather than storing a zero, so the cell reads
    // as "not forecast yet" everywhere downstream.
    if (value === null) delete nextValues[key];
    else nextValues[key] = value;
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

  const setBalance = (v: number | null) => {
    if (lastEditedCell.current !== 'starting-balance') {
      pushUndo();
      lastEditedCell.current = 'starting-balance';
    }
    setStartingBalance(v);
    persist({ startingBalance: v });
  };

  const reset = async () => {
    // A draft the submitter deliberately saved is the restore point; only
    // when there is none does reset fall back to the seed (demo) or a clear.
    const draft = loadDraftSnapshot(week, entity, template.id);
    // The live instance never fabricates numbers: reset always means clear.
    const reseed = DEMO_DATA && template.id === STANDARD_TEMPLATE_ID;
    const confirmed = await confirm({
      title: 'Reset forecast',
      message: draft
        ? `Reset all values back to the draft you saved${draftAgeLabel(draft.savedAt)}? Everything typed since then will be lost.`
        : reseed
          ? 'Reset all values back to the seeded demo forecast? Your edits for this week will be lost.'
          : 'Clear all values for this week? Your edits will be lost.',
      confirmLabel: draft ? 'Reset to Saved Draft' : 'Reset Values',
      danger: true,
    });
    if (!confirmed) return;
    pushUndo();
    lastEditedCell.current = null;
    if (draft) {
      // Restore the full editable state, remounting the grid so no cell keeps
      // the text that was being typed (same treatment as undo/redo).
      setRestoreVersion((n) => n + 1);
      setValues(draft.values);
      setFlags(new Set(draft.flags));
      setComments(draft.comments);
      setDayComments(draft.dayComments);
      setStartingBalance(draft.startingBalance);
      persist({
        values: draft.values,
        flags: new Set(draft.flags),
        comments: draft.comments,
        dayComments: draft.dayComments,
        startingBalance: draft.startingBalance,
      });
    } else if (reseed) {
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

  /** " from 2h ago" — how old the draft being restored is, when knowable. */
  const draftAgeLabel = (iso: string): string => {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const mins = Math.round(ms / 60_000);
    if (mins < 1) return ' from a moment ago';
    if (mins < 60) return ` from ${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return ` from ${hours} hour${hours === 1 ? '' : 's'} ago`;
    return ` from ${Math.round(hours / 24)} days ago`;
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
    setRequestDraft('');
    setVarianceCell({
      key,
      label: template.categories[catIdx]?.label ?? '',
      day: dayIdx + 1,
      prior: priorValueFor(prior, catIdx, dayIdx, template),
      current: values[key] || 0,
    });
  };

  // Deep link from Comments Review: open that cell's commentary dialog as
  // soon as the grid is up, so "Explain" lands on the right cell.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!focusCell || focusedOnce.current) return;
    const [c, d] = focusCell.split('-').map(Number);
    if (!Number.isFinite(c) || !Number.isFinite(d)) return;
    focusedOnce.current = true;
    openVariance(c, d);
    // Scroll the cell itself into view behind the dialog.
    requestAnimationFrame(() => {
      document
        .querySelector(`.forecast-grid input[data-cat="${c}"][data-day="${d}"]`)
        ?.scrollIntoView({ block: 'center', inline: 'center' });
    });
    // openVariance is stable for a given render of this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCell]);

  const saveComment = () => {
    if (!varianceCell) return;
    const nextComments = { ...comments, [varianceCell.key]: commentDraft.trim() };
    if (!commentDraft.trim()) delete nextComments[varianceCell.key];
    setComments(nextComments);
    // Answering the question closes it — treasury asked, this is the reply.
    const nextRequests = answerCommentRequest(
      { ...initial, commentRequests },
      varianceCell.key,
    );
    setCommentRequests(nextRequests ?? {});
    persist({ comments: nextComments, commentRequests: nextRequests ?? {} });
    setVarianceCell(null);
  };

  /** Treasury asks the submitter about this cell, and emails them about it. */
  const sendCommentRequest = async () => {
    if (!varianceCell) return;
    const message = requestDraft.trim();
    if (!message) {
      await notify({ tone: 'error', message: 'Write the question you want answered first.' });
      return;
    }
    const me = currentUser();
    const request: CommentRequest = {
      from: me.name,
      message,
      requestedAt: new Date().toISOString(),
    };
    requestComment(week, entity, template.id, varianceCell.key, request);
    const next = { ...commentRequests, [varianceCell.key]: request };
    setCommentRequests(next);
    setFlags((f) => new Set(f).add(varianceCell.key));
    setVarianceCell(null);
    setRequestDraft('');
    emailCommentRequest(varianceCell, message);
  };

  /** Outlook draft to whoever submits for this entity. */
  const emailCommentRequest = (cell: VarianceCell, message: string) => {
    const ent = listEntities().find((e) => e.name === entity);
    const me = currentUser();
    const to = ent ? emailForName(ent.submitter, loadUsers(seedUsers()), mailDomain(settings)) : '';
    openEmail({
      to,
      subject: `Question on the ${entity} forecast — ${cell.label} · Day ${cell.day} · ${weekLabel(week)}`,
      body:
        `Hi ${ent?.submitter ?? 'there'},\n\n` +
        `I have a question about the ${entity} cash flow forecast for ${weekLabel(week)}.\n\n` +
        `Line item: ${cell.label}\n` +
        `Period: Day ${cell.day}\n` +
        `Current value: ${fmtK(cell.current)}\n` +
        (cell.prior === null ? '' : `Prior forecast: ${fmtK(cell.prior)}\n`) +
        `\nQuestion:\n${message}\n\n` +
        `Please add your commentary on that cell: ${appUrl()}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
  };

  const uncommented = [...flags].filter((k) => !comments[k]?.trim());
  const requestedCells = useMemo(() => new Set(Object.keys(commentRequests)), [commentRequests]);
  const openRequests = useMemo(
    () => Object.entries(commentRequests).map(([key, r]) => ({ key, ...r })),
    [commentRequests],
  );

  /** "Receivables · Day 3" for a cell key, for banners and email subjects. */
  const cellLabelFor = (key: string): string => {
    const [c, d] = key.split('-').map(Number);
    return `${template.categories[c]?.label ?? `Line ${c + 1}`} · Day ${d + 1}`;
  };

  /**
   * Editable cells with no number in them yet. Subtotals are computed, so
   * they never "need input"; a stored 0 is a real answer and counts as filled.
   */
  const emptyCells = useMemo(() => {
    const out = new Set<string>();
    template.categories.forEach((cat, catIdx) => {
      if (cat.subtotal) return;
      for (let d = 0; d < numPeriods; d++) {
        const key = cellKey(catIdx, d);
        if (values[key] === undefined) out.add(key);
      }
    });
    return out;
  }, [template, values, numPeriods]);

  const finalizeSubmit = async () => {
    setNeedInput(null);
    setStatus('submitted');
    persist({ status: 'submitted' });
    // A fresh submission reopens the decision: without this, a rejection
    // stuck in the cycle's approval map forever and the approver saw the
    // resubmitted forecast as already "rejected" with no way to approve it.
    clearApprovalDecision(entity);
    await notify({ tone: 'success', message: 'Forecast submitted for approval.' });
  };

  const submit = async () => {
    if (flow) return; // the commentary walkthrough is already driving this
    // Point at the gaps before anything else: a missing number is easier to
    // fix while looking at the grid than to read about in a dialog.
    if (emptyCells.size > 0 && needInput === null) {
      setNeedInput(emptyCells);
      requestAnimationFrame(() => {
        document
          .querySelector('.forecast-grid td.cell-spotlit')
          ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      });
      return;
    }
    // Unexplained variances start the guided walkthrough: each one is spotlit
    // in turn with the comment box alongside, instead of a blocking dialog.
    if (uncommented.length > 0) {
      startCommentFlow();
      return;
    }
    await finalizeSubmit();
  };

  // ---- Guided commentary walkthrough -------------------------------------
  // Reading order — left to right through the horizon, top to bottom within
  // a period — so the spotlight sweeps the grid rather than jumping around.
  const startCommentFlow = () => {
    const queue = [...uncommented].sort((a, b) => {
      const [ca, da] = a.split('-').map(Number);
      const [cb, db] = b.split('-').map(Number);
      return da - db || ca - cb;
    });
    if (queue.length === 0) return;
    setNeedInput(null);
    setFlow({ queue, idx: 0 });
    focusFlowCell(queue[0]);
  };

  /**
   * Bring one variance into play: open the section that holds it (a forecast
   * submitted collapsed must uncollapse to show the cell), scroll it into
   * view, and dock the comment box on whichever side of the screen the cell
   * is NOT — numbers and box stay visible side by side.
   */
  const focusFlowCell = (key: string) => {
    const [c, d] = key.split('-').map(Number);
    setFlowDraft('');
    const gi = groupsList.findIndex((g) => g.idxs.includes(c));
    if (gi >= 0) {
      setCollapsedGroups((prev) => {
        if (!prev.has(gi)) return prev;
        const next = new Set(prev);
        next.delete(gi);
        return next;
      });
    }
    // Two frames: one for the section to expand, one for layout to settle.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el =
          document.querySelector(`.forecast-grid input[data-cat="${c}"][data-day="${d}"]`) ??
          document.querySelector('.forecast-grid td.cell-flow-spotlit');
        el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        const rect = el?.getBoundingClientRect();
        if (rect) {
          setFlowSide(rect.left + rect.width / 2 > window.innerWidth / 2 ? 'left' : 'right');
        }
      }),
    );
  };

  /** Move to the next cell still lacking commentary, or wrap the flow up. */
  const advanceFlow = (queue: string[], fromIdx: number, latest: Record<string, string>) => {
    let next = fromIdx + 1;
    while (next < queue.length && latest[queue[next]]?.trim()) next++;
    if (next < queue.length) {
      setFlow({ queue, idx: next });
      focusFlowCell(queue[next]);
      return;
    }
    void endFlow(latest);
  };

  const endFlow = async (latest: Record<string, string>) => {
    setFlow(null);
    const remaining = [...flags].filter((k) => !latest[k]?.trim());
    if (remaining.length > 0) {
      const anyway = await confirm({
        title: 'Commentary still missing',
        message: `${remaining.length} flagged cell${remaining.length === 1 ? ' still has' : 's still have'} no commentary. Treasury will chase these before the cycle can close.`,
        confirmLabel: 'Submit Anyway',
        cancelLabel: 'Keep Editing',
      });
      if (!anyway) return;
    }
    await finalizeSubmit();
  };

  const saveFlowComment = () => {
    if (!flow) return;
    const key = flow.queue[flow.idx];
    const text = flowDraft.trim();
    if (!text) return;
    pushUndo();
    lastEditedCell.current = null;
    const nextComments = { ...comments, [key]: text };
    setComments(nextComments);
    // Answering counts for an open treasury question on the same cell too.
    const nextRequests = answerCommentRequest({ ...initial, commentRequests }, key);
    setCommentRequests(nextRequests ?? {});
    persist({ comments: nextComments, commentRequests: nextRequests ?? {} });
    advanceFlow(flow.queue, flow.idx, nextComments);
  };

  const skipFlowCell = () => {
    if (!flow) return;
    advanceFlow(flow.queue, flow.idx, comments);
  };

  /** The cell the walkthrough is currently pointing at, decorated for display. */
  const flowCell = useMemo((): VarianceCell | null => {
    if (!flow) return null;
    const key = flow.queue[flow.idx];
    const [c, d] = key.split('-').map(Number);
    return {
      key,
      label: template.categories[c]?.label ?? `Line ${c + 1}`,
      day: d + 1,
      prior: priorValueFor(prior, c, d, template),
      current: values[key] || 0,
    };
  }, [flow, template, prior, values]);

  const saveDraft = async () => {
    persist();
    // The snapshot is what Reset restores — the deliberate save point, as
    // opposed to the keystroke-by-keystroke persistence of the live state.
    saveDraftSnapshot(week, entity, template.id, {
      values,
      flags: [...flags],
      comments: { ...comments },
      dayComments: { ...dayComments },
      startingBalance,
      savedAt: new Date().toISOString(),
    });
    await notify({
      tone: 'success',
      message: 'Draft saved. Reset now returns to this point.',
    });
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

  // ---- Prior cycles overlaid on the same axes ----------------------------
  // The forecast is rolling, so the question "is this week's shape different
  // from last week's?" needs both drawn together, not two screens compared
  // from memory. Only the weeks whose horizon still OVERLAPS this one are
  // offered: a forecast made further back than the horizon covers none of the
  // dates on this chart, so there is nothing of it to draw.
  const weeksBack = useCallback(
    (key: string) => Math.round((Date.parse(week) - Date.parse(key)) / 604_800_000),
    [week],
  );
  const priorWeekOptions = useMemo(() => {
    const out: { week: string; label: string; saved: boolean }[] = [];
    for (let back = 1; back <= HORIZON_WEEKS; back++) {
      const key = shiftWeeks(week, -back);
      // How many of this chart's periods that older forecast still covers.
      const overlap = numPeriods - back * rollShift(template);
      if (overlap <= 0) continue;
      out.push({
        week: key,
        label: weekLabelShort(key),
        saved: loadSubmission(key, entity, template.id) !== null,
      });
    }
    return out;
  }, [week, entity, template, numPeriods]);

  const overlaySeries: ChartSeries[] = useMemo(
    () =>
      compareWeeks.map((key, i) => {
        const past = peekSubmission(entity, key, template);
        const pastValues = past.values;
        const metricAt = (d: number): number => {
          switch (compareMetric) {
            case 'net':
              return dayNet(numCats, pastValues, d);
            case 'balance':
              return runningBalance(numCats, pastValues, past.startingBalance ?? 0, d);
            case 'inflows':
              return dayInflows(numCats, pastValues, d);
            case 'outflows':
              return dayOutflows(numCats, pastValues, d);
          }
        };
        // Align by CALENDAR DATE: the horizon rolls between cycles, so this
        // chart's day d sits `shift` periods into the older forecast. Days the
        // older forecast never covered are gaps, not zeros — the overlay only
        // draws where the two forecasts genuinely overlap.
        const shift = weeksBack(key) * rollShift(template);
        return {
          label: `${weekLabelShort(key)} · ${COMPARE_LABELS[compareMetric]}`,
          values: Array.from({ length: numPeriods }, (_v, d) =>
            d + shift < periodsOf(template).count ? metricAt(d + shift) : null,
          ),
          color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
          kind: 'line' as const,
          dashed: true,
        };
      }),
    [compareWeeks, compareMetric, entity, template, numCats, numPeriods, weeksBack],
  );

  const toggleCompareWeek = (key: string) =>
    setCompareWeeks((prev) =>
      prev.includes(key) ? prev.filter((w) => w !== key) : [...prev, key],
    );

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

  /** Approver's decision, made without leaving the forecast they just read. */
  const [decisionVersion, setDecisionVersion] = useState(0);
  // The entity's EFFECTIVE workflow state (seed + stored + decision map) —
  // the local record alone reads "draft" for a forecast never opened here,
  // which would hide the Approve button from the very person it is for.
  const approvalState = useMemo(() => {
    if (!canApprove) return null;
    void decisionVersion;
    const ent = listEntities().find((e) => e.name === entity);
    if (!ent) return null;
    return mergedEntityStatus(ent, week, template.id, loadApprovals(activeCycleId()));
  }, [canApprove, entity, week, template.id, decisionVersion]);
  const showApprove =
    canApprove &&
    week === currentWeekKey() &&
    approvalState !== null &&
    approvalState !== 'approved' &&
    approvalState !== 'rejected';

  const approveThis = async () => {
    const confirmed = await confirm({
      title: 'Approve forecast',
      message: `Approve the ${entity} forecast for ${weekLabel(week)}? The submitter sees the decision immediately.`,
      confirmLabel: 'Approve',
    });
    if (!confirmed) return;
    applyApprovalDecision(week, entity, template.id, 'approved');
    setStatus('approved');
    setDecisionVersion((n) => n + 1);
    await notify({ tone: 'success', message: `${entity} approved for ${weekLabelShort(week)}.` });
  };

  const flowDelta =
    flowCell && flowCell.prior !== null
      ? ((flowCell.current - flowCell.prior) / Math.max(Math.abs(flowCell.prior), 1)) * 100
      : null;

  return (
    <>
      <TopBar
        crumb={`Submission · ${weekLabelShort(week)}`}
        title="Forecast Entry"
        actions={
          <>
            <StatusPill
              status={canApprove && approvalState ? approvalState : status === 'draft' ? 'submitted' : status}
              label={canApprove && approvalState ? approvalState : status}
            />
            {showApprove && (
              <button
                className="btn btn-success"
                data-tour="approve-forecast"
                title="Approve this forecast — the decision lands on the submitter's screen"
                onClick={approveThis}
              >
                ✓ Approve Forecast
              </button>
            )}
            {readOnly && !canApprove && (
              <ViewOnlyBadge hint="Read-only — only submitters edit forecasts" />
            )}
            {activeCycle && <CyclePill label="Active cycle" value={activeCycle.id} />}
          </>
        }
      />
      <div className="content">
        {needInput && (
          <div className="variance-panel needs-input" data-tour="needs-input">
            <h4>
              ◉ {needInput.size} cell{needInput.size === 1 ? ' still needs' : 's still need'} a
              number
            </h4>
            <div className="row">
              <span>
                The highlighted cells below are empty. Fill them in, or submit anyway if they
                are genuinely nil for this period.
              </span>
              <span className="row-flex">
                <button className="btn btn-ghost" onClick={() => setNeedInput(null)}>
                  Keep Editing
                </button>
                <button className="btn btn-primary" onClick={submit}>
                  Submit Anyway
                </button>
              </span>
            </div>
          </div>
        )}
        {openRequests.length > 0 && (
          <div className="variance-panel comment-request-panel">
            <h4>
              ✎ {openRequests.length} question{openRequests.length === 1 ? '' : 's'} from Treasury
            </h4>
            <div className="row">
              <span>
                Cells outlined in blue have a question waiting. Click one to read it and reply.
              </span>
              <span>
                {openRequests[0].from} · {cellLabelFor(openRequests[0].key)}
              </span>
            </div>
          </div>
        )}
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
                    title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
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
                  {/* Saving and submitting live WITH the other actions — the
                      one place a submitter already works, not a distant bar. */}
                  <span className="toolbar-sep" aria-hidden="true" />
                  <button className="btn btn-ghost btn-save-draft" onClick={saveDraft}>
                    Save Draft
                  </button>
                  <button
                    className="btn btn-primary"
                    data-tour="submit-forecast"
                    onClick={submit}
                  >
                    Submit for Approval
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
        </div>

        {/* The grid gets its own box, so the day/category headers read as the
            top of the data rather than blending into the toolbar above. */}
        <div className="panel grid-panel">
          <div className="forecast-grid-wrap" data-tour="forecast-grid">
            <ForecastGrid
              key={restoreVersion}
              categories={template.categories}
              layout={orientation}
              dayLabels={dayLabels}
              values={values}
              flags={flags}
              requested={requestedCells}
              highlight={flow ? new Set([flow.queue[flow.idx]]) : needInput}
              highlightTone={flow ? 'flow' : 'input'}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              startingBalance={startingBalance}
              editable={!readOnly}
              onChangeCell={setCell}
              onPaste={handlePaste}
              onCellClick={openVariance}
              clickableCells={canRequestComments ? 'all' : 'flagged'}
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
          {/* Overlay earlier cycles on the same axes, so this week's shape can
              be read against the ones it replaced. */}
          <div className="chart-controls compare-controls" data-tour="compare-cycles">
            <span className="grid-info">
              <strong>Compare with</strong>
            </span>
            {priorWeekOptions.map((o) => (
              <label
                key={o.week}
                className={`series-check${o.saved ? '' : ' text-muted'}`}
                title={o.saved ? 'Saved forecast' : 'No saved forecast for this week'}
              >
                <input
                  type="checkbox"
                  checked={compareWeeks.includes(o.week)}
                  onChange={() => toggleCompareWeek(o.week)}
                />
                {o.label}
                {o.saved ? ' ●' : ''}
              </label>
            ))}
            <select
              className="form-select"
              style={{ width: 'auto', marginLeft: 'auto', padding: '5px 10px' }}
              value={compareMetric}
              onChange={(e) => setCompareMetric(e.target.value as CompareMetric)}
              aria-label="Comparison metric"
            >
              {(Object.keys(COMPARE_LABELS) as CompareMetric[]).map((m) => (
                <option key={m} value={m}>
                  Compare · {COMPARE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          {chartSeries.length + overlaySeries.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <p>Select at least one series to plot.</p>
            </div>
          ) : (
            <Chart
              labels={dayLabels.map((dl) => dl.dm)}
              series={[...overlaySeries, ...chartSeries]}
              unit="k"
            />
          )}
        </div>
      </div>

      {/* The commentary walkthrough's box: docked to the side away from the
          spotlit cell so the numbers stay in view, and deliberately NOT a
          modal — the grid behind it keeps working (collapse, scroll, read). */}
      {flow && flowCell && (
        <div
          className={`comment-flow-panel side-${flowSide}`}
          role="dialog"
          aria-label="Explain this variance"
        >
          <div className="cfp-head">
            <h4>Explain this variance</h4>
            <span className="cfp-progress">
              {flow.idx + 1} of {flow.queue.length}
            </span>
            <button
              className="close-btn"
              aria-label="Stop and keep editing"
              title="Stop — the forecast stays a draft"
              onClick={() => setFlow(null)}
            >
              ×
            </button>
          </div>
          <div className="cfp-cell">
            <strong>{flowCell.label}</strong> · Day {flowCell.day}
          </div>
          <div className="cfp-numbers">
            <span>
              Prior:{' '}
              {flowCell.prior === null ? '—' : `€${flowCell.prior.toLocaleString()}k`}
            </span>
            <span>Current: €{flowCell.current.toLocaleString()}k</span>
            <span className={flowDelta !== null && flowDelta < 0 ? 'delta down' : 'delta up'}>
              {flowDelta === null
                ? 'new period'
                : `${flowDelta > 0 ? '+' : ''}${flowDelta.toFixed(1)}%`}
            </span>
          </div>
          <textarea
            className="form-textarea"
            autoFocus
            placeholder="What is driving this movement?"
            value={flowDraft}
            onChange={(e) => setFlowDraft(e.target.value)}
            aria-label="Variance commentary"
          />
          <div className="cfp-actions">
            <button className="btn btn-ghost" onClick={skipFlowCell}>
              Skip
            </button>
            <button
              className="btn btn-primary"
              disabled={!flowDraft.trim()}
              onClick={saveFlowComment}
            >
              {flow.idx + 1 === flow.queue.length ? 'Save & Submit' : 'Save & Next'}
            </button>
          </div>
        </div>
      )}

      <Modal
        open={varianceCell !== null}
        title={
          canRequestComments
            ? 'Request Commentary'
            : readOnly
              ? 'Variance Detail'
              : 'Explain Variance'
        }
        onClose={() => setVarianceCell(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setVarianceCell(null)}>
              {canRequestComments || readOnly ? 'Close' : 'Cancel'}
            </button>
            {/* Treasury and approvers ASK; only the submitter writes the
                commentary, so the two roles never share a Save button. */}
            {canRequestComments ? (
              <button
                className="btn btn-primary"
                onClick={sendCommentRequest}
                title="Ask the submitter to explain this cell and email them about it"
              >
                Send Request
              </button>
            ) : (
              !readOnly && (
                <button className="btn btn-primary" onClick={saveComment}>
                  Save
                </button>
              )
            )}
          </>
        }
      >
        {varianceCell && (
          <>
            <div className="variance-panel" style={{ marginBottom: 18 }}>
              <h4>{flags.has(varianceCell.key) ? 'Flagged Cell' : 'Cell'}</h4>
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
            {commentRequests[varianceCell.key] && (
              <div className="comment-request-note">
                <strong>{commentRequests[varianceCell.key].from} asked:</strong>{' '}
                {commentRequests[varianceCell.key].message}
              </div>
            )}
            {canRequestComments ? (
              <>
                {/* What the submitter has said so far, as context — read-only,
                    because writing their commentary for them is not the job. */}
                <div className="form-group">
                  <label className="form-label">Submitter’s commentary</label>
                  <div className="readback">
                    {commentDraft.trim() || 'No commentary provided yet.'}
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">What do you want explained?</label>
                  <textarea
                    className="form-textarea"
                    placeholder="e.g. This is triple last week's payables — is a one-off settlement included?"
                    value={requestDraft}
                    onChange={(e) => setRequestDraft(e.target.value)}
                    aria-label="Request message"
                  />
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    Sending marks the cell for the submitter and opens an Outlook draft to them.
                  </span>
                </div>
              </>
            ) : (
              <div className="form-group" style={{ marginBottom: 0 }}>
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
            )}
          </>
        )}
      </Modal>
    </>
  );
}
