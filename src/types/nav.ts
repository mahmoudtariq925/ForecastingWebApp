// Navigation identifiers and the modal registry, kept separate from the domain
// types so UI wiring doesn't leak into the data contracts.
import type { Permissions } from '../data/session';

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
  | 'users'
  | 'settings';

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
        { view: 'templates', label: 'Templates' },
        { view: 'users', label: 'User Management' },
        { view: 'settings', label: 'Settings' },
      ],
    };
  }

  // System-configuration-only role (e.g. admin without treasury duties):
  // just the pages they manage, nothing financial.
  const isConfigOnly = p.canManageUsers || p.canManageTemplates || p.canChangeSettings;
  if (isConfigOnly && !p.canSubmitForecasts && !p.canApproveForecasts) {
    const admin: NavEntry[] = [];
    if (p.canManageUsers) admin.push({ view: 'users', label: 'User Management' });
    if (p.canManageTemplates) admin.push({ view: 'templates', label: 'Templates' });
    if (p.canChangeSettings) admin.push({ view: 'settings', label: 'Settings' });
    return { workspace: [], admin };
  }

  // Focused analyst / approver experience: just their own work.
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
