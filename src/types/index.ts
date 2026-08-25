// ============================================================================
// Domain types for the Liquid cash-flow forecasting app.
// These describe the shape of everything that gets persisted (via the storage
// layer) and passed between screens. Keeping them in one place makes the
// Phase 2 swap to a real API a matter of matching these contracts.
// ============================================================================

/**
 * Workflow status shared by submissions, cycle progress rows and approvals.
 *
 * There is exactly one of these per (week, entity, template), and it lives on
 * the stored submission. Screens must never keep a second copy: a seed status
 * on the entity used to shadow this one, so the same forecast could read as
 * "approved" on the dashboard and "still in draft" to the person who owns it.
 */
export type SubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'consolidated';

/** Access role assigned to a user. Global roles say WHAT a user may do;
 * the Legal Entity Setup says WHERE (which entities) they may do it.
 * Treasury is the full role: forecast oversight AND system configuration. */
export type Role = 'treasury' | 'approver' | 'submitter' | 'viewer';

/** Whether a managed user account is active. */
export type UserStatus = 'active' | 'inactive';

/** Entity-level responsibility a user can hold via Legal Entity Setup. */
export type EntityResponsibility = 'viewer' | 'approver' | 'submitter';

/**
 * A reporting entity / country team that submits a forecast.
 *
 * Identity and reporting structure only. Who submits and who approves is read
 * from Legal Entity Setup (and resolved against User Management), and the
 * forecast figures and workflow status are read from the stored submission —
 * neither is duplicated here, so no screen can show a name or a number that
 * disagrees with the rest of the app.
 */
export interface Entity {
  /** Country / team display name, also used as the stable key. */
  name: string;
  /** Reporting region the country rolls up into. */
  region: string;
  /** Display name of the assigned submitter, or "—" when unassigned. */
  submitter: string;
  /** Display name of the assigned approver, or "—" when unassigned. */
  approver: string;
}

/**
 * A weekly forecast cycle. A cycle IS a forecast week — `weekKey` is the
 * Monday it collects, so the cycle id, its dates and the data every screen
 * shows can never describe different periods.
 */
export interface Cycle {
  /** e.g. "CW-2026-33" — derived from `weekKey`, never typed by hand. */
  id: string;
  /** ISO Monday of the week this cycle collects, e.g. "2026-08-10". */
  weekKey: string;
  /** Human-readable start of the horizon, e.g. "10 Aug". */
  start: string;
  /** Human-readable close deadline, e.g. "14 Aug · 18:00". */
  closes: string;
  /**
   * `scheduled` = laid out for a future week, not open yet; `submitted` = open
   * for entry; `consolidated` = closed. Upcoming cycles are shown rather than
   * created, so treasury opens the next week instead of inventing it.
   */
  status: 'scheduled' | 'submitted' | 'consolidated';
  /**
   * Entities this cycle collects from, by name. Absent means every active
   * entity — a cycle can be opened for a subset (one region's countries
   * first, say), and only those entities' forecasts are then editable.
   */
  entities?: string[];
  /** ISO timestamp the cycle was opened, for the "opened 8h ago" column. */
  openedAt: string;
}

/**
 * A managed user: WHO they are and their GLOBAL role. Entity-specific
 * responsibilities are NOT stored here — they live on the legal entities
 * (see `LegalEntity`) and are configured in Legal Entity Setup, so this
 * object never has to be rewritten when an entity assignment changes.
 */
export interface User {
  name: string;
  email: string;
  /** Organisational team, informational only (not an entity assignment). */
  team: string;
  role: Role;
  status: UserStatus;
  /** Last login / activity label. */
  last: string;
  /** @deprecated Legacy field from before Legal Entity Setup existed. */
  scope?: string;
  /** @deprecated Superseded by the legal-entity assignment lists. */
  assignedEntities?: string[];
  /**
   * Demo accounts that stand in for a brand-new joiner: selecting one always
   * replays the onboarding walkthrough, so each role's tour can be reviewed
   * without clearing browser storage.
   */
  alwaysTour?: boolean;
}

