import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { ActionMenu } from '../common/ActionMenu';
import { QuestionStrip } from './QuestionStrip';
import { MirrorTable } from './MirrorTable';
import { Chart, CHART_COLORS, OVERLAY_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from './ForecastGrid';
import { RequestCommentaryModal } from './RequestCommentaryModal';
import {
  categoryGroups,
  cellKey,
  dayInflows,
  dayNet,
  dayOutflows,
  groupIsEmpty,
  hasAnyValue,
  parseCellNumber,
  runningBalance,
  type GridValues,
} from './gridMath';
import { QuestionThread } from '../review/QuestionThread';
import { clearFlowState, loadFlowState, saveFlowState } from '../../data/flowState';
import { listEntities, seedUsers } from '../../data/appData';
import { activeWeekKey, isCycleOpenForEntity } from '../../data/cycleService';
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
  figuresEditable,
  getOrCreateSubmission,
  getPriorValues,
  isHandedOver,
  isOpenQuestion,
  isVariance,
  loadDraftCheckpoint,
  hasSeenStartChoice,
  markRequestsSeen,
  markStartChoiceSeen,
  openQuestionEntries,
  peekSubmission,
  priorValueFor,
  saveDraftCheckpoint,
  withThreadMessage,
  statusLabel,
  threadOf,
  unseenRequestKeys,
  settingsForEntity,
  templatesForEntity,
} from '../../data/submissionService';
import {
  intercompanySections,
  mirrorFingerprint,
  mirrorPrefsFiltered,
  mirrorPrefsOf,
  mirrorPrefsToggling,
  mirrorProblem,
  mirrorStatements,
  rebuildMirrors,
  syncMirrors,
  type MirrorPrefs,
} from '../../data/intercompanyService';
import {
  customRowsOf,
  entityOptions,
  gridCatCount,
  gridCategories,
  isOwnRow,
  makeCustomRow,
  priorRowIndex,
  readingOrder,
  remapKeySet,
  remapRecord,
  remapRowKey,
  rowValues,
  withRowValues,
} from '../../data/customRows';
import { useDebounced } from './heatmap';
import {
  FORMATTING_OPTIONS,
  loadConditionalFormatting,
  saveConditionalFormatting,
  type ConditionalFormatting,
} from '../../data/viewPreferences';
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
import type { ViewId } from '../../types/nav';
import type {
  CommentRequest,
  CustomRow,
  ForecastQuestion,
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
  /**
   * Open an already-submitted forecast unlocked for editing. The checklist's
   * "Edit & Resubmit" is the decision to revise, so arriving from it should not
   * ask for that decision a second time.
   */
  revise?: boolean;
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
  /** Screen changes the header can make — treasury's cycle pill opens Cycles. */
  onNavigate?: (view: ViewId) => void;
}

