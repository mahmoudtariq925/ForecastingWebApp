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
import type { RequesterRole, Role, User } from '../types';
import { seedUsers } from './appData';
import { entityNamesFor, listLegalEntities } from './legalEntityService';
import { loadData, loadUsers, saveData } from '../storage/localStorage';

/** Central permission model derived from the user's global role. */
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
  /**
   * Ask a submitter to explain a cell. Distinct from `canReviewComments`
   * (which is the triage screen): an approver judging a forecast needs to
   * ask about a number without also owning the group-wide review queue.
   */
  canRequestCommentary: boolean;
  canViewConsolidated: boolean;
  /** Read forecasts for the entities they are assigned to. */
  canViewForecasts: boolean;
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
  canRequestCommentary: false,
  canViewConsolidated: false,
  canViewForecasts: false,
};

/**
 * Permissions for a role. Treasury is the full role — forecast oversight plus
 * system configuration (users, templates, legal entities, settings); the
 * separate administrator role it absorbed no longer exists.
 */
function permissionsForRole(role: Role): Permissions {
  switch (role) {
    // Global treasury: the complete experience, financial and configuration.
    case 'treasury':
      return {
        canViewTreasuryDashboard: true,
        canViewAdminScreens: true,
        canManageUsers: true,
        canManageSettings: true,
        canManageLegalEntities: true,
        canManageTemplates: true,
        canManageCycles: true,
        canApproveForecasts: true,
        canSubmitForecasts: true,
        canViewAllEntities: true,
        canReviewComments: true,
        canRequestCommentary: true,
        canViewConsolidated: true,
        canViewForecasts: true,
      };
    // Approvers REVIEW forecasts; they never edit or submit them. Granting
    // canSubmitForecasts here put "Save Draft" / "Submit for Approval" on the
    // very forecasts they were meant to be judging.
    case 'approver':
      return {
        ...NO_ACCESS,
        canApproveForecasts: true,
        canRequestCommentary: true,
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

export function permissionsFor(user: User): Permissions {
  return permissionsForRole(user.role);
}

const CURRENT_USER_KEY = 'currentUserEmail';

/** The signed-in user: the locally persisted switcher choice, falling back
 * to the first treasury user (the fullest experience) so a fresh session
 * shows the main app rather than the narrower admin-configuration screens.
 * The fallback is persisted immediately so the session stays with the same
 * person as users are added — creating a treasury user must never silently
 * reassign an anonymous admin session mid-flight. */
export function currentUser(): User {
  const users = loadUsers(seedUsers());
  const email = loadData<string | null>(CURRENT_USER_KEY, null);
  const selected = email
    ? users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    : undefined;
  if (selected) return selected;
  const fallback =
    users.find((u) => u.role === 'treasury') ??
    users[0] ??
    seedUsers()[0];
  if (fallback) saveData(CURRENT_USER_KEY, fallback.email);
  return fallback;
}

/**
 * Which side the signed-in user asks a question from.
 *
 * Both treasury and an approver may ask a submitter to explain a cell, and the
 * submitter needs to know which of them is waiting — so the role is read here,
 * once, rather than inferred from whichever screen the question came off.
 */
export function requesterRoleFor(user: User): RequesterRole {
  return permissionsFor(user).canViewTreasuryDashboard ? 'treasury' : 'approver';
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
