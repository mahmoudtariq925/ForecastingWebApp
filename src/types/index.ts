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
  /** 'submitted' = open for entry, 'consolidated' = closed. */
  status: 'submitted' | 'consolidated';
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
 * A request for commentary on one forecast cell, from treasury or from the
 * entity's approver.
 *
 * Distinct from a variance flag: a flag is derived from the numbers, whereas
 * a request is a person asking a question — so it can land on any cell,
 * including one the threshold never flagged.
 */
export interface CommentRequest {
  /** Display name of whoever asked, for the submitter's benefit. */
  from: string;
  /** Which role they asked in. Absent on questions stored before this existed. */
  fromRole?: RequesterRole;
  message: string;
  requestedAt: string;
  /**
   * When the submitter answered. Set rather than deleting the request, so the
   * QUESTION stays beside the answer: whoever asked comes back to a cell with
   * a paragraph of commentary on it, and without this there is nothing left
   * to say what that paragraph is an answer to.
   *
   * An unset value is what "open question" means everywhere.
   */
  answeredAt?: string;
}

/**
 * Why a forecast that had been handed over is back with its submitter: a
 * question reopens it (see `requestComment`), and without this the checklist
 * could only see a forecast "in draft" and read it as one never started.
 *
 * Only meaningful while the submission is in `draft`; resubmitting moves the
 * status on and the reopening stops being the current state of affairs.
 */
export interface ForecastReopen {
  /** Display name of whoever asked the question that reopened it. */
  by: string;
  role: RequesterRole;
  /** ISO timestamp of the question. */
  at: string;
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
   * Set when a question sent this forecast back to its submitter, so every
   * screen can say "reopened, answer and resubmit" rather than "still in
   * draft". Read only while `status` is `draft`.
   */
  reopenedBy?: ForecastReopen;
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