/**
 * A configured legal entity: its master data, the users responsible for it
 * and the forecast template it uses. This is the single source of truth for
 * "who can do what, where" — User Management only reads it.
 */
export interface LegalEntity {
  id: string;
  name: string;
  country: string;
  region: string;
  /** ISO currency code, e.g. "EUR". */
  currency: string;
  status: 'active' | 'inactive';
  /** Emails of users with the global `viewer` role. */
  viewers: string[];
  /** Emails of users with the global `approver` role. */
  approvers: string[];
  /** Emails of users with the global `submitter` role. */
  submitters: string[];
  /** Forecast template this entity submits on. */
  forecastTemplateId: string;
  /**
   * Who owns each LINE ITEM of that template, keyed by the line's label and
   * holding submitter emails.
   *
   * A country's forecast is rarely one person's work — payroll comes from HR,
   * tax from the tax team — so a question about salaries has to reach whoever
   * actually produces that line rather than the entity's first submitter.
   * A line with no entry here falls back to `submitters`, which is what every
   * entity had before this existed.
   */
  lineItemSubmitters?: Record<string, string[]>;
  /**
   * Percentage move versus the prior cycle that flags a cell for commentary.
   * Set per entity because a small entity's numbers swing far harder than a
   * large one's. Omitted = fall back to the group default in Settings.
   */
  varianceThreshold?: number;
}

/**
 * Demo-data generation config for a known category label (paydays, tax days,
 * value ranges). Only the seeded standard template has these.
 */
export interface LineItemConfig {
  label: string;
  baseMin: number;
  baseMax: number;
  payday?: boolean;
  taxday?: boolean;
}

/**
 * How a template is rendered / imported / exported:
 * - `days-across`: line items down the rows, one column per day.
 * - `grouped`: one row per day, categories across columns under group bands
 *   (the layout of the standard CF_Forecast_Template workbook).
 */
export type TemplateLayout = 'days-across' | 'grouped';

/** One forecast line item. `group` is the band it belongs to, if any. */
export interface TemplateCategory {
  label: string;
  group?: string;
  /**
   * A computed subtotal row rather than an input line: the app sums the
   * preceding line items of the same group into it, and it is excluded from
   * the grand totals so nothing is double counted.
   */
  subtotal?: boolean;
  /**
   * Money moving between group companies rather than in or out of the group.
   *
   * A SECTION-level decision, carried on every line inside the section (a
   * template stores its sections as a repeated `group` label, so there is
   * nowhere else to put it). What it changes is the rows a submitter may add
   * under that section: everywhere else a row is freely named, and under an
   * intercompany section it must BE a legal entity, picked from the master
   * data (see `CustomRow`) so the amount can be mirrored into that entity's
   * own forecast and the group position can net to zero.
   */
  intercompany?: boolean;
}

/** How many forecast columns a template has, and how far apart they are. */
export type PeriodGranularity = 'day' | 'week' | 'month';

export interface TemplatePeriods {
  /** Number of forecast periods (columns in days-across orientation). */
  count: number;
  granularity: PeriodGranularity;
}

/** An uploaded (or seeded) forecast template. */
export interface ForecastTemplate {
  id: string;
  name: string;
  /** Original file name of the uploaded .xlsx, if any. */
  fileName?: string;
  uploadedAt: string;
  uploadedBy: string;
  /** Entity names this template is assigned to. */
  assignedEntities: string[];
  /** Render / import / export orientation. */
  layout: TemplateLayout;
  /** The forecast line items derived from the workbook. */
  categories: TemplateCategory[];
  /** Base64 of the original .xlsx for download/re-use (small files only). */
  fileData?: string;
  /**
   * Forecast columns. Omitted for templates built before the in-browser
   * editor (and for uploaded workbooks), which keep the standard
   * four-week / 20-working-day horizon.
   */
  periods?: TemplatePeriods;
  /**
   * Starting values seeded into a new submission, keyed `${catIdx}-${periodIdx}`
   * exactly like `Submission.values`. Set in the template editor.
   */
  defaultValues?: Record<string, number>;
  /** Free-text note shown in the template list and editor. */
  description?: string;
  /**
   * Show a pinned totals row (or right-most column, depending on the
   * orientation) summing every line item per period. Persisted per template.
   */
  columnTotals?: boolean;
  /** True for templates authored in the browser rather than uploaded. */
  builtInEditor?: boolean;
}

