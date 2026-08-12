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
import { listEntities, seedUsers } from '../../data/appData';
import { activeWeekKey, cycleForWeek } from '../../data/cycleService';
import {
  shiftWeeks,
  horizonWeeks,
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
  isHandedOver,
  isVariance,
  loadDraftCheckpoint,
  markRequestsSeen,
  peekSubmission,
  priorValueFor,
  requestComment,
  saveDraftCheckpoint,
  unseenRequestKeys,
  settingsForEntity,
  templatesForEntity,
} from '../../data/submissionService';
import { currentUser } from '../../data/session';
import { useDataVersion } from '../../data/useDataVersion';
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
  /**
   * Run the submit flow as soon as the grid is up. The checklist's preview
   * modal sends this when submitting needs the page — missing numbers get
   * spotlit, unexplained variances start the guided commentary flow.
   */
  autoSubmit?: boolean;
}

interface SubmissionProps {
  initial?: SubmissionTarget;
  /** Restrict the entity selector (analyst scoping); undefined = all. */
  allowedEntities?: string[];
  /** Viewer role: the grid and all write actions are read-only. */
  readOnly?: boolean;
  /** Treasury and approvers: may ask the submitter for commentary on a cell. */
  canRequestComments?: boolean;
  /** Approver: may approve the forecast straight from this screen. */
  canApprove?: boolean;
  /**
   * Treasury proper. Approvers share `canRequestComments`, but only treasury
   * chases an approver by email — to an approver that button writes to
   * themselves, and a submitter's approver is notified on submit.
   */
  isTreasury?: boolean;
}

export function Submission({
  initial,
  allowedEntities,
  readOnly = false,
  canRequestComments = false,
  canApprove = false,
  isTreasury = false,
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
  const [week, setWeek] = useState(() => initial?.week ?? activeWeekKey());

  const available = templatesForEntity(templates, entity);
  const [templateId, setTemplateId] = useState(() => initial?.templateId ?? available[0]?.id ?? '');
  const template = available.find((t) => t.id === templateId) ?? available[0] ?? null;

  // A submitter forecasts whatever the active cycle says, on the template
  // Legal Entity Setup assigns — the period and template pickers are
  // treasury's (and a reviewer's) tools, not theirs.
  const fixedCycle = !readOnly && !canRequestComments;

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
        focusCell={initial?.focusCell}
        orientation={orientationOverride ?? template.layout}
        onChangeOrientation={setOrientationOverride}
        readOnly={readOnly}
        canRequestComments={canRequestComments}
        canApprove={canApprove}
        isTreasury={isTreasury}
        autoSubmit={initial?.autoSubmit === true}
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
            {fixedCycle ? (
              // The cycle decides the period; the admin decides the template.
              // Show WHAT is being forecast instead of asking them to pick it.
              <CycleScope week={week} template={template} />
            ) : (
              <>
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
            )}
          </>
        }
      />
    </div>
  );
}

/**
 * The period a submitter is forecasting, read from the active cycle rather
 * than picked: cycle id, week and the horizon's date range. Deep links to a
 * past week (View Previous) label themselves as such.
 */
