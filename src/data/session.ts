// ============================================================================
// The signed-in user and what they may do. Phase 1 has no authentication, so
// the "session" is a mock user picked via the sidebar switcher and persisted
// locally; Phase 3 replaces `currentUser()` with the Azure AD identity and
// `permissionsFor()` with backend-issued permissions. Everything role-aware
// in the UI goes through this module — components never hardcode role
// checks themselves.
//
// Two separate concepts, deliberately not mixed:
//   GLOBAL ROLE (here)            — WHAT a user may do.
//   LEGAL ENTITY SETUP (service)  — WHERE they may do it.
// ============================================================================
import type { Role, Settings, User } from '../types';
import { users as seedUsers } from './mockData';
import { entityNamesFor, listLegalEntities } from './legalEntityService';
import { loadData, loadSettings, loadUsers, saveData } from '../storage/localStorage';
import { DEFAULT_SETTINGS } from '../components/settings/defaults';

/** Central permission model derived from the user's role (+ admin settings). */
export interface Permissions {
  canViewTreasuryDashboard: boolean;
  /** Read the configuration screens (Users / Settings / Legal Entity Setup). */
  canViewAdminScreens: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canManageLegalEntities: boolean;
  canManageTemplates: boolean;
  canManageCycles: boolean;
  canApproveForecasts: boolean;
  canSubmitForecasts: boolean;
  canViewAllEntities: boolean;
  canReviewComments: boolean;
  canViewConsolidated: boolean;
  /** Read forecasts for the entities they are assigned to. */
  canViewForecasts: boolean;
  /** Only an admin may flip the "Treasury can manage" setting. */
  canChangeTreasuryToggle: boolean;
}

const NO_ACCESS: Permissions = {
  canViewTreasuryDashboard: false,
  canViewAdminScreens: false,
  canManageUsers: false,
  canManageSettings: false,
  canManageLegalEntities: false,
  canManageTemplates: false,
  canManageCycles: false,
  canApproveForecasts: false,
  canSubmitForecasts: false,
  canViewAllEntities: false,
  canReviewComments: false,
  canViewConsolidated: false,
  canViewForecasts: false,
  canChangeTreasuryToggle: false,
};

/**
 * Permissions for a role. `treasuryManagementEnabled` is the admin setting
 * that decides whether Treasury may modify the configuration screens or only
 * view them.
 */
function permissionsForRole(role: Role, treasuryManagementEnabled: boolean): Permissions {
  switch (role) {
    // Full system administrator: configuration only, no forecast workflow.
    case 'admin':
      return {
        ...NO_ACCESS,
        canViewAdminScreens: true,
        canManageUsers: true,
        canManageSettings: true,
        canManageLegalEntities: true,
        canManageTemplates: true,
        canViewAllEntities: true,
        canChangeTreasuryToggle: true,
      };
    // Global treasury: the full financial experience; management of the
    // configuration screens is gated on the admin setting.
    case 'treasury':
      return {
        ...NO_ACCESS,
        canViewTreasuryDashboard: true,
        canViewAdminScreens: true,
        canManageUsers: treasuryManagementEnabled,
        canManageSettings: treasuryManagementEnabled,
        canManageLegalEntities: treasuryManagementEnabled,
        canManageTemplates: treasuryManagementEnabled,
        canManageCycles: true,
        canApproveForecasts: true,
        canSubmitForecasts: true,
        canViewAllEntities: true,
        canReviewComments: true,
        canViewConsolidated: true,
        canViewForecasts: true,
      };
    case 'approver':
      return {
        ...NO_ACCESS,
        canApproveForecasts: true,
        canSubmitForecasts: true,
        canViewForecasts: true,
      };
    case 'submitter':
      return { ...NO_ACCESS, canSubmitForecasts: true, canViewForecasts: true };
    // Read-only forecast access for assigned entities.
    case 'viewer':
      return { ...NO_ACCESS, canViewForecasts: true };
    default:
      return NO_ACCESS;
  }
}

export function permissionsFor(user: User, settings?: Settings): Permissions {
  const resolved = settings ?? loadSettings(DEFAULT_SETTINGS);
  return permissionsForRole(user.role, resolved.treasuryManagementEnabled === true);
}

const CURRENT_USER_KEY = 'currentUserEmail';

/** The signed-in user: the locally persisted switcher choice, falling back
 * to the first treasury user (the fullest experience) so a fresh session
 * shows the main app rather than the narrower admin-configuration screens. */
export function currentUser(): User {
  const users = loadUsers(seedUsers);
  const email = loadData<string | null>(CURRENT_USER_KEY, null);
  const selected = email
    ? users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    : undefined;
  return (
    selected ??
    users.find((u) => u.role === 'treasury') ??
    users.find((u) => u.role === 'admin') ??
    users[0] ??
    seedUsers[0]
  );
}

/** Persist the mock-session choice (dev-only user switcher). */
export function setCurrentUser(email: string): void {
  saveData(CURRENT_USER_KEY, email);
}

/**
 * The entities a user works with. Admin/treasury see all (their global role
 * grants organisation-wide visibility); everyone else gets exactly the
 * entities Legal Entity Setup assigns them — no entity data on the user.
 */
export function assignedEntitiesFor(user: User): string[] {
  if (permissionsFor(user).canViewAllEntities) {
    return listLegalEntities()
      .filter((e) => e.status === 'active')
      .map((e) => e.name);
  }
  return entityNamesFor(user);
}