/**
 * A single entity's grid submission for one forecast week + template.
 * Values are keyed "categoryIndex-dayIndex" regardless of layout.
 * Sign convention (from the standard workbook): inflows positive,
 * outflows negative.
 */
/**
 * Which side a question came from.
 *
 * Two different people ask a submitter about a cell, and they mean different
 * things: an APPROVER is deciding whether to sign this forecast off, while
 * TREASURY is consolidating it into the group position. Labelling every
 * question "Treasury" told the submitter the wrong person was waiting.
 */
export type RequesterRole = 'treasury' | 'approver';

/**
 * Who wrote one message in a question thread: the two sides that ASK, plus
 * the submitter who answers.
 */
export type ThreadRole = RequesterRole | 'submitter';

/** One message in the conversation about a cell. */
export interface ThreadMessage {
  /** Display name of whoever wrote it. */
  from: string;
  role: ThreadRole;
  text: string;
  /** ISO timestamp. */
  at: string;
}

/**
 * The conversation about one forecast cell, opened by treasury or by the
 * entity's approver.
 *
 * Distinct from a variance flag: a flag is derived from the numbers, whereas
 * a question is a person asking about them — so it can land on any cell,
 * including one the threshold never flagged.
 *
 * A question is rarely settled in one exchange, so this is a THREAD: the
 * opening question (`from` / `message` / `requestedAt`) plus every reply that
 * followed, in order. `answeredAt` still says which side the ball is on — set
 * when the submitter replies, cleared when the asker comes back.
 */
export interface CommentRequest {
  /** Display name of whoever opened the thread. */
  from: string;
  /** Which role they asked in. Absent on questions stored before this existed. */
  fromRole?: RequesterRole;
  /** The opening question. */
  message: string;
  requestedAt: string;
  /**
   * Everything said after the opening question, oldest first. Absent on
   * threads stored before replies existed — those carry at most a single
   * answer, which lives in `Submission.comments` for the cell.
   */
  replies?: ThreadMessage[];
  /**
   * When the submitter last replied. Set rather than deleting the request, so
   * the QUESTION stays beside the answer: whoever asked comes back to a cell
   * with a paragraph of commentary on it, and without this there is nothing
   * left to say what that paragraph is an answer to.
   *
   * An unset value is what "open question" means everywhere.
   */
  answeredAt?: string;
}

/**
 * The question that put a handed-over forecast back in front of its submitter.
 *
 * Being asked about a cell no longer RETURNS the forecast — the numbers stay
 * where they are and the approval stands; what changes is that somebody owes a
 * reply. Recorded so every screen can say "in review, questions waiting"
 * instead of showing a submitted forecast with nothing going on.
 */
export interface ForecastQuestion {
  /** Display name of whoever asked. */
  by: string;
  role: RequesterRole;
  /** ISO timestamp of the question. */
  at: string;
}

/**
 * A row a submitter added under a section of their forecast.
 *
 * A template says what a forecast is SHAPED like, never what one country's
 * receivables are made of: that is "Customer A, Customer B, everything else",
 * and it differs by entity and by week. So every section carries a `+`, and
 * the rows added under it are the submitter's own — named by them, entered by
 * them, and summed into the section they sit in.
 *
 * They are rows of the forecast like any other: the value of period `d` lives
 * in `Submission.values` under `${categories.length + rowIndex}-${d}`, so the
 * grid, the totals, the flags and the commentary all address them exactly as
 * they address a template line. What a custom row never becomes is a
 * CATEGORY: consolidation reads sections, so "Customer A" is part of the
 * Receivables total everywhere outside the forecast it was typed into.
 *
 * Under an INTERCOMPANY section a row is not freely named — it is a legal
 * entity, chosen from the master data and shown by its ISO code, because the
 * amount has to reach that entity's own forecast (see `source`).
 */