export function Submission({
  initial,
  allowedEntities,
  readOnly = false,
  canRequestComments = false,
  canApprove = false,
  isTreasury = false,
  onNavigate,
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
      <div className="view active forecast-entry">
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
    /* `forecast-entry` scopes this screen's visual treatment (see the block of
       the same name in index.css). The grid, the toolbars and the outlook all
       share their class names with other screens, so the restyle hangs off the
       page root rather than off those names — nothing outside this view moves. */
    <div className="view active forecast-entry">
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
        onNavigate={onNavigate}
        autoSubmit={initial?.autoSubmit === true}
        revise={initial?.revise === true}
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
  const dates = templateDates(template, week);
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
  const range =
    dates.length > 0 ? `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}` : '';
  const isCurrent = week === activeWeekKey();
  // The cycle ID lives in the top bar, once. Repeating it here beside the
  // entity selector said the same thing twice on one screen; what this needs
  // to add is the DATES the horizon covers, which the top bar does not carry.
  return (
    <span
      className="cycle-scope"
      data-tour="cycle-scope"
      title="The forecast period comes from the active cycle — Treasury manages cycles"
    >
      <span className="dot" />
      <strong>{isCurrent ? range : weekLabelShort(week)}</strong>
      {!isCurrent && <span className="range">{range}</span>}
      {!isCurrent && <span className="tag-past">past week</span>}
    </span>
  );
}

interface VarianceCell {
  key: string;
  label: string;
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
  /** Opens the cycles screen from the header pill, where the role has one. */
  onNavigate?: (view: ViewId) => void;
  /** Kick off the submit flow once the grid is up (checklist deep link). */
  autoSubmit: boolean;
  /** Arrive with a submitted forecast already unlocked for editing. */
  revise: boolean;
  selectors: React.ReactNode;
}

/** Everything one Ctrl+Z restores: the full editable state of a forecast. */
interface EditState {
  values: GridValues;
  flags: Set<string>;
  comments: Record<string, string>;
  dayComments: Record<string, string>;
  startingBalance: number | null;
  /**
   * The rows the submitter added, because their figures are addressed BY
   * their position in this list. Restoring the values without the rows would
   * leave a column of numbers belonging to rows that are no longer there.
   */
  customRows: CustomRow[];
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
  onNavigate,
  autoSubmit,
  revise,
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
  /** Lines the TEMPLATE defines. The grid can hold more — see `gridCats`. */
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
    if (stored && stored.status !== status) {
      setStatus(stored.status);
      // …and with it, who is waiting on an answer.
      setQuestionedBy(stored.questionedBy);
    }
    // `status` is the value being reconciled, not an input to the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, week, entity, template.id]);
  const [commentRequests, setCommentRequests] = useState<Record<string, CommentRequest>>(
    initial.commentRequests ?? {},
  );
  /**
   * The rows this submitter added under the template's sections — their own
   * customers, their own counterparties. Their figures live in `values` like
   * everything else, so nothing below this line has to know they are here.
   */
  const [rows, setRows] = useState<CustomRow[]>(customRowsOf(initial));
  /** Every line the grid shows: the template's, then the submitter's own. */
  const gridCats = useMemo(() => gridCategories(template, rows), [template, rows]);
  /** Who asked the most recent question on this forecast, if anyone has. */
  const [questionedBy, setQuestionedBy] = useState<ForecastQuestion | undefined>(
    initial.questionedBy,
  );
  /** What this forecast takes from its counterparties — see `MirrorPrefs`. */
  const [mirrorPrefs, setMirrorPrefs] = useState<MirrorPrefs>(() => mirrorPrefsOf(initial));
  /** The mirroring dialog, open on a copy of the prefs until it is saved. */
  const [mirrorDraft, setMirrorDraft] = useState<MirrorPrefs | null>(null);
  /**
   * Set when this forecast's figures were changed after it had been handed
   * over: it was withdrawn from approval by that edit and has to go round the
   * cycle again.
   */
  const [revisedFrom, setRevisedFrom] = useState<SubmissionStatus | undefined>(
    initial.revisedFrom,
  );
  /**
   * The cycle collecting this week is still open, so its figures can still
   * move. This is what decides whether the grid is live: inside the cycle a
   * submitter may correct a number even after handing the forecast over (which
   * withdraws it from approval — see `withdrawFromApproval`), and once the
   * cycle closes the numbers are history and only the conversation carries on.
   */
  const cycleOpen = useMemo(() => isCycleOpenForEntity(week, entity), [week, entity]);
  /** The forecast is with the approver, or already approved. */
  const handedOver = isSubmitterView && isHandedOver(status);
  /** Submitted once, changed since, and not yet sent back. */
  const revised = isSubmitterView && revisedFrom !== undefined && status === 'draft';
  /**
   * The submitter has asked to change a forecast they already sent.
   *
   * A submitted forecast opens LOCKED, saying so, with one way in: Edit
   * Forecast. Leaving the grid live under a "submitted" pill meant a stray
   * keystroke could withdraw an approved forecast from approval with nothing
   * asked and nothing said — the consequence is real, so the decision to
   * revise is made deliberately, once, and the page then shows it is in play.
   */
  const [revising, setRevising] = useState(revise);
  /**
   * Numbers can be typed into: never for a reader, never once the cycle that
   * collects them has closed, and — after the handover — only once the
   * submitter has said they mean to revise.
   */
  const canEditCells =
    !readOnly && figuresEditable(status, cycleOpen) && (!handedOver || revising);
  /** The submitter's own data-entry and workflow actions. */
  const editorActions = isSubmitterView && canEditCells;
  /**
   * Sending it (back) to the approver is theirs whenever it is not already
   * there — and only while the cycle is open, since a forecast submitted into
   * a closed cycle would be a set of figures nobody can act on.
   */
  const canSubmit = isSubmitterView && !handedOver && cycleOpen;

  /**
   * Whatever was being written here when the screen was last left, so leaving
   * it is not the same as abandoning it: a submitter checks a figure on the
   * dashboard, reads the rest of a thread on Questions, and comes back to the
   * cell and the half-written sentence they left. Read once, at mount — the
   * editor remounts for each forecast, so this belongs to this one.
   */
  const resumed = useRef(loadFlowState(entity, week, template.id));
  /** A cell the grid still has — a template edited since then may not. */
  const resumableCell = (key: string): boolean => {
    const [c, d] = key.split('-').map(Number);
    return (
      Number.isInteger(c) &&
      Number.isInteger(d) &&
      c >= 0 &&
      c < gridCats.length &&
      d >= 0 &&
      d < numPeriods
    );
  };
  const resumable =
    resumed.current && resumableCell(resumed.current.key) ? resumed.current : null;

  const [varianceCell, setVarianceCell] = useState<VarianceCell | null>(null);
  /**
   * The cell's number as typed in the dock beside the grid. "That figure was
   * wrong" is one of the answers, so the number travels with the box asking
   * for one rather than being left in a cell the reader has to go back to.
   */
  const [valueDraft, setValueDraft] = useState(resumable?.valueDraft ?? '');
  /**
   * Whether that figure has been typed into. The grid stays live under the
   * dock — the whole point of explaining a cell beside its neighbours — so a
   * figure the dock merely SHOWED must not be written back over an edit made
   * in the cell itself. Untouched, the dock saves the commentary and leaves
   * the number to the grid.
   */
  const [valueDirty, setValueDirty] = useState(resumable?.valueDirty ?? false);
  /**
   * The commentary dock: which cell it is on, which side of the grid it sits
   * on, and WHY it is open.
   *
   * `submitting` is the guided walk that ends by sending the forecast;
   * `single` is one cell somebody clicked to explain, which ends when they
   * save it. Without the distinction, explaining one cell out of curiosity
   * submitted the whole forecast the moment it happened to be the last
   * unexplained one.
   */
  const [commentFlow, setCommentFlow] = useState<{
    key: string;
    side: 'left' | 'right';
    mode: 'submitting' | 'single';
  } | null>(resumable ? { key: resumable.key, side: 'right', mode: resumable.mode } : null);
  const [flowDraft, setFlowDraft] = useState(resumable?.draft ?? '');
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
  /**
   * The intercompany table beside the outlook. Folded by default: the chart is
   * what the card is for, and it keeps its full width until the table is
   * actually wanted.
   */
  const [mirrorsOpen, setMirrorsOpen] = useState(false);
  /** Earlier forecast weeks overlaid on the chart for comparison. */
  const [compareWeeks, setCompareWeeks] = useState<string[]>([]);
  const [compareMetric, setCompareMetric] = useState<CompareMetric>('net');
  // Text held while the starting balance is being typed (see NumberCell).
  const [balanceDraft, setBalanceDraft] = useState<string | null>(null);
  /**
   * What the conditional formatting measures a cell against — its own line,
   * the whole forecast, or nothing at all.
   *
   * A view preference rather than a property of the forecast, so it is kept
   * per browser: a reader who works in the numbers and turns the shading off
   * means it, and having to turn it off again on every forecast they open is
   * how a setting becomes an annoyance.
   */
  const [heatMode, setHeatMode] = useState<ConditionalFormatting>(loadConditionalFormatting);
  const chooseHeatMode = (mode: ConditionalFormatting) => {
    setHeatMode(mode);
    saveConditionalFormatting(mode);
  };

  // Sections start collapsed for anyone who came to READ the forecast —
  // treasury, approvers, viewers — because the shape is the point and every
  // line item is noise. Whoever is entering the numbers needs them open.
  const sections = useMemo(
    () =>
      categoryGroups(gridCats)
        .map((g, gi) => (g.label ? gi : -1))
        .filter((gi) => gi >= 0),
    [gridCats],
  );
  /**
   * Sections that hold no figures at all, and have nothing waiting on anyone.
   *
   * A section of empty rows still costs its full height on the screen, and on
   * a template with a dozen of them the numbers that DO exist end up spread
   * over two screens of nothing. These start folded to a single line so the
   * forecast opens on its actual contents — one click reopens any of them,
   * and a section holding a question or a flagged cell is never folded away,
   * because that is the one thing worth scrolling to.
   */
  const emptySections = useMemo(() => {
    // Read against the forecast AS STORED, rows and all: a section whose only
    // figures are on rows the submitter added is not an empty section.
    const opened = gridCategories(template, customRowsOf(initial));
    const groups = categoryGroups(opened);
    if (!hasAnyValue(initial.values)) return [];
    const marked = new Set([...initial.flags, ...Object.keys(initial.commentRequests ?? {})]);
    return sections.filter((gi) => {
      const g = groups[gi];
      if (!g) return false;
      if (!groupIsEmpty(opened, initial.values, g.idxs, numPeriods)) return false;
      return !g.idxs.some((c) => {
        for (let d = 0; d < numPeriods; d++) if (marked.has(cellKey(c, d))) return true;
        return false;
      });
    });
    // Computed from the forecast as it was OPENED: a section the submitter is
    // in the middle of typing into must not fold itself back up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, sections, numPeriods]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(() =>
    readOnly || canRequestComments || handedOver
      ? new Set(sections)
      : new Set(emptySections),
  );
  /**
   * Open or fold every section at once.
   *
   * A forecast is read one way and filled in another: a reviewer wants the
   * shape (all folded, section totals only), and whoever is entering the
   * numbers wants the lines. Doing that a section at a time on a template
   * with a dozen of them is twelve clicks in the wrong direction.
   */
  const allCollapsed = sections.length > 0 && sections.every((gi) => collapsedGroups.has(gi));
  const allExpanded = sections.every((gi) => !collapsedGroups.has(gi));
  const setAllCollapsed = (collapse: boolean) =>
    setCollapsedGroups(collapse ? new Set(sections) : new Set());

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
      customRows: [...rows],
    }),
    [values, flags, comments, dayComments, startingBalance, rows],
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
    // The rows and their figures go back together: a row's figures are
    // addressed by where the row sits, so restoring one without the other
    // would move every number below it up a line.
    setValues(next.values);
    setFlags(next.flags);
    setComments(next.comments);
    setDayComments(next.dayComments);
    setStartingBalance(next.startingBalance);
    setRows(next.customRows);
    persist({
      values: next.values,
      flags: next.flags,
      comments: next.comments,
      dayComments: next.dayComments,
      startingBalance: next.startingBalance,
      customRows: next.customRows,
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
    questionedBy?: ForecastQuestion;
    revisedFrom?: SubmissionStatus;
    customRows?: CustomRow[];
    mirrorPrefs?: MirrorPrefs;
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
      // Autosave must not forget who is waiting on an answer, nor that this
      // forecast has been submitted once already — the checklist reads both.
      questionedBy: 'questionedBy' in snap ? snap.questionedBy : questionedBy,
      revisedFrom: 'revisedFrom' in snap ? snap.revisedFrom : revisedFrom,
      // Autosave must not forget the submitter's own rows either: without
      // them their figures are a block of numbers with no lines to sit on.
      customRows: snap.customRows ?? rows,
      mirrorPrefs: snap.mirrorPrefs ?? mirrorPrefs,
      dayComments: snap.dayComments ?? dayComments,
      startingBalance:
        'startingBalance' in snap ? (snap.startingBalance ?? null) : startingBalance,
      updatedAt: new Date().toISOString(),
    };
    saveSubmission(record);
    return record;
  };

  /**
   * A figure just changed. If this forecast had already been handed over, that
   * edit WITHDRAWS it: the numbers the approver saw (or signed off) no longer
   * exist, so it goes back to the submitter's hands and round the approval
   * cycle again once they resubmit.
   *
   * Returns the fields to save with the edit itself, so the withdrawal and the
   * new figure land in storage together rather than one render apart.
   */
  const withdrawFromApproval = (): Snapshot => {
    if (!isSubmitterView || !isHandedOver(status)) return {};
    const from = status;
    setStatus('draft');
    setRevisedFrom(from);
    // The decision goes with it — a resubmitted forecast must arrive in the
    // approver's queue undecided rather than carrying its old approval.
    clearApprovalDecision(entity);
    return { status: 'draft', revisedFrom: from };
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

  /** The rows this entity had last week — what a row's prior figure is. */
  const priorRows = useMemo(
    () => customRowsOf(loadSubmission(prevWeekKey(week), entity, template.id)),
    [week, entity, template.id],
  );

  /**
   * The prior-cycle figure a cell is compared against.
   *
   * For a template line that is last week's cell. For a row the submitter
   * added it is last week's figure ON THAT ROW — found by what the row is,
   * since a row sits at a different index in every forecast — and `null`
   * where last week had no such row at all, which is what stops a row from
   * being flagged as a swing on the day it is created.
   */
  const priorAt = (catIdx: number, dayIdx: number): number | null => {
    if (catIdx < numCats) return priorValueFor(prior, catIdx, dayIdx, template);
    const row = rows[catIdx - numCats];
    if (!row) return null;
    const index = priorRowIndex(row, priorRows);
    if (index === null) return null;
    return priorValueFor(prior, numCats + index, dayIdx, template);
  };

  const reflag = (
    v: GridValues,
    keys: Iterable<string>,
    base: Set<string>,
    /** Commentary as it will be after this edit, when the two save together. */
    cm: Record<string, string> = comments,
  ): Set<string> => {
    const next = new Set(base);
    for (const key of keys) {
      const [c, d] = key.split('-').map(Number);
      if (isVariance(v[key] || 0, priorAt(c, d), settings)) next.add(key);
      // A cell that has been ASKED ABOUT stays in the review queue whatever
      // the numbers do. Correcting the figure is a perfectly good answer, and
      // it usually brings the cell back under the threshold — which used to
      // unflag it and take the answer out of treasury's queue with it.
      else if (cm[key]?.trim() || commentRequests[key]) next.add(key);
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
    persist({ values: nextValues, flags: nextFlags, ...withdrawFromApproval() });
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
        if (catIdx >= gridCats.length || dayIdx >= numPeriods) {
          clipped++;
          return;
        }
        // A mirrored row is another entity's statement — it is read here, so
        // a paste that runs over one leaves it alone rather than quietly
        // rewriting what they said.
        if (gridCats[catIdx]?.source !== undefined) {
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
    persist({ values: nextValues, flags: nextFlags, ...withdrawFromApproval() });

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
    persist({ startingBalance: v, ...withdrawFromApproval() });
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
    // The checkpoint carries the submitter's own rows too, so they go back
    // with the figures that sit on them.
    const restoredFlags = new Set(checkpoint.flags);
    const restoredRows = customRowsOf(checkpoint);
    setValues(checkpoint.values);
    setFlags(restoredFlags);
    setComments(checkpoint.comments ?? {});
    setDayComments(checkpoint.dayComments ?? {});
    setStartingBalance(checkpoint.startingBalance ?? null);
    setRows(restoredRows);
    persist({
      values: checkpoint.values,
      flags: restoredFlags,
      comments: checkpoint.comments ?? {},
      dayComments: checkpoint.dayComments ?? {},
      startingBalance: checkpoint.startingBalance ?? null,
      customRows: restoredRows,
    });
  };

  const copyPrior = async (announce = true) => {
    const prevKey = prevWeekKey(week);
    const stored = loadSubmission(prevKey, entity, template.id);
    const hasStored = stored !== null;
    pushUndo();
    // A row the submitter added last week is copied WITH its figures — the
    // customers a country invoices are the same customers this week, and
    // copying the numbers without the rows would land them on nothing.
    //
    // Only their OWN rows travel. Last week's mirrors are what other entities
    // said about a different period; this week's mirrors are facts about this
    // one, so those stay exactly as they arrived.
    const mirrors = rows.filter((r) => !isOwnRow(r));
    const copied = priorRows
      .filter(isOwnRow)
      // A copied row is a new row on this forecast, so it needs an id of its
      // own — sharing last week's would make one edit rewrite both.
      .map((r) => ({ ...r, id: `${r.id}:copy` }));
    const nextRows = [...mirrors, ...copied];
    // Prior figures for the template's own lines; the rows bring theirs.
    let nextValues: GridValues = {};
    for (const [key, v] of Object.entries(prior)) {
      if (Number(key.split('-')[0]) < numCats) nextValues[key] = v;
    }
    nextRows.forEach((row, i) => {
      const figures = isOwnRow(row)
        ? rowValues(template, priorRows, row.id.replace(/:copy$/, ''), prior, numPeriods)
        : rowValues(template, rows, row.id, values, numPeriods);
      nextValues = withRowValues(nextValues, numCats + i, numPeriods, figures);
    });
    setValues(nextValues);
    setFlags(new Set());
    setRows(nextRows);
    setRestoreVersion((n) => n + 1);
    persist({ values: nextValues, flags: new Set(), customRows: nextRows });
    lastEditedCell.current = null;
    // Silent when it IS the opening choice: the answer to "start from last
    // week?" is the grid, not a dialog acknowledging the dialog just closed.
    if (!announce) return;
    await notify({
      tone: 'success',
      message: hasStored
        ? `Copied your saved ${weekLabel(prevKey)} submission. Edit as needed.`
        : `Loaded prior-week values for ${weekLabel(prevKey)}. Edit as needed.`,
    });
  };

  // ---- How this week starts ----------------------------------------------
  /**
   * The first time a submitter opens a given week's forecast, it asks what to
   * start it from: last week's figures, or nothing.
   *
   * Once per (entity, week, template) and only ever BEFORE any work exists on
   * it — which is what makes "start blank" safe to offer as a button rather
   * than as a confirm. Reopening the forecast never asks again; Copy Prior and
   * Reset are still there under More for anyone who wants to change their mind
   * later.
   */
  const [startChoice, setStartChoice] = useState(false);
  const startAskedFor = useRef<string | null>(null);
  useEffect(() => {
    const target = `${week}:${entity}:${template.id}`;
    if (startAskedFor.current === target) return;
    startAskedFor.current = target;
    // Only the person who fills it in, only while it is still theirs to fill.
    if (!canEditCells || !editorActions) return;
    if (hasSeenStartChoice(week, entity, template.id)) return;
    setStartChoice(true);
  }, [week, entity, template.id, canEditCells, editorActions]);

  const answerStartChoice = async (carryOver: boolean) => {
    markStartChoiceSeen(week, entity, template.id);
    setStartChoice(false);
    if (carryOver) {
      await copyPrior(false);
      return;
    }
    // Start blank: every editable cell cleared, the submitter's own rows and
    // their figures with them. Mirrored rows stay — they are what other
    // entities have said about this week, not this forecast's own work.
    pushUndo();
    lastEditedCell.current = null;
    const mirrors = rows.filter((r) => !isOwnRow(r));
    let nextValues: GridValues = {};
    mirrors.forEach((row, i) => {
      nextValues = withRowValues(
        nextValues,
        numCats + i,
        numPeriods,
        rowValues(template, rows, row.id, values, numPeriods),
      );
    });
    setValues(nextValues);
    setFlags(new Set());
    setRows(mirrors);
    setStartingBalance(null);
    setRestoreVersion((n) => n + 1);
    persist({
      values: nextValues,
      flags: new Set(),
      customRows: mirrors,
      startingBalance: null,
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

  /**
   * A click on a cell. WHICH surface opens is decided by WHOSE forecast it is,
   * not by what happens to be on the cell.
   *
   * The submitter works their own forecast in the dock beside the grid.
   * Explaining a variance and answering a question are the same act on the
   * same cell, and doing one in a sidebar and the other in a dialog meant a
   * click on one flagged cell raised a box over the grid and the next one
   * raised the sidebar. The dock carries the question, its thread and the
   * figure when the cell has been asked about, so closing that dialog to the
   * submitter costs them nothing.
   *
   * Readers (treasury, approvers, viewers) get the dialog: they are asking
   * about the cell or reading it, and the dock is where the work is done.
   */
  const openVariance = (catIdx: number, dayIdx: number) => {
    const key = cellKey(catIdx, dayIdx);
    if (isSubmitterView) {
      focusFlowCell(key, commentFlow?.mode ?? 'single');
      return;
    }
    setVarianceCell({
      key,
      label: gridCats[catIdx]?.label ?? '',
      prior: priorAt(catIdx, dayIdx),
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
    // An open dock is work in hand — a flow resumed from the last visit, or a
    // cell being explained right now. A question that arrived meanwhile waits
    // its turn rather than taking the cell out from under a half-written
    // sentence; the strip above the grid still says it is there.
    if (!isSubmitterView || focusCell || focusedOnce.current || commentFlow) return;
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

  /**
   * Save what has been said about one cell — and, if the figure was corrected
   * alongside it, the new number. Both halves of the same answer go in one
   * write and one undo, and on a cell somebody asked about the words join the
   * thread rather than sitting beside it.
   *
   * `typedValue` is null when the figure was not touched, which is not the
   * same as "unchanged": the grid is live under the dock, so writing back a
   * number the dock only displayed would undo an edit made in the cell.
   *
   * Returns what was written, for a caller that has to act on it in the same
   * tick — the guided walk submits on the last explanation, and React has not
   * applied the state by then.
   */
  const commitCellAnswer = (key: string, text: string, typedValue: string | null): Snapshot => {
    const answer = text.trim();
    const nextComments = { ...comments, [key]: answer };
    if (!answer) delete nextComments[key];
    setComments(nextComments);

    let nextValues = values;
    let nextFlags = flags;
    let withdrawn: Snapshot = {};
    if (canEditCells && typedValue !== null) {
      const typed = typedValue.trim();
      const parsed = typed === '' ? null : parseCellNumber(typed);
      const changed = (values[key] ?? null) !== parsed;
      if (changed && (typed === '' || parsed !== null)) {
        pushUndo();
        lastEditedCell.current = null;
        nextValues = { ...values };
        if (parsed === null) delete nextValues[key];
        else nextValues[key] = parsed;
        nextFlags = reflag(nextValues, [key], flags, nextComments);
        setValues(nextValues);
        setFlags(nextFlags);
        // The grid cells hold their own in-progress text; remount so the
        // restored cell shows the number saved here rather than the old one.
        setRestoreVersion((n) => n + 1);
        // "That figure was wrong" is a perfectly good answer — and correcting
        // it on a forecast already handed over sends it round again.
        withdrawn = withdrawFromApproval();
      }
    }

    // The answer joins the thread, so whoever asked reads the reply against
    // the question rather than as loose commentary.
    const nextRequests = answerCommentRequest(commentRequests, key, answer, currentUser().name);
    setCommentRequests(nextRequests);
    const snap: Snapshot = {
      values: nextValues,
      flags: nextFlags,
      comments: nextComments,
      commentRequests: nextRequests,
      ...withdrawn,
    };
    persist(snap);
    return snap;
  };

  // ---- The submitter's own rows ------------------------------------------
  // Every section header carries a `+`. What it adds is an ordinary row of
  // the grid — named here, typed into here, summed into the section it sits
  // in — because "Customer A, Customer B, other" is what a country's
  // receivables are actually made of, and no template can know that.
  //
  // Under an INTERCOMPANY section the name is not free: the row is a legal
  // entity picked from the master data, so the amount can be mirrored into
  // that entity's forecast and the group position can net to zero.

  /** Treasury and approvers READ the rows; only the entity adds to them. */
  const canEditRows = canEditCells && !canRequestComments;
  /** The legal entities an intercompany row may name. */
  const entityChoices = useMemo(() => entityOptions(entity), [entity]);

  // ---- What this forecast takes from its counterparties -------------------
  /** Does this template even have an intercompany section to mirror into? */
  const hasIntercompany = useMemo(
    () => intercompanySections(template).length > 0,
    [template],
  );
  /** Every counterparty that could mirror into this forecast, by name. */
  const mirrorSources = useMemo(
    () => entityChoices.map((o) => o.name).sort((a, b) => a.localeCompare(b)),
    [entityChoices],
  );
  /**
   * What the rest of the group STATES about this week, carried or not, with
   * the same statement one and two cycles back.
   *
   * Read off the counterparties' own forecasts rather than off this one, so a
   * statement this forecast has declined is still listed — which is the whole
   * point of a table you can add from. Recomputed when the rows change so
   * taking one in or out is reflected immediately.
   */
  const statements = useMemo(
    () => (hasIntercompany ? mirrorStatements(entity, week, template) : []),
    // `rows` is what changes when a statement is taken in or dropped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasIntercompany, entity, week, template, rows],
  );
  /** The counterparties whose rows are actually in the grid right now. */
  const mirroredHere = useMemo(
    () => [...new Set(rows.filter((r) => !isOwnRow(r)).map((r) => r.source as string))],
    [rows],
  );

  /**
   * Tick or untick one counterparty. Empty means EVERY one of them, so
   * unticking the first of ten writes the other nine down, and ticking the
   * last one back folds it to empty again — the stored value then goes on
   * meaning "all", including counterparties configured later.
   */
  const toggleMirrorSource = (prefs: MirrorPrefs, name: string): MirrorPrefs => {
    const current = prefs.sources.length === 0 ? mirrorSources : prefs.sources;
    const next = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name];
    return { ...prefs, sources: next.length === mirrorSources.length ? [] : next };
  };

  /**
   * Take the mirroring settings and make the grid agree with them: rows from
   * a counterparty that is no longer accepted come out, rows from one that
   * has just been accepted are pulled in from what they have stored.
   */
  const applyMirrorPrefs = async (next: MirrorPrefs) => {
    pushUndo();
    lastEditedCell.current = null;
    const rebuilt = rebuildMirrors({
      period: week,
      entity,
      template,
      prefs: next,
      rows,
      values,
      flags: [...flags],
      comments,
      commentRequests,
    });
    const nextFlags = new Set(rebuilt.flags);
    setMirrorPrefs(next);
    setRows(rebuilt.rows);
    setValues(rebuilt.values);
    setFlags(nextFlags);
    setComments(rebuilt.comments);
    setCommentRequests(rebuilt.commentRequests);
    // The cells hold their own in-progress text; remount so the grid shows
    // the rows it now has rather than the ones it had.
    setRestoreVersion((n) => n + 1);
    // Rows in or out is a change to the FIGURES, so it costs what any other
    // change to them costs on a forecast already handed over: it comes back
    // off the approver's desk and goes round again.
    const changed = rebuilt.added.length > 0 || rebuilt.dropped.length > 0;
    const withdrawn = changed ? withdrawFromApproval() : {};
    persist({
      mirrorPrefs: next,
      customRows: rebuilt.rows,
      values: rebuilt.values,
      flags: nextFlags,
      comments: rebuilt.comments,
      commentRequests: rebuilt.commentRequests,
      ...withdrawn,
    });
    setMirrorDraft(null);
    const said = [
      rebuilt.added.length > 0 ? `Pulled in ${rebuilt.added.join(', ')}.` : '',
      rebuilt.dropped.length > 0 ? `Left out ${rebuilt.dropped.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    await notify({
      tone: 'success',
      message: next.enabled
        ? `Intercompany mirroring updated.${said ? ` ${said}` : ''}`
        : `Intercompany mirroring is off — this forecast carries only its own rows.${
            said ? ` ${said}` : ''
          }`,
    });
  };

  /** Add a row under a line — or under the section, where it has no lines. */
  const addRow = (section: string, parent?: string) => {
    if (!canEditRows) return;
    pushUndo();
    lastEditedCell.current = null;
    const row = makeCustomRow(section, parent);
    const nextRows = [...rows, row];
    setRows(nextRows);
    // A new row holds no figures, so nothing about the forecast's numbers has
    // changed yet and an already-submitted forecast stays where it is.
    persist({ customRows: nextRows });
    // Put the cursor in the new row's name — an unnamed row is the one thing
    // it must not be left as. Found by the row's OWN id: rows sit under the
    // line they break down, so the newest one is rarely the last on screen.
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`.forecast-grid [data-row-id="${row.id}"]`)
        ?.focus();
    });
  };

  /** Rename one — free-text sections only. */
  const renameRow = (rowId: string, label: string) => {
    if (!canEditRows) return;
    // Typing a name is not an undo step of its own: coalesce a run of
    // keystrokes on one row exactly as a run of digits in one cell is.
    if (lastEditedCell.current !== `row:${rowId}`) {
      pushUndo();
      lastEditedCell.current = `row:${rowId}`;
    }
    const nextRows = rows.map((r) => (r.id === rowId ? { ...r, label } : r));
    setRows(nextRows);
    persist({ customRows: nextRows });
  };

  /** Point one at a legal entity — intercompany sections only. */
  const setRowEntity = (rowId: string, entityName: string) => {
    if (!canEditRows) return;
    pushUndo();
    lastEditedCell.current = null;
    const nextRows = rows.map((r) =>
      r.id === rowId
        ? { ...r, entity: entityName || undefined, label: entityName || r.label }
        : r,
    );
    setRows(nextRows);
    persist({ customRows: nextRows });
  };

  /**
   * Remove a row, and its figures with it.
   *
   * Every row below it moves up a place, and a row's figures, flags and
   * commentary are addressed BY that place — so all of them move together or
   * a deleted row leaves its numbers behind on the row beneath.
   */
  const removeRow = async (rowId: string) => {
    if (!canEditRows) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const hasFigures = Object.keys(
      rowValues(template, rows, rowId, values, numPeriods),
    ).length > 0;
    if (hasFigures) {
      const ok = await confirm({
        title: 'Remove row',
        message: `Remove "${row.label.trim() || 'this row'}" and the figures on it? The section total goes down by what it held.`,
        confirmLabel: 'Remove Row',
        danger: true,
      });
      if (!ok) return;
    }
    pushUndo();
    lastEditedCell.current = null;
    const nextRows = rows.filter((r) => r.id !== rowId);
    const remap = remapRowKey(template, rows, nextRows);
    const nextValues = remapRecord(values, remap);
    const nextFlags = remapKeySet(flags, remap);
    const nextComments = remapRecord(comments, remap);
    const nextRequests = remapRecord(commentRequests, remap);
    setRows(nextRows);
    setValues(nextValues);
    setFlags(nextFlags);
    setComments(nextComments);
    setCommentRequests(nextRequests);
    setRestoreVersion((n) => n + 1);
    persist({
      values: nextValues,
      flags: nextFlags,
      comments: nextComments,
      commentRequests: nextRequests,
      customRows: nextRows,
      ...(hasFigures ? withdrawFromApproval() : {}),
    });
  };

  /**
   * Mirroring, driven off what this forecast SAYS rather than off each edit.
   *
   * A figure typed into a counterparty row, a row added, an entity repointed,
   * an undo, a Reset and a copied prior week are all the same statement about
   * what this entity will settle with whom — and every one of them has to
   * reach the counterparty's forecast. Watching the statement itself covers
   * all of them with one rule, and the debounce keeps a burst of keystrokes
   * from writing into ten other forecasts on every digit.
   */
  const statement = useMemo(
    () => mirrorFingerprint(template, rows, values, numPeriods),
    [template, rows, values, numPeriods],
  );
  const settledStatement = useDebounced(statement, 700);
  const lastMirrored = useRef(statement);
  /** Notes already given, so a note is made once and not on every keystroke. */
  const toldAbout = useRef(new Set<string>());
  useEffect(() => {
    if (!canEditRows) return;
    if (settledStatement === lastMirrored.current) return;
    lastMirrored.current = settledStatement;
    const outcomes = syncMirrors({ period: week, entity, template, rows, values });
    const problems = outcomes
      .map(mirrorProblem)
      .filter((p): p is string => p !== null)
      // "Germany has already submitted" is worth saying once. Saying it again
      // on the next figure typed into the same row is nagging.
      .filter((p) => !toldAbout.current.has(p));
    if (problems.length > 0) {
      for (const p of problems) toldAbout.current.add(p);
      void notify({
        title: 'Saved — with notes on the mirrored rows',
        message: problems.join(' '),
      });
    }
    // The fingerprint is what changed; `rows` and `values` are read at the
    // moment it settles, which is exactly the state that has to be mirrored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledStatement, canEditRows]);

  /** "Mon 4 Aug" for a cell key, falling back to the column number. */
  const periodLabelFor = (key: string): string => {
    const d = Number(key.split('-')[1]);
    return dayLabels[d] ? `${dayLabels[d].dow} ${dayLabels[d].dm}` : `Day ${d + 1}`;
  };

  /** "Receivables · Mon 4 Aug" for a cell key, for banners and lists. */
  const cellLabelFor = (key: string): string => {
    const c = Number(key.split('-')[0]);
    return `${gridCats[c]?.label ?? `Line ${c + 1}`} · ${periodLabelFor(key)}`;
  };

  /** The open cell dialog, as the shared "ask about this cell" dialog wants it. */
  const askTarget = varianceCell
    ? {
        entity,
        week,
        templateId: template.id,
        cellKey: varianceCell.key,
        label: varianceCell.label,
        periodLabel: periodLabelFor(varianceCell.key),
        current: varianceCell.current,
        prior: varianceCell.prior,
        comment: comments[varianceCell.key] ?? '',
      }
    : null;

  /** Record a question asked from this screen without re-reading storage. */
  const onQuestionSent = (key: string, request: CommentRequest) => {
    setCommentRequests((prev) => {
      const existing = prev[key];
      // Asking again about the same cell CONTINUES the conversation. Storing
      // the new question on its own dropped everything said before it.
      return existing
        ? withThreadMessage(prev, key, {
            from: request.from,
            role: request.fromRole ?? 'treasury',
            text: request.message,
            at: request.requestedAt,
          })
        : { ...prev, [key]: request };
    });
    setFlags((f) => new Set(f).add(key));
    // The question does not take the forecast off the approver — it puts a
    // reply on somebody's list, which is what the banner above the grid says.
    setQuestionedBy({
      by: request.from,
      role: request.fromRole ?? 'treasury',
      at: request.requestedAt,
    });
  };

  const uncommented = [...flags].filter((k) => !comments[k]?.trim());
  /** Questions still waiting on an answer — an answered one is history. */
  const openRequests = useMemo(
    () => openQuestionEntries(commentRequests).map(([key, r]) => ({ key, ...r })),
    [commentRequests],
  );
  const requestedCells = useMemo(
    () => new Set(openRequests.map((r) => r.key)),
    [openRequests],
  );
  /**
   * Questions that have come back with a reply. An answered question is
   * history to the submitter — but not to whoever asked it: the reply is the
   * thing they were waiting for, and dropping it off this screen left the
   * asker with a forecast that showed no sign a conversation ever happened.
   * The preview dialog has always listed them; the full page now does too.
   */
  const answeredRequests = useMemo(
    () =>
      Object.entries(commentRequests)
        .filter(([, r]) => r.answeredAt)
        .sort((a, b) => (a[1].answeredAt ?? '').localeCompare(b[1].answeredAt ?? ''))
        .map(([key, r]) => ({ key, ...r })),
    [commentRequests],
  );
  const answeredCells = useMemo(
    () => new Set(answeredRequests.map((r) => r.key)),
    [answeredRequests],
  );

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
    const gi = categoryGroups(gridCats).findIndex((g) => g.idxs.includes(c));
    if (gi < 0) return;
    setCollapsedGroups((prev) => {
      if (!prev.has(gi)) return prev;
      const next = new Set(prev);
      next.delete(gi);
      return next;
    });
  };

  /**
   * Open the dialog on a cell that has a question, from a list rather than
   * from the grid: expand the section it lives in (a collapsed one would put
   * the dialog over nothing) and scroll it into view behind the dialog.
   */
  const openQuestionCell = (key: string) => {
    const [c, d] = key.split('-').map(Number);
    if (!Number.isFinite(c) || !Number.isFinite(d)) return;
    expandSectionOf(key);
    openVariance(c, d);
    requestAnimationFrame(() => {
      document
        .querySelector(`.forecast-grid [data-cat="${c}"][data-day="${d}"]`)
        ?.scrollIntoView({ block: 'center', inline: 'center' });
    });
  };

  /**
   * Bring a cell into view and put the dock on whichever side keeps it there:
   * on the left when the cell sits in the right half of the grid, so the cell
   * and the box are never on top of each other.
   */
  const placeFlowDock = (key: string) => {
    expandSectionOf(key);
    // Two frames: one for the section to expand, one for the dock to mount
    // (it narrows the grid before anything is measured).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const [c, d] = key.split('-').map(Number);
        const cell =
          document
            .querySelector(`.forecast-grid input[data-cat="${c}"][data-day="${d}"]`)
            ?.closest('td') ??
          // A cell with a question on it is a button, not an input.
          document.querySelector(`.forecast-grid td[data-cat="${c}"][data-day="${d}"]`);
        const wrap = document.querySelector('.forecast-grid-wrap');
        if (!cell || !wrap) return;
        cell.scrollIntoView({ block: 'center', inline: 'center' });
        const cellRect = cell.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const side =
          cellRect.left + cellRect.width / 2 > wrapRect.left + wrapRect.width / 2
            ? 'left'
            : 'right';
        setCommentFlow((prev) => (prev && prev.key === key ? { ...prev, side } : prev));
      }),
    );
  };

  /** Move the flow to a cell, with whatever has already been written on it. */
  const focusFlowCell = (key: string, mode?: 'submitting' | 'single') => {
    setFlowDraft(comments[key] ?? '');
    setValueDraft(values[key] === undefined ? '' : String(values[key]));
    setValueDirty(false);
    setCommentFlow((prev) => ({
      key,
      side: prev?.side ?? 'right',
      mode: mode ?? prev?.mode ?? 'single',
    }));
    placeFlowDock(key);
  };

  // A resumed flow is already in state; the grid just has to be brought to it.
  useEffect(() => {
    if (resumable) placeFlowDock(resumable.key);
    // Once, on mount: `resumable` is read from storage at mount and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Keep the in-progress flow where leaving the screen cannot take it. Saved
   * as it is typed rather than on the way out, because there is no way out to
   * hook: the screen is simply unmounted when another one is chosen.
   */
  useEffect(() => {
    if (!commentFlow) {
      clearFlowState();
      return;
    }
    saveFlowState({
      entity,
      week,
      templateId: template.id,
      key: commentFlow.key,
      mode: commentFlow.mode,
      draft: flowDraft,
      valueDraft,
      valueDirty,
    });
  }, [commentFlow, flowDraft, valueDraft, valueDirty, entity, week, template.id]);

  const cancelFlow = () => {
    setCommentFlow(null);
    setFlowDraft('');
    setValueDraft('');
    setValueDirty(false);
  };

  /**
   * Move on without explaining this one. Some variances are explained by the
   * cell next to them, and forcing them in grid order made people write
   * "see below" — this walks past and comes back at the end.
   */
  const skipFlowCell = () => {
    if (!commentFlow) return;
    const pending = orderedUncommented();
    const next = pending.find((k) => k !== commentFlow.key);
    if (!next) return;
    focusFlowCell(next);
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
    const resubmission = revised;
    setCommentFlow(null);
    setStatus('submitted');
    // Whatever this forecast was before its figures were revised, it is a
    // fresh submission now — and locked again, like any submitted forecast.
    setRevisedFrom(undefined);
    setRevising(false);
    persist({ ...snap, status: 'submitted', revisedFrom: undefined });
    // A fresh submission reopens the decision: without this, a rejection
    // stuck in the cycle's approval map forever and the approver saw the
    // resubmitted forecast as already "rejected" with no way to approve it.
    clearApprovalDecision(entity);
    await notify({
      tone: 'success',
      message: resubmission
        ? 'Forecast resubmitted — your approver has the revised figures to sign off.'
        : 'Forecast submitted for approval.',
    });
  };

  /**
   * Save what is in the dock and walk on to the next flagged cell — or
   * submit, when this was the last one.
   *
   * On a cell somebody asked about, what is written here IS the answer: it
   * joins the thread rather than sitting beside it, and a figure corrected in
   * the same box goes with it.
   */
  const saveFlowComment = () => {
    if (!commentFlow) return;
    if (!flowDraft.trim()) return;
    const snap = commitCellAnswer(commentFlow.key, flowDraft, valueDirty ? valueDraft : null);
    // One cell, explained: that is the whole job. Only the guided walk goes on
    // to the next variance and, when there are none left, submits.
    if (commentFlow.mode === 'single') {
      cancelFlow();
      return;
    }
    const remaining = orderedUncommented(snap.comments ?? comments);
    if (remaining.length === 0) void finishSubmit(snap);
    else focusFlowCell(remaining[0], 'submitting');
  };

  /**
   * Send it. The only thing between a submitter and their approver is the
   * commentary on a variance somebody will ask about anyway.
   *
   * An empty cell used to stop the submit and spotlight every one of them.
   * It is not a gap: a line with nothing happening on it is a nil, which is
   * most of a treasury grid on most days, and a forecast of 240 cells cannot
   * be held back for the ones nobody typed a zero into. The figures are the
   * submitter's to state; the variances are the ones treasury will ask about,
   * so those are what the flow walks.
   */
  const submit = async () => {
    const pending = orderedUncommented();
    if (pending.length > 0) {
      focusFlowCell(pending[0], 'submitting');
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

  /**
   * Unlock an already-submitted forecast so a figure can be corrected.
   *
   * Asked once, here, rather than discovered afterwards: the edit itself is
   * what withdraws the forecast from approval, and nobody should learn that
   * from a banner appearing under their hands.
   */
  const startRevising = async () => {
    const confirmed = await confirm({
      title: 'Edit a submitted forecast',
      message: `This forecast has already been ${statusLabel(status)}. You can change the figures, but doing so withdraws it from approval — you resubmit afterwards and your approver decides again. Answering questions and writing commentary need none of this.`,
      confirmLabel: 'Edit Forecast',
    });
    if (!confirmed) return;
    setRevising(true);
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
    // The workbook is written from the array, not from the sections, so the
    // submitter's own rows are flattened into reading order first — a section
    // band has to span a contiguous run of columns.
    const flat = readingOrder(gridCats, values, numPeriods);
    exportSubmissionXlsx({
      template: { ...template, categories: flat.categories },
      layout: orientation,
      entity,
      weekLabel: weekLabelShort(week),
      dates,
      dayLabels,
      values: flat.values,
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
  // Every line on the grid counts towards the day's shape, the submitter's
  // own rows included — they are part of the forecast, not a note beside it.
  const inflowByDay = dates.map((_d, d) => dayInflows(gridCats.length, values, d));
  const outflowByDay = dates.map((_d, d) => dayOutflows(gridCats.length, values, d));
  const netByDay = dates.map((_d, d) => dayNet(gridCats.length, values, d));
  const hasBalance = startingBalance !== null;
  const balanceByDay = dates.map((_d, d) =>
    runningBalance(gridCats.length, values, startingBalance ?? 0, d),
  );
  const totalInflows = inflowByDay.reduce((a, b) => a + b, 0);
  const totalOutflows = outflowByDay.reduce((a, b) => a + b, 0);
  const totalNet = netByDay.reduce((a, b) => a + b, 0);
  const closingBalance = balanceByDay[numDays - 1] ?? startingBalance ?? 0;

  // ---- This week's series, and the mark each one is drawn in --------------
  // Two rules decide the marks, and both are about reading the chart rather
  // than about what is on it.
  //
  // 1. The measure being compared with earlier cycles is drawn as a LINE.
  //    The prior weeks are dashed lines of that one measure, and a bar and a
  //    dashed line are not two things the eye can put side by side: the
  //    comparison was being asked for in one language and answered in
  //    another.
  // 2. Net cash flow is inflows PLUS outflows, so it cannot stand in the same
  //    stacked column as them — the same money would be counted twice, once
  //    gross and once net. Wherever the gross flows are shown it is their
  //    resultant, drawn as a line over the columns exactly as the dashboard's
  //    outlook draws it.
  /** Which measure, if any, the prior-cycle overlays are being read against. */
  const comparedMetric: CompareMetric | null = compareWeeks.length > 0 ? compareMetric : null;
  /** True while a gross flow is standing in the day's column as a bar. */
  const grossBars =
    (chartOptions.inflows && comparedMetric !== 'inflows') ||
    (chartOptions.outflows && comparedMetric !== 'outflows');
  /** A compared series carries its week, so the legend reads as one set. */
  const comparedLabel = comparedMetric
    ? `${weekLabelShort(week)} · ${COMPARE_LABELS[comparedMetric]}`
    : null;
  const seriesLabel = (m: CompareMetric, plain: string) =>
    comparedLabel && comparedMetric === m ? comparedLabel : plain;

  const chartSeries: ChartSeries[] = [];
  if (chartOptions.inflows)
    chartSeries.push({
      label: seriesLabel('inflows', 'Inflows'),
      values: inflowByDay,
      color: CHART_COLORS.green,
      kind: comparedMetric === 'inflows' ? 'line' : 'bar',
    });
  if (chartOptions.outflows)
    chartSeries.push({
      label: seriesLabel('outflows', 'Outflows'),
      values: outflowByDay,
      color: CHART_COLORS.red,
      kind: comparedMetric === 'outflows' ? 'line' : 'bar',
    });
  if (chartOptions.net)
    chartSeries.push({
      label: seriesLabel('net', 'Net Cash Flow'),
      values: netByDay,
      color: CHART_COLORS.blue,
      kind: comparedMetric === 'net' || grossBars ? 'line' : 'bar',
    });
  if (chartOptions.balance && hasBalance)
    chartSeries.push({
      label: seriesLabel('balance', 'Running Balance'),
      values: balanceByDay,
      color: CHART_COLORS.accent,
      kind: balanceStyle === 'area' ? 'area' : 'line',
      dashed: balanceStyle === 'dashed',
    });

  /** The compared measure sits with the weeks it is read against, so the
   *  legend shows the three (or five) as one set rather than split by
   *  whatever else is on the chart. */
  const plotSeries: ChartSeries[] = comparedLabel
    ? [...chartSeries].sort(
        (a, b) => Number(b.label === comparedLabel) - Number(a.label === comparedLabel),
      )
    : chartSeries;

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
        // That week's own line count: it had its own rows, and reading it
        // with this week's would drop the ones it has and count ones it
        // never had.
        const pastCats = gridCatCount(template, past);
        const metricAt = (d: number): number => {
          switch (compareMetric) {
            case 'net':
              return dayNet(pastCats, pastValues, d);
            case 'balance':
              return runningBalance(pastCats, pastValues, past.startingBalance ?? 0, d);
            case 'inflows':
              return dayInflows(pastCats, pastValues, d);
            case 'outflows':
              return dayOutflows(pastCats, pastValues, d);
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
    [compareWeeks, compareMetric, entity, template, numPeriods],
  );

  /**
   * Comparing a measure means nothing without this week's own reading of it
   * to compare against, so choosing one puts it on the chart. The checkbox
   * still owns it from there — unticking it drops both the series and the
   * counterpart, which is a reader saying they only want the earlier weeks.
   */
  const showComparedMetric = (m: CompareMetric) => {
    if (m === 'balance' && !hasBalance) return;
    setChartOptions((o) => (o[m] ? o : { ...o, [m]: true }));
  };

  const toggleCompareWeek = (key: string) => {
    if (!compareWeeks.includes(key)) showComparedMetric(compareMetric);
    setCompareWeeks((prev) =>
      prev.includes(key) ? prev.filter((w) => w !== key) : [...prev, key],
    );
  };

  const changeCompareMetric = (m: CompareMetric) => {
    if (compareWeeks.length > 0) showComparedMetric(m);
    setCompareMetric(m);
  };

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

  /** The question on the cell the dialog is showing, answered or not. */
  const cellRequest = varianceCell ? commentRequests[varianceCell.key] : undefined;

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
      label: gridCats[c]?.label ?? `Line ${c + 1}`,
      dateLabel: dayLabels[d] ? `${dayLabels[d].dow} ${dayLabels[d].dm}` : `Day ${d + 1}`,
      prior: priorAt(c, d),
      current: values[commentFlow.key] || 0,
    };
    // `priorAt` is derived from these on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentFlow, template, gridCats, dayLabels, prior, priorRows, rows, values]);

  const flowDelta =
    flowCell && flowCell.prior !== null
      ? ((flowCell.current - flowCell.prior) / Math.max(Math.abs(flowCell.prior), 1)) * 100
      : null;
  const flowRemaining = commentFlow ? orderedUncommented().length : 0;
  /** The guided walk through every variance, as opposed to one clicked cell. */
  const flowSubmitting = commentFlow?.mode === 'submitting';
  /** The conversation on the cell in the dock, if it was asked about. */
  const flowRequest = commentFlow ? commentRequests[commentFlow.key] : undefined;
  /** Answering beats explaining: a question is somebody waiting on a reply. */
  const flowAnswering = isOpenQuestion(flowRequest);
  /**
   * Which job the PAGE is in, which is not always what the cell needs. A
   * question met half way through the submit walk is answered in the dock and
   * says so there — but the walk is still what is being done, and a page that
   * changed colour under a reader every second cell would be telling them
   * about the cell rather than about the job.
   */
  const pageMode = !commentFlow ? null : flowAnswering && !flowSubmitting ? 'answering' : 'submitting';

  const commentDock = commentFlow && flowCell && (
    <aside
      className={`comment-dock dock-${commentFlow.side}${flowAnswering ? ' dock-answering' : ''}`}
      aria-label={flowAnswering ? 'Answer the question on this cell' : 'Explain this variance'}
    >
      <div className="comment-dock-head">
        <h4>{flowAnswering ? 'Answer the question' : 'Explain variance'}</h4>
        {flowSubmitting && <span className="comment-dock-count">{flowRemaining} left</span>}
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
      {/* The whole conversation about this cell, not just the last thing said:
          an answer three exchanges in makes no sense without the question it
          came from. It used to be reachable only through a dialog, which is
          why answering and explaining were two different screens. */}
      {flowRequest && (
        <div className="comment-dock-thread">
          <QuestionThread
            messages={threadOf(
              flowRequest,
              comments[commentFlow.key] ?? '',
              listEntities().find((e) => e.name === entity)?.submitter ?? 'Submitter',
            )}
            viewerRole="submitter"
          />
        </div>
      )}
      {/* The figure itself, because "that number was wrong" is one of the
          answers — and correcting it here keeps the new number and the reason
          for it in one save and one undo. */}
      {canEditCells && (
        <div className="comment-dock-value">
          <label className="form-label" htmlFor="flow-cell-value">
            Forecast value (€k)
          </label>
          <input
            id="flow-cell-value"
            className="form-input"
            inputMode="decimal"
            placeholder="e.g. -1,250"
            value={valueDraft}
            onChange={(e) => {
              setValueDraft(e.target.value);
              setValueDirty(true);
            }}
          />
          {handedOver && (
            <span className="comment-dock-note">
              Changing it withdraws the forecast from approval — resubmit when you are done.
            </span>
          )}
        </div>
      )}
      <textarea
        className="form-textarea"
        autoFocus
        placeholder={
          flowAnswering
            ? 'Your reply to the question above…'
            : 'What drives this change vs last week?'
        }
        value={flowDraft}
        onChange={(e) => setFlowDraft(e.target.value)}
        aria-label={flowAnswering ? 'Your reply' : 'Commentary'}
      />
      <div className="comment-dock-actions">
        <button
          className="btn btn-primary"
          disabled={!flowDraft.trim()}
          onClick={saveFlowComment}
        >
          {flowAnswering
            ? flowSubmitting && flowRemaining > 1
              ? 'Send · Next'
              : 'Send Answer'
            : !flowSubmitting
              ? 'Save'
              : flowRemaining > 1
                ? 'Save · Next'
                : 'Save · Submit'}
        </button>
        {flowSubmitting && (
          <button
            className="btn btn-ghost"
            disabled={flowRemaining < 2}
            title={
              flowRemaining < 2
                ? 'This is the last one'
                : 'Leave this cell for now and explain the next one'
            }
            onClick={skipFlowCell}
          >
            Skip
          </button>
        )}
      </div>
      <div className="comment-dock-exits">
        <button className="btn btn-ghost" onClick={cancelFlow}>
          {flowSubmitting ? 'Keep Editing' : 'Close'}
        </button>
        {flowSubmitting && (
          <button className="btn btn-ghost" onClick={() => void finishSubmit()}>
            Submit Without Commentary
          </button>
        )}
      </div>
      <div className="comment-dock-progress">
        {flowAnswering
          ? `Answering ${flowRequest?.from ?? 'a question'} — the reply joins the thread on this cell`
          : flowSubmitting
            ? 'Click any flagged cell to explain that one instead'
            : 'Explaining one cell — the forecast is not being submitted'}
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
            {/* ONE pill for the state of the forecast. A second badge in a
                different shape saying "editing · not yet resubmitted" used to
                sit beside it whenever a submitted forecast was unlocked,
                which is a thing the panel over the grid says in full — and
                said it in the styling of a tag rather than of the pills
                around it. */}
            <StatusPill status={status === 'draft' ? 'submitted' : status} label={statusLabel(status)} />
            {readOnly && <ViewOnlyBadge hint="Read-only — only submitters edit forecasts" />}
            {isSubmitterView && !cycleOpen && (
              <ViewOnlyBadge
                label="Figures Locked"
                hint="This cycle is closed — the figures are history now. You can still answer questions on any cell."
              />
            )}
            {handedOver && cycleOpen && !revising && (
              <ViewOnlyBadge
                label="Figures Locked"
                hint="Already submitted — press Edit Forecast to change a figure; that withdraws it from approval and you resubmit."
              />
            )}
            <CyclePill
              label="Active cycle"
              value={activeCycleId()}
              onClick={onNavigate ? () => onNavigate('cycles') : undefined}
            />
          </>
        }
      />
      {/* The page takes on the job in hand. Entering a forecast, walking the
          submit flow and answering questions are three different tasks on the
          same screen, and only the banner used to say which one you were in —
          so the guided flow could run with the page looking exactly as it did
          a moment before. The mode tints the page edge and the panels. */}
      <div
        className={`content content-compact${pageMode ? ` page-mode page-${pageMode}` : ''}`}
      >
        {commentFlow && (
          <div className="page-mode-ribbon" aria-hidden="true">
            {flowSubmitting
              ? 'Submitting · explaining variances'
              : flowAnswering
                ? 'Answering a question'
                : 'Explaining a variance'}
          </div>
        )}
        {/* Handed over, and still changeable: the cycle is open, so a figure
            that turns out to be wrong is fixed here rather than by asking the
            approver to hand the whole forecast back. What that costs is the
            approval, which is exactly what it should cost. */}
        {handedOver && (
          <div className="variance-panel handover-panel">
            <h4>
              ✓ Submitted — {status === 'approved' ? 'approved' : 'with your approver'}
              {revising ? ' · editing' : ''}
            </h4>
            <div className="row">
              <span>
                {!cycleOpen
                  ? 'This cycle is closed, so the figures stay as reported. Commentary and answers are still yours to write.'
                  : revising
                    ? 'The grid is unlocked. Nothing has changed yet, so the forecast is still with your approver — the first figure you change withdraws it, and you resubmit for a fresh decision.'
                    : 'The figures are locked because this forecast is already in. Commentary and answers are still yours to write; to change a number, press Edit Forecast.'}
              </span>
              {cycleOpen && !revising && (
                <span className="row-flex">
                  <button
                    className="btn btn-primary"
                    data-tour="edit-forecast"
                    title="Unlock the figures — changing one withdraws the forecast from approval"
                    onClick={() => void startRevising()}
                  >
                    Edit Forecast
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
        {/* Submitted once, changed since. The checklist's "in draft" and a grid
            full of numbers otherwise read as work to do from scratch, when in
            fact the only thing left is to send it back. */}
        {revised && (
          <div className="variance-panel reopened-panel">
            <h4>↩ Withdrawn for revision — this forecast has already been submitted</h4>
            <div className="row">
              <span>
                You changed a figure after it was {statusLabel(revisedFrom ?? 'submitted')}, so it
                came off your approver's desk: the numbers they saw no longer exist. Finish the
                changes and resubmit, and it goes through approval again.
              </span>
            </div>
          </div>
        )}
        {/* Returned for update. The checklist says so; this screen used to say
            only "REJECTED" in the status pill and leave the submitter to work
            out that the numbers were theirs to change again. */}
        {isSubmitterView && status === 'rejected' && (
          <div className="variance-panel reopened-panel">
            <h4>↩ Returned for update — your approver sent this one back</h4>
            <div className="row">
              <span>
                The figures are yours to change again. Update the numbers, explain what moved,
                and submit the forecast for approval when it is ready.
              </span>
            </div>
          </div>
        )}
        {/* One line for the questions, whichever side of them you are on. The
            submitter used to get a panel of prose here and the reviewer a
            line; the same facts serve both, and on the submitter's screen the
            panel cost a third of the view above the numbers it was about. */}
        <QuestionStrip
          open={openRequests}
          answered={answeredRequests}
          viewer={isSubmitterView ? 'submitter' : 'reviewer'}
          awaiting={listEntities().find((e) => e.name === entity)?.submitter}
          answers={comments}
          cellLabel={cellLabelFor}
          onOpen={openQuestionCell}
        />
        {/* The variance banner is now the small ⚠ badge in the toolbar below —
            a whole panel of prose for a number the grid already colours in
            cost more space than it earned. */}

        {/* Entering a forecast and explaining one are different jobs, and the
            second one needs the grid, not the controls: while the commentary
            flow runs, the filters and the entry actions go away entirely. */}
        <div className={`panel settings-panel${commentFlow ? ' panel-hidden' : ''}`}>
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
                      focusFlowCell(first, 'submitting');
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
              {/* A forecast that is NOT carrying everything its counterparties
                  say about it looks exactly like one that is, and the
                  difference is real money. So when mirroring is off or
                  filtered, the toolbar says so — and, for the submitter, is
                  the way back into the setting. */}
              {hasIntercompany && mirrorPrefsFiltered(mirrorPrefs) && (
                <button
                  className="variance-badge mirror-badge"
                  title={
                    mirrorPrefs.enabled
                      ? `Carrying intercompany rows from ${mirrorPrefs.sources.join(', ')} only`
                      : 'Intercompany rows mirrored from other entities are not carried into this forecast'
                  }
                  disabled={!editorActions}
                  onClick={() => setMirrorDraft(mirrorPrefs)}
                >
                  <span aria-hidden="true">⇄</span>
                  {mirrorPrefs.enabled
                    ? `${mirrorPrefs.sources.length} of ${mirrorSources.length}`
                    : 'off'}
                  <span className="variance-badge-label">
                    {mirrorPrefs.enabled ? 'IC sources' : 'IC mirroring'}
                  </span>
                </button>
              )}
              {/* Treasury reads and fixes forecasts but never submits one, so
                  the entry actions are the submitter's alone.

                  Undo and redo are the two arrows on the keyboard shortcut
                  everyone already uses — a word beside each earned nothing and
                  took the width of a real action. */}
              {editorActions && (
                <>
                  <button
                    className="btn btn-ghost btn-icon"
                    data-tour="undo"
                    title="Undo (Ctrl+Z)"
                    aria-label="Undo"
                    disabled={!canUndo}
                    onClick={undo}
                  >
                    ↶
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    data-tour="redo"
                    title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
                    aria-label="Redo"
                    disabled={!canRedo}
                    onClick={redo}
                  >
                    ↷
                  </button>
                </>
              )}
              {/* Everything you reach for occasionally, behind one button.
                  Thirteen buttons of equal weight made the one that finishes
                  the job — Submit — look like the one beside Reset. */}
              <ActionMenu
                label="More"
                dataTour="more-actions"
                ariaLabel="More forecast actions"
                items={[
                  {
                    label: 'Export Template',
                    onSelect: exportBlankTemplate,
                  },
                  { label: 'Export Excel', onSelect: exportGrid },
                  // Only treasury chases an approver — the approver IS the
                  // recipient, and a submitter's approver is emailed on submit.
                  { label: 'Email Approver', onSelect: emailApprover, hidden: !isTreasury },
                  {
                    label: 'Intercompany Mirroring…',
                    onSelect: () => setMirrorDraft(mirrorPrefs),
                    hidden: !hasIntercompany || !editorActions,
                  },
                  { label: 'Copy Prior Forecast', onSelect: copyPrior, hidden: !editorActions },
                  { label: 'Reset', onSelect: reset, danger: true, hidden: !editorActions },
                ]}
              />
              {editorActions && (
                <>
                  {/* Saving and submitting sit apart from the rest: they are
                      the two that move the forecast on. */}
                  <span className="toolbar-divider" aria-hidden="true" />
                  <button
                    className="btn btn-ghost btn-save-draft"
                    data-tour="save-draft"
                    title="Keep a checkpoint — Reset returns to it"
                    onClick={saveDraft}
                  >
                    Save Draft
                  </button>
                </>
              )}
              {canSubmit && (
                <>
                  {!editorActions && <span className="toolbar-divider" aria-hidden="true" />}
                  <button
                    className="btn btn-primary"
                    data-tour="submit-forecast"
                    disabled={commentFlow !== null}
                    title={
                      revised
                        ? 'Send the revised figures back for a fresh approval'
                        : undefined
                    }
                    onClick={submit}
                  >
                    {revised ? 'Resubmit for Approval' : 'Submit for Approval'}
                  </button>
                </>
              )}
              {/* A decision belongs on a forecast that has been handed over.
                  Offering it on a draft let an approver sign off numbers the
                  submitter had never sent — and on a forecast reopened by a
                  question, it approved the forecast with the question still
                  unanswered. The checklist has always gated on `submitted`;
                  this screen now agrees with it. */}
              {canApprove && status === 'submitted' && (
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
          {/* The VIEW bar: how the forecast is drawn, and the one figure the
              grid cannot hold — everything here changes what you see, not
              what the forecast says. The row above it changes the forecast. */}
          <div className="grid-toolbar view-bar" style={{ borderTop: 'none' }}>
            <div className="grid-toolbar-left">
              {/* Conditional formatting: what the shading measures a cell
                  against, or nothing at all. Three ways of reading the same
                  grid, so all three sit in the open rather than behind a
                  settings screen. */}
              <div className="toggle-field">
                <span className="toggle-field-label">Shading</span>
                <div
                  className="seg-toggle"
                  role="group"
                  aria-label="Conditional formatting"
                  data-tour="conditional-formatting"
                >
                  {FORMATTING_OPTIONS.map((o) => (
                    <button
                      key={o.mode}
                      className={heatMode === o.mode ? 'active' : ''}
                      aria-pressed={heatMode === o.mode}
                      onClick={() => chooseHeatMode(o.mode)}
                      title={o.title}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {sections.length > 0 && (
                <div className="toggle-field">
                  <span className="toggle-field-label">Sections</span>
                  <div className="seg-toggle" role="group" aria-label="Expand or collapse sections">
                    <button
                      className={allExpanded ? 'active' : ''}
                      aria-pressed={allExpanded}
                      onClick={() => setAllCollapsed(false)}
                      title="Open every section and show its lines"
                    >
                      Expand all
                    </button>
                    <button
                      className={allCollapsed ? 'active' : ''}
                      aria-pressed={allCollapsed}
                      onClick={() => setAllCollapsed(true)}
                      title="Fold every section to its total"
                    >
                      Collapse all
                    </button>
                  </div>
                </div>
              )}
              <div className="toggle-field">
                <span className="toggle-field-label">Layout</span>
                <div
                  className="seg-toggle"
                  role="group"
                  aria-label="Grid orientation"
                  data-tour="orientation-toggle"
                >
                  <button
                    className={orientation === 'days-across' ? 'active' : ''}
                    aria-pressed={orientation === 'days-across'}
                    onClick={() => onChangeOrientation('days-across')}
                    title="Dates across the columns, one row per line item"
                  >
                    Dates → Columns
                  </button>
                  <button
                    className={orientation === 'grouped' ? 'active' : ''}
                    aria-pressed={orientation === 'grouped'}
                    onClick={() => onChangeOrientation('grouped')}
                    title="Dates down the rows, one column per line item"
                  >
                    Dates ↓ Rows
                  </button>
                </div>
              </div>

            </div>
            <div className="toggle-field">
              <span className="toggle-field-label">
                Opening balance <span className="optional">optional</span>
              </span>
              <input
                className="form-input balance-input"
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
        <div
          className={`panel chart-panel forecast-outlook${chartOpen ? ' is-open' : ''}`}
          data-tour="forecast-chart"
        >
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
          {/* Open, the outlook is a two-column panel: the series and comparison
              controls stand in a rail on the left, the plot takes everything
              left over. Capping the plot instead left two thirds of a
              full-width card empty beside a chart too small to read a week
              off. The columns are laid out in CSS (`.outlook-body`). */}
          {chartOpen && (
            <div className="outlook-body">
              <div className="outlook-controls">
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
                    value={compareMetric}
                    onChange={(e) => changeCompareMetric(e.target.value as CompareMetric)}
                    aria-label="Comparison metric"
                  >
                    {(Object.keys(COMPARE_LABELS) as CompareMetric[]).map((m) => (
                      <option key={m} value={m}>
                        Compare · {COMPARE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {plotSeries.length + overlaySeries.length === 0 ? (
                <div className="empty-state" style={{ padding: '30px 20px' }}>
                  <p>Select at least one series to plot.</p>
                </div>
              ) : (
                <Chart
                  labels={dayLabels.map((dl) => dl.dm)}
                  series={[...overlaySeries, ...plotSeries]}
                  unit="k"
                  // The outlook is read for the SHAPE of the week, which
                  // needs room in BOTH directions and, more than that, needs
                  // the two in proportion: the card caps the width (see
                  // `.forecast-outlook.is-open`) and this is the height that
                  // leaves the plot about as tall against it as the
                  // dashboard's outlook, where a week has a shape.
                  height={320}
                  // One column per day, inflows up and outflows down from the
                  // baseline — the day's gross movement as a single column,
                  // the way the dashboard's outlook draws it. Side by side,
                  // two half-width bars made the same day look like two.
                  stacked
                  // Fridays are the week-to-week reference point on a daily
                  // horizon — marked here as they are on treasury's outlook,
                  // and carrying the week's CLOSING BALANCE so it is read,
                  // not estimated. They used to carry the day's net, which is
                  // one of the columns already drawn underneath them and left
                  // four unlabelled figures over a two-series chart with
                  // nothing saying which line they belonged to. Where the
                  // balance is running, the number worth printing at a week
                  // edge is where the cash stands at the end of it.
                  emphasis={dayLabels.map((dl) => dl.dow === 'Fri')}
                  // ...which also makes them the dates worth printing, with
                  // the day the horizon opens on.
                  markedLabelsOnly
                  slotValues={
                    hasBalance
                      ? dayLabels.map((dl, d) => (dl.dow === 'Fri' ? balanceByDay[d] : null))
                      : undefined
                  }
                  slotValueLabel="Running balance"
                />
              )}
              {/* What the rest of the group says about this week, beside the
                  shape of it. Folded, the chart keeps the whole card and this
                  is a strip down the right-hand edge; opened, the two share
                  it — because deciding whether to carry a counterparty's
                  settlement is a decision about the line you are looking at. */}
              {hasIntercompany && (
                <aside
                  className={`outlook-mirrors${mirrorsOpen ? ' is-open' : ''}`}
                  data-tour="mirror-table"
                >
                  <button
                    className="mirror-collapse-head"
                    aria-expanded={mirrorsOpen}
                    title={
                      mirrorsOpen
                        ? 'Fold the intercompany table away'
                        : 'What the rest of the group states about this week'
                    }
                    onClick={() => setMirrorsOpen((v) => !v)}
                  >
                    <span className="section-caret" aria-hidden="true">
                      {mirrorsOpen ? '▸' : '◂'}
                    </span>
                    <span className="mirror-head-label">Intercompany</span>
                    {statements.length > 0 && (
                      <span className="badge-num">
                        {statements.filter((s) => s.carried).length}/{statements.length}
                      </span>
                    )}
                  </button>
                  {mirrorsOpen && (
                    <div className="mirror-body">
                      <MirrorTable
                        statements={statements}
                        dateLabel={(d) =>
                          dayLabels[d] ? `${dayLabels[d].dow} ${dayLabels[d].dm}` : `Day ${d + 1}`
                        }
                        periodLabels={{
                          current: weekLabelShort(week),
                          prior1: weekLabelShort(prevWeekKey(week)),
                          prior2: weekLabelShort(prevWeekKey(prevWeekKey(week))),
                        }}
                        editable={canEditCells}
                        onToggle={(counterparty) =>
                          void applyMirrorPrefs(
                            mirrorPrefsToggling(mirrorPrefs, counterparty, mirrorSources),
                          )
                        }
                      />
                    </div>
                  )}
                </aside>
              )}
            </div>
          )}
        </div>

        {/* The forecast itself, in its own box — the controls above are
            settings, not part of the grid. */}
        <div className="panel grid-panel">
          {/* What this forecast SAYS, above what it is made of.
              A submitter fills in twenty days of numbers and then has to
              scroll to the bottom of the grid to find out what they add up
              to; a reviewer opens the page for these four figures and
              nothing else. They belong at the top, on the box that holds
              the numbers they come from. */}
          <div className="forecast-summary">
            <div className="forecast-summary-id">
              <strong>{template.name}</strong>
              <span className="text-muted">
                {entity} · {weekLabelShort(week)} · EUR thousands · inflows +, outflows −
              </span>
            </div>
            <div className="forecast-stats">
              <div className="forecast-stat">
                <span className="forecast-stat-label">Inflows</span>
                <span className="forecast-stat-value net-positive">{fmtK(totalInflows)}</span>
              </div>
              <div className="forecast-stat">
                <span className="forecast-stat-label">Outflows</span>
                <span className="forecast-stat-value net-negative">{fmtK(totalOutflows)}</span>
              </div>
              <div className="forecast-stat">
                <span className="forecast-stat-label">Net</span>
                <span
                  className={`forecast-stat-value${
                    totalNet < 0 ? ' net-negative' : totalNet > 0 ? ' net-positive' : ''
                  }`}
                >
                  {fmtK(totalNet)}
                </span>
              </div>
              {/* A closing balance only means something once an opening one
                  is given, exactly as in the grid's own running total. */}
              {hasBalance && (
                <div className="forecast-stat">
                  <span className="forecast-stat-label">Closing</span>
                  <span className="forecast-stat-value">{fmtK(closingBalance)}</span>
                </div>
              )}
            </div>
          </div>
          {/* The commentary dock sits BESIDE the grid (left when the spotlit
              cell is on the right half), so the numbers stay in view while
              the explanation is written. */}
          <div className="grid-flow-row">
            {commentFlow?.side === 'left' && commentDock}
            <div className="forecast-grid-wrap" data-tour="forecast-grid">
              <ForecastGrid
                key={restoreVersion}
                categories={gridCats}
                layout={orientation}
                dayLabels={dayLabels}
                values={values}
                flags={flags}
                requested={requestedCells}
                // Only the asker needs the answered cells marked: to the
                // submitter that conversation is closed, and outlining cells
                // they have already dealt with reads as more work waiting.
                answered={isSubmitterView ? undefined : answeredCells}
                highlight={commentFlow ? new Set([commentFlow.key]) : null}
                highlightTone="comment"
                collapsedGroups={collapsedGroups}
                onToggleGroup={toggleGroup}
                startingBalance={startingBalance}
                editable={canEditCells}
                onChangeCell={setCell}
                onPaste={handlePaste}
                onCellClick={openVariance}
                clickableCells={canRequestComments ? 'all' : 'flagged'}
                // Adding a row is the submitter's gesture, so the `+` on a
                // section header appears only on their screen — a reader
                // opens a forecast to read it, not to add lines to it.
                onAddRow={canEditRows ? addRow : undefined}
                onRenameRow={canEditRows ? renameRow : undefined}
                onSetRowEntity={canEditRows ? setRowEntity : undefined}
                onRemoveRow={canEditRows ? (id) => void removeRow(id) : undefined}
                entityOptions={entityChoices}
                heatmapMode={heatMode}
                // The forecast screen alone: a horizon has weeks, a template
                // has only a shape, so the builder's preview shows none.
                weekBands
                showColumnTotals={template.columnTotals === true}
              />
            </div>
            {commentFlow?.side === 'right' && commentDock}
          </div>
        </div>

      </div>

      {/* What this forecast carries from the other side of the group. The
          rows are somebody else's statement about your figures, and taking
          them is a decision: a country reconciling with two counterparties
          does not want the other seven landing in the middle of it. */}
      <Modal
        open={mirrorDraft !== null}
        title="Intercompany Mirroring"
        onClose={() => setMirrorDraft(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setMirrorDraft(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => mirrorDraft && void applyMirrorPrefs(mirrorDraft)}
            >
              Apply
            </button>
          </>
        }
      >
        {mirrorDraft && (
          <>
            <p className="text-dim" style={{ marginBottom: 14 }}>
              When a counterparty forecasts a settlement with {entity}, that row is mirrored
              into this forecast with the sign flipped — they enter it, you read it, and both
              sides hold the same figure. This is what this forecast takes.
            </p>
            <label className="series-check" style={{ marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={mirrorDraft.enabled}
                onChange={(e) =>
                  setMirrorDraft({ ...mirrorDraft, enabled: e.target.checked })
                }
              />
              Include intercompany rows mirrored from other entities
            </label>
            {/* A list rather than the app's dropdown multi-select: this is the
                answer to "whose figures am I carrying?", which is a thing to
                read at a glance and not to open a menu for. (A dropdown inside
                a dialog also opens over the buttons under it.) */}
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label className="form-label">
                Counterparties to take rows from
                <span className="text-muted" style={{ marginLeft: 8, textTransform: 'none' }}>
                  {mirrorDraft.sources.length === 0
                    ? 'all of them'
                    : `${mirrorDraft.sources.length} of ${mirrorSources.length}`}
                </span>
              </label>
              <div className={`mirror-sources${mirrorDraft.enabled ? '' : ' is-off'}`}>
                {mirrorSources.map((name) => (
                  <label className="series-check" key={name}>
                    <input
                      type="checkbox"
                      disabled={!mirrorDraft.enabled}
                      checked={
                        mirrorDraft.sources.length === 0 || mirrorDraft.sources.includes(name)
                      }
                      onChange={() => setMirrorDraft(toggleMirrorSource(mirrorDraft, name))}
                    />
                    {name}
                    {mirroredHere.includes(name) && (
                      <span className="mirror-source-note">carrying rows</span>
                    )}
                  </label>
                ))}
              </div>
              <span className="text-muted" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                Leaving one out removes the rows it has mirrored here and stops new ones
                arriving until you take it back. That counterparty is told, so a figure they
                entered does not simply vanish on their side.
              </span>
            </div>
          </>
        )}
      </Modal>

      {/* Two readers, two dialogs — and neither of them is the submitter, who
          works their own forecast in the dock beside the grid. Treasury and
          approvers ASK about a cell (the asking dialog is shared with the
          preview dialog and Comments Review); everybody else who can open a
          cell is reading it. */}
      {canRequestComments && askTarget && varianceCell ? (
        <RequestCommentaryModal
          target={askTarget}
          context={`${entity} · ${weekLabelShort(week)}`}
          existing={commentRequests[varianceCell.key] ?? null}
          flagged={flags.has(varianceCell.key)}
          onClose={() => setVarianceCell(null)}
          onSent={(request) => onQuestionSent(varianceCell.key, request)}
        />
      ) : (
        <Modal
          open={varianceCell !== null}
          title="Variance Detail"
          onClose={() => setVarianceCell(null)}
          footer={
            <button className="btn btn-ghost" onClick={() => setVarianceCell(null)}>
              Close
            </button>
          }
        >
          {varianceCell && (
            <>
              <div className="variance-panel" style={{ marginBottom: 18 }}>
                <h4>{flags.has(varianceCell.key) ? 'Flagged Cell' : 'Cell'}</h4>
                <div className="row">
                  <span>
                    {varianceCell.label} · {periodLabelFor(varianceCell.key)}
                  </span>
                  <span className={varianceDelta === null ? undefined : 'figure'}>
                    {varianceDelta === null
                      ? 'new period'
                      : `${varianceDelta > 0 ? '+' : ''}${varianceDelta.toFixed(1)}%`}
                  </span>
                </div>
                <div className="row">
                  <span className="figure">
                    Prior:{' '}
                    {varianceCell.prior === null
                      ? '—'
                      : `€${varianceCell.prior.toLocaleString()}k`}
                  </span>
                  <span className="figure">
                    Current: €{varianceCell.current.toLocaleString()}k
                  </span>
                </div>
              </div>
              {/* The whole conversation about this cell, not just the last
                  thing said: an answer three exchanges in makes no sense
                  without the question it came from. */}
              {cellRequest && (
                <QuestionThread
                  messages={threadOf(
                    cellRequest,
                    comments[varianceCell.key] ?? '',
                    listEntities().find((e) => e.name === entity)?.submitter ?? 'Submitter',
                  )}
                  viewerRole={null}
                />
              )}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Commentary</label>
                <textarea
                  className="form-textarea"
                  placeholder="No commentary provided yet."
                  value={comments[varianceCell.key] ?? ''}
                  disabled
                  readOnly
                />
              </div>
            </>
          )}
        </Modal>
      )}

      {/* How this week starts. Two ways in, asked once, before there is
          anything on the forecast to lose — which is why neither answer needs
          a confirm behind it. */}
      {startChoice && (
        <Modal
          open
          title={`Start ${weekLabelShort(week)}`}
          onClose={() => void answerStartChoice(false)}
          footer={null}
        >
          <p className="start-choice-lead">How do you want to begin {entity}’s forecast?</p>
          <div className="start-choice">
            <button className="start-option" onClick={() => void answerStartChoice(true)}>
              <span className="start-option-mark" aria-hidden="true">
                ↻
              </span>
              <strong>Carry last week over</strong>
              <span className="text-muted">
                {weekLabelShort(prevWeekKey(week))} figures, ready to adjust
              </span>
            </button>
            <button
              className="start-option"
              onClick={() => void answerStartChoice(false)}
            >
              <span className="start-option-mark" aria-hidden="true">
                +
              </span>
              <strong>Start blank</strong>
              <span className="text-muted">An empty grid to type into</span>
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
