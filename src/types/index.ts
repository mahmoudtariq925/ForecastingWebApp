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
  /** Human-readable start of the 30-day horizon, e.g. "May 18". */
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
}

/** A flagged variance between the current and prior cycle for a cell. */
export interface Variance {
  ent: string;
  cat: string;
  day: string;
  /** Prior cycle value in EUR thousands. */
  prior: number;
  /** Current cycle value in EUR thousands. */
  current: number;
  /** Commentary explaining the driver; empty means commentary is still needed. */
  comment: string;
}

/**
 * Demo-data generation config for a known line-item label (paydays, tax days,
 * value ranges). Only the seeded standard template has these.
 */
export interface LineItemConfig {
  label: string;
  baseMin: number;
  baseMax: number;
  negative?: boolean;
  payday?: boolean;
  taxday?: boolean;
}

/** Row kinds in a forecast template. */
export type TemplateRowKind = 'section' | 'data' | 'subtotal' | 'total';

/**
 * One row of a forecast template. `subtotal` rows sum the data rows since the
 * previous section; `total` rows sum all subtotals (or all data rows when a
 * template has no subtotals).
 */
export interface TemplateRow {
  label: string;
  kind: TemplateRowKind;
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
  /** Parsed row structure driving the submission grid. */
  rows: TemplateRow[];
  /** Base64 of the original .xlsx for download/re-use (small files only). */
  fileData?: string;
}

/**
 * A single entity's grid submission for one reporting period + template:
 * the editable numeric values keyed by "rowIndex-dayIndex", variance flags,
 * and per-cell commentary.
 */
export interface Submission {
  /** Reporting period key, e.g. "2026-05". */
  period: string;
  entity: string;
  templateId: string;
  status: SubmissionStatus;
  /** Cell values keyed as `${rowIdx}-${dayIdx}`. */
  values: Record<string, number>;
  /** Variance-flagged cell keys (`${rowIdx}-${dayIdx}`). */
  flags: string[];
  /** Commentary per flagged cell, keyed like `values`. */
  comments: Record<string, string>;
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