export interface CustomRow {
  /** Stable for the life of the row; mirrored rows derive theirs. */
  id: string;
  /** Section it belongs to: the template `group` label it was added under. */
  section: string;
  /** What the submitter called it, or the counterparty's ISO code. */
  label: string;
  /**
   * Intercompany rows only: the legal entity this row is about, by name.
   * Free text is deliberately impossible here — a counterparty that does not
   * resolve to a forecast is an amount that can never be mirrored anywhere.
   */
  entity?: string;
  /**
   * The entity whose submitter entered the original figures. Set only on
   * MIRRORED rows — the system-generated other half of somebody else's entry,
   * which this entity reads rather than edits.
   */
  source?: string;
  /** The originating row's id, so an edit finds its mirror again. */
  sourceRowId?: string;
  /**
   * The mirror landed after this entity had already handed its forecast over,
   * so the figures somebody signed off no longer match what is here. Recorded
   * rather than silently reopening a decision that was made in good faith.
   */
  late?: boolean;
}

export interface Submission {
  /** Forecast week key: ISO date of the Monday, e.g. "2026-07-13". */
  period: string;
  entity: string;
  templateId: string;
  status: SubmissionStatus;
  /** Cell values keyed as `${catIdx}-${dayIdx}`, EUR thousands. */
  values: Record<string, number>;
  /** Variance-flagged cell keys (`${catIdx}-${dayIdx}`). */
  flags: string[];
  /** Flagged cells an admin has marked as reviewed/resolved. */
  resolvedFlags?: string[];
  /** Commentary per flagged cell, keyed like `values`. */
  comments: Record<string, string>;
  /**
   * Open treasury requests for commentary, keyed like `values`. A request can
   * sit on any cell, flagged or not; it clears when the submitter answers it.
   */
  commentRequests?: Record<string, CommentRequest>;
  /**
   * The most recent question asked on this forecast, so every screen can say
   * "in review — questions waiting" rather than leaving a submitted forecast
   * looking untouched. Read while any question is still open.
   */
  questionedBy?: ForecastQuestion;
  /**
   * The status this forecast held when its submitter changed a figure after
   * handing it over. Editing withdraws a submitted (or approved) forecast:
   * the numbers someone signed off no longer exist, so it goes round the
   * approval cycle again. Cleared on resubmission.
   */
  revisedFrom?: SubmissionStatus;
  /**
   * The rows this submitter added under the template's sections, in order.
   *
   * Their FIGURES are not here: row `i` holds its numbers in `values` under
   * `${template.categories.length + i}-${dayIdx}`, exactly like a template
   * line, so nothing that reads a forecast has to know which rows came from
   * the template and which from the person filling it in.
   */
  customRows?: CustomRow[];
  /** Free-text comment per day (the Comments column in grouped layout). */
  dayComments: Record<string, string>;
  /**
   * Opening cash balance for the horizon, EUR thousands. Optional: `null`
   * means the submitter hasn't given one, and the grid then leaves the
   * running-total column out rather than counting up from an assumed zero.
   */
  startingBalance: number | null;
  updatedAt: string;
}

/** Configurable variance / cycle rules from the Settings screen. */
export interface Settings {
  horizon: string;
  frequency: string;
  /**
   * Group-wide default. Legal Entity Setup overrides it per entity, which is
   * where the threshold is actually managed — see `LegalEntity.varianceThreshold`.
   */
  varianceThreshold: number;
  minValueToTrigger: string;
  exemptNewPeriods: string;
  ssoProvider: string;
  allowedDomains: string;
}
