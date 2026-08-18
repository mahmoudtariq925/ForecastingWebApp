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
   * An intercompany line: every figure on it is owed to, or owed by, another
   * legal entity in the group.
   *
   * The flag is the ONLY thing the template carries — no counterparty column,
   * no picker. Who the money moves between is a property of the amount, not of
   * the template, so it is entered per cell on the forecast (see
   * `Submission.intercompany`) and mirrored into the counterparty's forecast
   * from there.
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
 * Where a mirrored intercompany leg came from.
 *
 * An intercompany amount is one movement seen from two sides, so it is entered
 * ONCE — by whoever owns the relationship — and appears on the counterparty's
 * forecast automatically with the sign flipped. This marker is what makes the
 * copy honest: it says the figure is system-generated, which entity produced
 * it, and what it arrived as, so a receiving side that disagrees can be shown
 * both numbers rather than silently overwriting the only one on record.
 */
export interface MirrorSource {
  /** Entity whose forecast this leg was entered on. */
  entity: string;
  /** The originating leg's id, so an edit or deletion there finds this copy. */
  legId: string;
  /**
   * The amount as mirrored — already sign-flipped, and kept apart from the
   * leg's own `amount` so a dispute has an original to show. Updated if the
   * originator changes their figure.
   */
  originalAmount: number;
  /**
   * The cell this leg was entered on, on the ORIGINATOR's forecast. Two
   * entities rarely run the same template, so the mirror can land on a
   * different cell key than it left — this is what lets a later edit find
   * every copy it produced, whichever cell it ended up on.
   */
  sourceCellKey: string;
  /** ISO timestamp of the last time the originator wrote this figure. */
  at: string;
  /**
   * The mirror landed on a forecast that had already been handed over. The
   * figure still arrives — it is a fact from the other side — but the
   * receiving submitter is told it turned up after they submitted.
   */
  afterSubmission?: boolean;
}

/**
 * One counterparty's share of an intercompany cell.
 *
 * A cell is the SUM of its legs: one leg is the ordinary case, and a cell only
 * grows more when the amount splits across several counterparties. Legs the
 * app mirrored in carry `mirrorOf`; legs this entity entered itself do not,
 * which is also what stops a mirror from bouncing back and forth forever.
 */
export interface IntercompanyLeg {
  /** Stable id — the handle a mirror keeps on the leg that produced it. */
  id: string;
  /** Legal entity on the other side. Always a configured entity, never text. */
  counterparty: string;
  /** EUR thousands, in this entity's own sign convention. */
  amount: number;
  /** Present only on a leg mirrored in from the counterparty's forecast. */
  mirrorOf?: MirrorSource;
}

/**
 * A receiving side disagreeing with a mirrored figure.
 *
 * Deliberately NOT stored on the cell value: the two entities keep their own
 * numbers, and the disagreement is a conversation beside them rather than a
 * correction applied to one. It is raised only on the side that changed the
 * figure, never on the originator's forecast, and it gates nothing — a
 * forecast submits and a cycle closes with mismatches outstanding.
 *
 * Shaped like `CommentRequest` on purpose: opening message plus `replies`, so
 * the same thread rendering and the same append rules serve both.
 */
export interface IntercompanyMismatch {
  /** Cell the disputed leg sits on, keyed like `Submission.values`. */
  cellKey: string;
  /** The mirrored leg being disputed. */
  legId: string;
  /** The entity whose figure this is — the other side of the conversation. */
  counterparty: string;
  /** What the counterparty sent (sign already flipped). */
  originalAmount: number;
  /** What this side changed it to. */
  changedAmount: number;
  /** Display name of whoever changed it. */
  from: string;
  /** Which side of the conversation opened it. Always a submitter today. */
  fromRole: ThreadRole;
  /** The reason, required before the change is accepted. */
  message: string;
  raisedAt: string;
  /** Everything said after the reason, oldest first. */
  replies?: ThreadMessage[];
  /** Set when either side marks the disagreement settled. */
  settledAt?: string;
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
   * Counterparty breakdown for intercompany cells, keyed like `values`.
   *
   * `values[key]` stays the single number every other screen reads — it is the
   * sum of these legs and is rewritten whenever they change, so the chart, the
   * totals, the consolidation and the export need to know nothing about
   * intercompany at all.
   */
  intercompany?: Record<string, IntercompanyLeg[]>;
  /**
   * Unsettled disagreements with mirrored figures, keyed
   * `${catIdx}-${dayIdx}::${legId}` — one cell can dispute more than one
   * counterparty. Present only on the side that changed a figure.
   */
  mismatches?: Record<string, IntercompanyMismatch>;
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