function CycleScope({ week, template }: { week: string; template: ForecastTemplate }) {
  // The cycle that collects THIS week, not just whichever one is open — a
  // deep link to a past week used to be labelled with the active cycle's id.
  const cycle = useMemo(() => cycleForWeek(week), [week]);
  const dates = templateDates(template, week);
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
  const range =
    dates.length > 0 ? `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}` : '';
  const isCurrent = week === activeWeekKey();
  return (
    <span
      className="cycle-scope"
      data-tour="cycle-scope"
      title="The forecast period comes from the active cycle — Treasury manages cycles"
    >
      <span className="dot" />
      <strong>{isCurrent ? (cycle?.id ?? weekLabelShort(week)) : weekLabelShort(week)}</strong>
      <span className="range">{range}</span>
      {!isCurrent && <span className="tag-past">past week</span>}
    </span>
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
  /** Approver: may approve this forecast in place. */
  canApprove: boolean;
  /** Treasury proper — the only role that emails an approver from here. */
  isTreasury: boolean;
  /** Kick off the submit flow once the grid is up (checklist deep link). */
  autoSubmit: boolean;
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

/** Which measure the prior-cycle overlays plot. */
type CompareMetric = 'net' | 'balance' | 'inflows' | 'outflows';

const COMPARE_LABELS: Record<CompareMetric, string> = {
  net: 'Net Cash Flow',
  balance: 'Running Balance',
  inflows: 'Inflows',
  outflows: 'Outflows',
};

/** Distinct from the live series' colours so an overlay is never mistaken for
 *  this week's line; warm enough to sit with the design tokens. */
// The palette's light accents, which is exactly what they are for: an
// overlay has to be legible without competing with this cycle's line.
const OVERLAY_COLORS = ['#87a1c2', '#92b771', '#c5b6af', '#23599c'];

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
  isTreasury,
  autoSubmit,
  selectors,
}: EditorProps) {
  // Variance rules are per entity (Legal Entity Setup), falling back to the
  // group defaults — so a small entity can be held to a wider threshold.
  const settings = useMemo(
    () => settingsForEntity(entity, loadSettings(DEFAULT_SETTINGS)),
    [entity],
  );
  const { confirm, notify } = useDialog();
  /**
   * Whose screen this is. Treasury opens forecasts to read and correct them,
   * never to run the submission workflow, so undo/redo, reset, copy-prior,
   * save-draft and submit belong to the submitter alone.
   */
  const isSubmitterView = !readOnly && !canRequestComments;
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
  /**
   * Keep the status pill honest when the forecast's state changes underneath
   * this screen — asking a question reopens the forecast, and the header was
   * left claiming "approved" over a banner saying a question was waiting.
   * Only the status is re-read: the grid's own values are local edit state and
   * must not be replaced from storage mid-keystroke.
   */
  const dataVersion = useDataVersion();
  useEffect(() => {
    const stored = loadSubmission(week, entity, template.id);
    if (stored && stored.status !== status) setStatus(stored.status);
    // `status` is the value being reconciled, not an input to the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, week, entity, template.id]);
  const [commentRequests, setCommentRequests] = useState<Record<string, CommentRequest>>(
    initial.commentRequests ?? {},
  );
  /**
   * The forecast is with the approver (or already approved), so the submitter
   * may no longer change the numbers — only answer questions on them. Greying
   * the checklist's Submit button was not enough on its own: the forecast page
   * was still a live grid, and an edit there rewrote what had already been
   * signed off. Treasury keeps its correcting rights; a returned forecast
   * comes back to `rejected` and unlocks.
   */
  const handedOver = isSubmitterView && isHandedOver(status);
  /** Numbers can be typed into: never for a reader, never once handed over. */
  const canEditCells = !readOnly && !handedOver;
  /** The submitter's own data-entry and workflow actions. */
  const editorActions = isSubmitterView && !handedOver;

  const [varianceCell, setVarianceCell] = useState<VarianceCell | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  /** Treasury's question, while it is being written in the cell dialog. */
  const [requestDraft, setRequestDraft] = useState('');
  /**
   * The guided commentary flow that runs on submit: the flagged cell being
   * explained right now, with the commentary dock beside the grid — on the
   * left when the cell sits in the right half of the view, so the cell and
   * the box are never on top of each other.
   */
  const [commentFlow, setCommentFlow] = useState<{ key: string; side: 'left' | 'right' } | null>(
    null,
  );
  const [flowDraft, setFlowDraft] = useState('');
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
  // The chart sits above the grid and folds away — a submitter filling in
  // twenty days of numbers wants the rows, not the picture, most of the time.
  const [chartOpen, setChartOpen] = useState(false);
  /** Earlier forecast weeks overlaid on the chart for comparison. */
  const [compareWeeks, setCompareWeeks] = useState<string[]>([]);
  const [compareMetric, setCompareMetric] = useState<CompareMetric>('net');
  // Text held while the starting balance is being typed (see NumberCell).
  const [balanceDraft, setBalanceDraft] = useState<string | null>(null);

  // Sections start collapsed for anyone who came to READ the forecast —
  // treasury, approvers, viewers — because the shape is the point and every
  // line item is noise. Whoever is entering the numbers needs them open.
  const sections = useMemo(
    () =>
      categoryGroups(template.categories)
        .map((g, gi) => (g.label ? gi : -1))
        .filter((gi) => gi >= 0),
    [template],
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(() =>
    readOnly || canRequestComments || handedOver ? new Set(sections) : new Set(),
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
    const record = {
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
    };
    saveSubmission(record);
    return record;
  };

  // Ctrl/Cmd+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo — anywhere on the screen,
  // so it works whether or not a cell has focus. Bound on the document
  // because the grid's own inputs would otherwise swallow the keystroke.
  useEffect(() => {
    if (!canEditCells) return;
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
    // A checkpoint recorded by Save Draft outranks the starting data: reset
    // means "back to what I last deliberately saved", not "start over".
    // Reset means "back to the last saved state", never "start over from
    // generated data" — a finance user reading that button does not expect it
    // to replace their week with numbers the app made up. An explicit Save
    // Draft is the restore point; failing that, the forecast as it was when
    // this screen opened.
    const checkpoint = loadDraftCheckpoint(week, entity, template.id) ?? initial;
    const savedExplicitly = loadDraftCheckpoint(week, entity, template.id) !== null;
    const confirmed = await confirm({
      title: 'Reset forecast',
      message: savedExplicitly
        ? 'Reset all values back to your last saved draft? Changes made since that save will be lost.'
        : 'Reset all values back to how this forecast was when you opened it? Changes made since will be lost.',
      confirmLabel: 'Reset Values',
      danger: true,
    });
    if (!confirmed) return;
    pushUndo();
    lastEditedCell.current = null;
    // Same treatment as undo: remount the cells so no in-progress text
    // lingers over the restored values.
    setRestoreVersion((n) => n + 1);
    const restoredFlags = new Set(checkpoint.flags);
    setValues(checkpoint.values);
    setFlags(restoredFlags);
    setComments(checkpoint.comments ?? {});
    setDayComments(checkpoint.dayComments ?? {});
    setStartingBalance(checkpoint.startingBalance ?? null);
    persist({
      values: checkpoint.values,
      flags: restoredFlags,
      comments: checkpoint.comments ?? {},
      dayComments: checkpoint.dayComments ?? {},
      startingBalance: checkpoint.startingBalance ?? null,
    });
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
        .querySelector(`.forecast-grid [data-cat="${c}"][data-day="${d}"]`)
        ?.scrollIntoView({ block: 'center', inline: 'center' });
    });
    // openVariance is stable for a given render of this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCell]);

  /**
   * A question asked while the submitter was away reopens their forecast, so
   * the first time they come back to it, land on the cell that was asked
   * about rather than on a grid of 240 numbers with a flag somewhere in it.
   * Marked seen immediately, so this happens once per question, not on every
   * visit — and never when a deep link has already chosen a cell.
   */
  useEffect(() => {
    if (!isSubmitterView || focusCell || focusedOnce.current) return;
    const unseen = unseenRequestKeys(initial);
    if (unseen.length === 0) return;
    const [c, d] = unseen[0].split('-').map(Number);
    if (!Number.isFinite(c) || !Number.isFinite(d)) return;
    focusedOnce.current = true;
    markRequestsSeen(initial);
    openVariance(c, d);
    requestAnimationFrame(() => {
      document
        .querySelector(`.forecast-grid [data-cat="${c}"][data-day="${d}"]`)
        ?.scrollIntoView({ block: 'center', inline: 'center' });
    });
    // openVariance is stable for a given render of this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, isSubmitterView, focusCell]);

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

  // ---- Guided commentary flow (runs on submit) ---------------------------
  // Submitting with unexplained variances used to raise a dialog over the
  // grid. Now the flow works IN the grid: each flagged cell is spotlit in
  // turn (the rest lightly shaded, still readable), its section expanded if
  // collapsed, with the commentary box docked beside the numbers.

  /** Flagged cells still without commentary, in reading order. */
  const orderedUncommented = (cm: Record<string, string> = comments): string[] =>
    [...flags]
      .filter((k) => !cm[k]?.trim())
      .sort((a, b) => {
        const [ac, ad] = a.split('-').map(Number);
        const [bc, bd] = b.split('-').map(Number);
        return ac - bc || ad - bd;
      });

  /** Expand the section holding a cell — a spotlight inside a collapsed
   * group would point at nothing. */
  const expandSectionOf = (key: string) => {
    const [c] = key.split('-').map(Number);
    const gi = categoryGroups(template.categories).findIndex((g) => g.idxs.includes(c));
    if (gi < 0) return;
    setCollapsedGroups((prev) => {
      if (!prev.has(gi)) return prev;
      const next = new Set(prev);
      next.delete(gi);
      return next;
    });
  };

  /** Move the flow to a cell: expand, scroll it into view, then dock the
   * commentary box on whichever side keeps the cell visible. */
  const focusFlowCell = (key: string) => {
    expandSectionOf(key);
    setFlowDraft(comments[key] ?? '');
    setCommentFlow((prev) => ({ key, side: prev?.side ?? 'right' }));
    // Two frames: one for the section to expand, one for the dock to mount
    // (it narrows the grid before anything is measured).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const [c, d] = key.split('-').map(Number);
        const cell = document
          .querySelector(`.forecast-grid input[data-cat="${c}"][data-day="${d}"]`)
          ?.closest('td');
        const wrap = document.querySelector('.forecast-grid-wrap');
        if (!cell || !wrap) return;
        cell.scrollIntoView({ block: 'center', inline: 'center' });
        const cellRect = cell.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const side =
          cellRect.left + cellRect.width / 2 > wrapRect.left + wrapRect.width / 2
            ? 'left'
            : 'right';
        setCommentFlow({ key, side });
      }),
    );
  };

  const cancelFlow = () => {
    setCommentFlow(null);
    setFlowDraft('');
  };

  /**
   * The actual submission, once every gate has been passed (or waived).
   *
   * `snap` carries anything saved in the same tick as the submit — the last
   * variance's commentary, written in the dock and immediately followed by
   * the submit it triggers. Without it, `persist` fell back to the `comments`
   * state, which React has not applied yet, and the final explanation was
   * overwritten by the map from before it was typed. One flagged cell was
   * therefore left unexplained on every guided submission.
   */
  const finishSubmit = async (snap: Snapshot = {}) => {
    setNeedInput(null);
    setCommentFlow(null);
    setStatus('submitted');
    persist({ ...snap, status: 'submitted' });
    // A fresh submission reopens the decision: without this, a rejection
    // stuck in the cycle's approval map forever and the approver saw the
    // resubmitted forecast as already "rejected" with no way to approve it.
    clearApprovalDecision(entity);
    await notify({ tone: 'success', message: 'Forecast submitted for approval.' });
  };

  /** Save the docked commentary and walk on to the next flagged cell —
   * or submit, when this was the last one. */
  const saveFlowComment = () => {
    if (!commentFlow) return;
    const text = flowDraft.trim();
    if (!text) return;
    const nextComments = { ...comments, [commentFlow.key]: text };
    setComments(nextComments);
    // Answering the question closes it — treasury asked, this is the reply.
    const nextRequests = answerCommentRequest({ ...initial, commentRequests }, commentFlow.key);
    setCommentRequests(nextRequests ?? {});
    persist({ comments: nextComments, commentRequests: nextRequests ?? {} });
    const remaining = orderedUncommented(nextComments);
    if (remaining.length === 0)
      void finishSubmit({ comments: nextComments, commentRequests: nextRequests ?? {} });
    else focusFlowCell(remaining[0]);
  };

  const submit = async () => {
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
    const pending = orderedUncommented();
    if (pending.length > 0) {
      setNeedInput(null);
      focusFlowCell(pending[0]);
      return;
    }
    await finishSubmit();
  };

  // Deep link from the checklist's preview modal: it wanted to submit but
  // the forecast still has gaps, so run the submit flow here where the
  // spotlights and the commentary dock live.
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (!autoSubmit || !editorActions || autoSubmitted.current) return;
    autoSubmitted.current = true;
    // Let the grid render once before spotlighting and scrolling.
    const id = setTimeout(() => void submit(), 300);
    return () => clearTimeout(id);
    // submit is recreated per render; this must only ever run on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDraft = async () => {
    // Persist AND record the checkpoint Reset returns to.
    saveDraftCheckpoint(persist());
    await notify({
      tone: 'success',
      message: 'Draft saved. Reset now returns to this point.',
    });
  };

  /** Approver signs the forecast off without leaving the page. */
  const approveForecast = async () => {
    applyApprovalDecision(week, entity, template.id, 'approved');
    setStatus('approved');
    await notify({
      tone: 'success',
      message: `${entity} forecast approved for ${weekLabel(week)}.`,
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
  // from memory.
  // Only the cycles that still overlap this horizon can be compared against
  // it, so how many there are follows the configured horizon rather than a
  // hardcoded four.
  const priorWeekOptions = useMemo(() => {
    const out: { week: string; label: string; saved: boolean }[] = [];
    for (let back = 1; back <= horizonWeeks(); back++) {
      const key = shiftWeeks(week, -back);
      out.push({
        week: key,
        label: weekLabelShort(key),
        saved: loadSubmission(key, entity, template.id) !== null,
      });
    }
    return out;
  }, [week, entity, template.id]);

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
        return {
          label: `${weekLabelShort(key)} · ${COMPARE_LABELS[compareMetric]}`,
          values: Array.from({ length: numPeriods }, (_v, d) => metricAt(d)),
          color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
          kind: 'line' as const,
          dashed: true,
        };
      }),
    [compareWeeks, compareMetric, entity, template, numCats, numPeriods],
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

  // ---- The docked commentary box for the guided flow ---------------------
  const flowCell = useMemo(() => {
    if (!commentFlow) return null;
    const [c, d] = commentFlow.key.split('-').map(Number);
    return {
      key: commentFlow.key,
      label: template.categories[c]?.label ?? `Line ${c + 1}`,
      dateLabel: dayLabels[d] ? `${dayLabels[d].dow} ${dayLabels[d].dm}` : `Day ${d + 1}`,
      prior: priorValueFor(prior, c, d, template),
      current: values[commentFlow.key] || 0,
    };
  }, [commentFlow, template, dayLabels, prior, values]);

  const flowDelta =
    flowCell && flowCell.prior !== null
      ? ((flowCell.current - flowCell.prior) / Math.max(Math.abs(flowCell.prior), 1)) * 100
      : null;
  const flowRemaining = commentFlow ? orderedUncommented().length : 0;

  const commentDock = commentFlow && flowCell && (
    <aside
      className={`comment-dock dock-${commentFlow.side}`}
      aria-label="Explain this variance"
    >
      <div className="comment-dock-head">
        <h4>Explain variance</h4>
        <button className="close-btn" onClick={cancelFlow} aria-label="Stop and keep editing">
          ×
        </button>
      </div>
      <div className="comment-dock-cell">
        <strong>{flowCell.label}</strong>
        <span className="text-dim">{flowCell.dateLabel}</span>
      </div>
      <div className="comment-dock-figures">
        <span>Prior {flowCell.prior === null ? '—' : fmtK(flowCell.prior)}</span>
        <span>Now {fmtK(flowCell.current)}</span>
        <span className={`delta ${flowDelta !== null && flowDelta < 0 ? 'down' : 'up'}`}>
          {flowDelta === null ? 'new period' : `${flowDelta > 0 ? '+' : ''}${flowDelta.toFixed(1)}%`}
        </span>
      </div>
      {commentRequests[flowCell.key] && (
        <div className="comment-request-note">
          <strong>{commentRequests[flowCell.key].from} asked:</strong>{' '}
          {commentRequests[flowCell.key].message}
        </div>
      )}
      <textarea
        className="form-textarea"
        autoFocus
        placeholder="What drives this change vs last week?"
        value={flowDraft}
        onChange={(e) => setFlowDraft(e.target.value)}
        aria-label="Commentary"
      />
      <div className="comment-dock-actions">
        <button
          className="btn btn-primary"
          disabled={!flowDraft.trim()}
          onClick={saveFlowComment}
        >
          {flowRemaining > 1 ? 'Save · Next Variance' : 'Save · Submit'}
        </button>
        <button className="btn btn-ghost" onClick={cancelFlow}>
          Keep Editing
        </button>
      </div>
      <button className="comment-dock-skip" onClick={() => void finishSubmit()}>
        Submit without commentary
      </button>
      <div className="comment-dock-progress">
        {flowRemaining} variance{flowRemaining === 1 ? '' : 's'} left to explain
      </div>
    </aside>
  );

  return (
    <>
      {/* The entity lives in the toolbar's selector, and Save/Submit live in
          the actions box — the top bar only says where in the cycle we are. */}
      <TopBar
        crumb={`Submission · ${weekLabelShort(week)}`}
        title="Forecast Entry"
        actions={
          <>
            <StatusPill status={status === 'draft' ? 'submitted' : status} label={status} />
            {readOnly && <ViewOnlyBadge hint="Read-only — only submitters edit forecasts" />}
            {handedOver && (
              <ViewOnlyBadge
                hint={`Submitted — the numbers are locked until this forecast is returned to you. You can still answer questions on any cell.`}
              />
            )}
            <CyclePill label="Active cycle" value={activeCycleId()} />
          </>
        }
      />
      <div className="content content-compact">
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
        {handedOver && (
          <div className="variance-panel handover-panel">
            <h4>✓ Submitted — {status === 'approved' ? 'approved' : 'with your approver'}</h4>
            <div className="row">
              <span>
                The numbers are locked while this forecast is being reviewed. Commentary is
                still yours to write. If a figure has to change, ask your approver to return
                the forecast to you.
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
Cells outlined in blue have a question waiting.
              </span>
              <span>
                {openRequests[0].from} · {cellLabelFor(openRequests[0].key)}
              </span>
            </div>
          </div>
        )}
        {/* The variance banner is now the small ⚠ badge in the toolbar below —
            a whole panel of prose for a number the grid already colours in
            cost more space than it earned. */}

        <div className="panel settings-panel">
          <div className="grid-toolbar">
            <div className="grid-toolbar-left" data-tour="submission-filters">{selectors}</div>
            <div className="row-flex">
              {/* Flagged cells are announced by a badge rather than a banner:
                  it says the same thing in a tenth of the space, and clicking
                  it walks straight to the first cell that needs explaining. */}
              {flags.size > 0 && (
                <button
                  className={`variance-badge${uncommented.length > 0 ? ' open' : ' clear'}`}
                  data-tour="variance-badge"
                  title={
                    uncommented.length > 0
                      ? `${uncommented.length} of ${flags.size} flagged cell${flags.size === 1 ? '' : 's'} still need commentary — click to explain the first`
                      : `${flags.size} flagged cell${flags.size === 1 ? '' : 's'}, all explained`
                  }
                  onClick={() => {
                    const [first] = orderedUncommented();
                    if (!first) return;
                    // The guided flow ends by SUBMITTING, so it is only ever
                    // offered on a forecast that is still the submitter's.
                    if (editorActions) {
                      focusFlowCell(first);
                    } else {
                      const [c, d] = first.split('-').map(Number);
                      openVariance(c, d);
                    }
                  }}
                >
                  <span aria-hidden="true">⚠</span>
                  {uncommented.length > 0 ? uncommented.length : flags.size}
                  <span className="variance-badge-label">
                    {uncommented.length > 0 ? 'to explain' : 'flagged'}
                  </span>
                </button>
              )}
              {/* Treasury reads and fixes forecasts but never submits one, so
                  the entry actions are the submitter's alone. */}
              {editorActions && (
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
              {/* Only treasury chases an approver — the approver IS the
                  recipient, and a submitter's approver is emailed on submit. */}
              {isTreasury && (
                <button className="btn btn-ghost" data-tour="email-approver" onClick={emailApprover}>
                  Email Approver
                </button>
              )}
              {editorActions && (
                <>
                  <button className="btn btn-ghost" onClick={copyPrior}>
                    Copy Prior Forecast
                  </button>
                  <button className="btn btn-ghost" onClick={reset}>
                    Reset
                  </button>
                  {/* Saving and submitting sit with the other actions, set
                      apart so they read as the two that matter. */}
                  <span className="toolbar-divider" aria-hidden="true" />
                  <button
                    className="btn btn-ghost btn-save-draft"
                    data-tour="save-draft"
                    title="Keep a checkpoint — Reset returns to it"
                    onClick={saveDraft}
                  >
                    Save Draft
                  </button>
                  <button
                    className="btn btn-primary"
                    data-tour="submit-forecast"
                    disabled={commentFlow !== null}
                    onClick={submit}
                  >
                    Submit for Approval
                  </button>
                </>
              )}
              {canApprove && status !== 'approved' && (
                <>
                  <span className="toolbar-divider" aria-hidden="true" />
                  <button
                    className="btn btn-success"
                    data-tour="approve-forecast"
                    title="Approve this forecast as reviewed"
                    onClick={approveForecast}
                  >
                    Approve Forecast
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="grid-toolbar" style={{ borderTop: 'none' }}>
            <div className="grid-toolbar-left">
              <div className="grid-info">
                <strong>{template.name}</strong>{' '}
                <span className="text-muted">EUR thousands · inflows +, outflows −</span>
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
                disabled={!canEditCells}
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

            </div>
          </div>
        </div>

        {/* The outlook sits ABOVE the numbers: the shape of the week is what
            you check a figure against, and it folds away when it is not. */}
        <div className="panel chart-panel" data-tour="forecast-chart">
          <button
            className="panel-collapse-head"
            aria-expanded={chartOpen}
            onClick={() => setChartOpen((v) => !v)}
          >
            <span className="section-caret" aria-hidden="true">
              {chartOpen ? '▾' : '▸'}
            </span>
            <strong>Running Balance Outlook</strong>
            <span className="text-muted">
              {weekLabelShort(week)} · €k
              {hasBalance ? ` · closing ${fmtK(closingBalance)}` : ''}
            </span>
          </button>
          {chartOpen && (
            <>
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
              {/* Overlay earlier cycles on the same axes, so this week's shape
                  can be read against the ones it replaced. */}
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
                <div className="empty-state" style={{ padding: '30px 20px' }}>
                  <p>Select at least one series to plot.</p>
                </div>
              ) : (
                <Chart
                  labels={dayLabels.map((dl) => dl.dm)}
                  series={[...overlaySeries, ...chartSeries]}
                  unit="k"
                  height={176}
                />
              )}
            </>
          )}
        </div>

        {/* The forecast itself, in its own box — the controls above are
            settings, not part of the grid. */}
        <div className="panel grid-panel">
          {/* The commentary dock sits BESIDE the grid (left when the spotlit
              cell is on the right half), so the numbers stay in view while
              the explanation is written. */}
          <div className="grid-flow-row">
            {commentFlow?.side === 'left' && commentDock}
            <div className="forecast-grid-wrap" data-tour="forecast-grid">
              <ForecastGrid
                key={restoreVersion}
                categories={template.categories}
                layout={orientation}
                dayLabels={dayLabels}
                values={values}
                flags={flags}
                requested={requestedCells}
                highlight={commentFlow ? new Set([commentFlow.key]) : needInput}
                highlightTone={commentFlow ? 'comment' : 'input'}
                collapsedGroups={collapsedGroups}
                onToggleGroup={toggleGroup}
                startingBalance={startingBalance}
                editable={canEditCells}
                onChangeCell={setCell}
                onPaste={handlePaste}
                onCellClick={openVariance}
                clickableCells={canRequestComments ? 'all' : 'flagged'}
                showColumnTotals={template.columnTotals === true}
              />
            </div>
            {commentFlow?.side === 'right' && commentDock}
          </div>
        </div>

      </div>

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
                {handedOver && (
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    The numbers are with your approver, but commentary on them is still yours
                    to add.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
