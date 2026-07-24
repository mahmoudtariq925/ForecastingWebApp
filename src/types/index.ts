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

/** Access role assigned to a user, optionally scoped to entities. */
export type Role = 'admin' | 'treasury' | 'approver' | 'submitter';

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

/** A managed user and their role assignment. */
export interface User {
  name: string;
  email: string;
  team: string;
  role: Role;
  /** Entities this user can approve for, or "—". */
  scope: string;
  last: string;
  /**
   * Entities this user works on (submitters/approvers). Admin/treasury see
   * everything regardless. Users without the field fall back to the entities
   * that name them as submitter/approver.
   */
  assignedEntities?: string[];
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
}
