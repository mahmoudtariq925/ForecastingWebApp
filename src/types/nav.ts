// Navigation identifiers and the modal registry, kept separate from the domain
// types so UI wiring doesn't leak into the data contracts.

export type ViewId =
  | 'dashboard'
  | 'cycles'
  | 'submission'
  | 'approvals'
  | 'consolidated'
  | 'comparison'
  | 'users'
  | 'settings';

export type ModalId =
  | 'newCycle'
  | 'export'
  | 'variance'
  | 'newUser'
  | null;

export interface NavEntry {
  view: ViewId;
  label: string;
}

export const workspaceNav: NavEntry[] = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'cycles', label: 'Forecast Cycles' },
  { view: 'submission', label: 'My Submissions' },
  { view: 'approvals', label: 'Approvals' },
  { view: 'consolidated', label: 'Consolidated' },
  { view: 'comparison', label: 'Comparisons' },
];

export const adminNav: NavEntry[] = [
  { view: 'users', label: 'User Management' },
  { view: 'settings', label: 'Settings' },
];
