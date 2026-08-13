// Navigation identifiers and the modal registry, kept separate from the domain
// types so UI wiring doesn't leak into the data contracts.
import type { Permissions } from '../data/session';
import { IS_LIVE } from '../data/dataSource';

export type ViewId =
  | 'dashboard'
  | 'analystHome'
  | 'cycles'
  | 'submission'
  | 'review'
  | 'templates'
  | 'legalEntities'
  | 'users'
  | 'settings'
  | 'dataImport';

export type ModalId = 'newCycle' | 'export' | null;

export interface NavEntry {
  view: ViewId;
  label: string;
}

export interface NavSections {
  workspace: NavEntry[];
  admin: NavEntry[];
}

/**
 * The navigation a user sees, derived from their permissions — the sidebar
 * and the App-level view guard both consume this, so screens and menu always
 * agree on what a role can access.
 */
export function navFor(p: Permissions): NavSections {
  if (p.canViewTreasuryDashboard) {
    // The consolidated position and forecast-vs-forecast are no longer
    // screens: both are read from the dashboard's outlook chart, one click
    // from the number that raised the question.
    //
    // Neither is Approvals. Approving is the country approver's job; treasury
    // opens a forecast and asks about a number, which is what Comments Review
    // and the per-cell comment request are for. The queue treasury used to
    // have offered a decision on forecasts nobody had submitted.
    return {
      // The questions queue is forecast work, not configuration: it is where
      // treasury chases the explanations a cycle cannot close without. Filed
      // under Admin it sat among users, templates and settings — screens
      // touched once a quarter — and read as an administrative chore.
      workspace: [
        { view: 'dashboard', label: 'Dashboard' },
        { view: 'cycles', label: 'Forecast Cycles' },
        { view: 'submission', label: 'Submissions' },
        { view: 'review', label: 'Questions' },
      ],
      admin: [
        // The live instance is populated by importing real workbooks.
        ...(IS_LIVE ? [{ view: 'dataImport', label: 'Data Import' } as NavEntry] : []),
        { view: 'templates', label: 'Templates' },
        { view: 'legalEntities', label: 'Legal Entity Setup' },
        { view: 'users', label: 'User Management' },
        { view: 'settings', label: 'Settings' },
      ],
    };
  }

  // Focused analyst experience: submitters, approvers and viewers see only
  // their own work — never users, settings or legal entity configuration.
  // Only a submitter owns the forecasts on this screen; an approver or
  // viewer is looking at someone else's, so "My" would be a lie.
  const workspace: NavEntry[] = [
    { view: 'analystHome', label: 'My Dashboard' },
    {
      view: 'submission',
      label: p.canSubmitForecasts ? 'My Forecasts' : 'Submissions',
    },
  ];
  // Approvers decide straight from their dashboard checklist (approve /
  // review per country) — a separate Approvals screen was one page too many.
  // Forecast-vs-forecast is not a screen either: the variances that need
  // explaining arrive as questions, and the numbers behind them are on the
  // forecast itself.
  workspace.push({ view: 'review', label: 'Questions' });
  return { workspace, admin: [] };
}

/** Every view id a user may open (nav plus non-menu deep links). */
export function allowedViews(p: Permissions): Set<ViewId> {
  const sections = navFor(p);
  return new Set<ViewId>([...sections.workspace, ...sections.admin].map((e) => e.view));
}

/** Where a user lands after sign-in / user switch: the first item in their
 * own navigation, so it can never point at a screen they can't reach. */
export function landingViewFor(p: Permissions): ViewId {
  const sections = navFor(p);
  return sections.workspace[0]?.view ?? sections.admin[0]?.view ?? 'analystHome';
}
