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
 * A row definition in the 30-day forecast grid. A row is either a section
 * header (`section` set) or a data / computed line item (`label` set).
 */
export interface LineItem {
  section?: string;
  label?: string;
  baseMin?: number;
  baseMax?: number;
  negative?: boolean;
  payday?: boolean;
  taxday?: boolean;
  /** True for the Total Inflows / Total Outflows computed rows. */
  isSubtotal?: boolean;
  /** True for the Net Cash Flow computed row. */
  isTotal?: boolean;
}

/**
 * A single entity's grid submission for one cycle: the editable numeric values
 * keyed by "rowIndex-dayIndex", plus which cells are variance-flagged.
 */
export interface Submission {
  cycleId: string;
  entity: string;
  status: SubmissionStatus;
  /** Cell values keyed as `${rowIdx}-${dayIdx}`. */
  values: Record<string, number>;
  /** Variance-flagged cell keys (`${rowIdx}-${dayIdx}`). */
  flags: string[];
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
