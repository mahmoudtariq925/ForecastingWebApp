// ============================================================================
// Domain types for the Liquid cash-flow forecasting app.
// These describe the shape of everything that gets persisted (via the storage
// layer) and passed between screens. Keeping them in one place makes the
// Phase 2 swap to a real API a matter of matching these contracts.
// ============================================================================

/** Workflow status shared by submissions, cycle progress rows and approvals. */
export type SubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'consolidated';

/** Access role assigned to a user. Global roles say WHAT a user may do;
 * the Legal Entity Setup says WHERE (which entities) they may do it. */
export type Role = 'admin' | 'treasury' | 'approver' | 'submitter' | 'viewer';

/** Whether a managed user account is active. */
export type UserStatus = 'active' | 'inactive';

/** Entity-level responsibility a user can hold via Legal Entity Setup. */
export type EntityResponsibility = 'viewer' | 'approver' | 'submitter';

/** A reporting entity / country team that submits a forecast. */
export interface Entity {
  /** Country / team display name, also used as the stable key. */
  name: string;
  /** Reporting region the country rolls up into. */
  region: string;
  submitter: string;
  approver: string;
  /** Headline total in EUR thousands. */
  total: number;
  /** Percentage delta vs the prior cycle. */
  delta: number;
  status: SubmissionStatus;
}

/** A weekly forecast cycle. */
export interface Cycle {
  id: string;
  /** Human-readable start of the horizon, e.g. "May 18". */
  start: string;
  /** Human-readable close deadline, e.g. "May 22 · 18:00". */
  closes: string;
  status: SubmissionStatus;
  /** Submissions received / expected, e.g. "14 / 18". */
  subs: string;
  /** Consolidated total in EUR millions. */
  total: number;
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
  /** True for templates authored in the browser rather than uploaded. */
  builtInEditor?: boolean;
}

/**
 * A single entity's grid submission for one forecast week + template.
 * Values are keyed "categoryIndex-dayIndex" regardless of layout.
 * Sign convention (from the standard workbook): inflows positive,
 * outflows negative.
 */
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
  /** Free-text comment per day (the Comments column in grouped layout). */
  dayComments: Record<string, string>;
  /** Opening cash balance for the horizon, EUR thousands. */
  startingBalance: number;
  updatedAt: string;
}

/** Configurable variance / cycle rules from the Settings screen. */
export interface Settings {
  horizon: string;
  frequency: string;
  varianceThreshold: number;
  minValueToTrigger: string;
  exemptNewPeriods: string;
  ssoProvider: string;
  allowedDomains: string;
  /**
   * Whether Treasury users may manage users, settings and legal entities.
   * Off by default (Treasury is view-only there); only admins can change it.
   */
  treasuryManagementEnabled: boolean;
}
