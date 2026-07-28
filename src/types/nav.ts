// Navigation identifiers and the modal registry, kept separate from the domain
// types so UI wiring doesn't leak into the data contracts.
import type { Permissions } from '../data/session';
import { IS_LIVE } from '../data/dataSource';

export type ViewId =
  | 'dashboard'
  | 'analystHome'
  | 'cycles'
  | 'submission'
  | 'approvals'
  | 'consolidated'
  | 'comparison'
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
    return {
      workspace: [
        { view: 'dashboard', label: 'Dashboard' },
        { view: 'cycles', label: 'Forecast Cycles' },
        { view: 'submission', label: 'My Submissions' },
        { view: 'approvals', label: 'Approvals' },
        { view: 'consolidated', label: 'Consolidated' },
        { view: 'comparison', label: 'Comparisons' },
      ],
      admin: [
        { view: 'review', label: 'Comments Review' },
        // The live instance is populated by importing real workbooks.
        ...(IS_LIVE ? [{ view: 'dataImport', label: 'Data Import' } as NavEntry] : []),
        { view: 'templates', label: 'Templates' },
        { view: 'legalEntities', label: 'Legal Entity Setup' },
        { view: 'users', label: 'User Management' },
        { view: 'settings', label: 'Settings' },
      ],
    };
  }

  // System-configuration-only role (admin): the configuration screens, no
  // forecast workflow. Treasury reaches these too, but keeps its workspace.
  if (p.canViewAdminScreens) {
    return {
      workspace: [],
      admin: [
        { view: 'users', label: 'User Management' },
        { view: 'templates', label: 'Templates' },
        { view: 'legalEntities', label: 'Legal Entity Setup' },
        ...(IS_LIVE ? [{ view: 'dataImport', label: 'Data Import' } as NavEntry] : []),
        { view: 'settings', label: 'Settings' },
      ],
    };
  }

  // Focused analyst experience: submitters, approvers and viewers see only
  // their own work — never users, settings or legal entity configuration.
  const workspace: NavEntry[] = [
    { view: 'analystHome', label: 'My Dashboard' },
    { view: 'submission', label: 'My Forecasts' },
  ];
  if (p.canApproveForecasts) workspace.push({ view: 'approvals', label: 'Approvals' });
  workspace.push({ view: 'review', label: 'Comments / Feedback' });
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
