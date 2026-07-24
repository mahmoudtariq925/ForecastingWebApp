// ============================================================================
// The signed-in user and what they may do. Phase 1 has no authentication, so
// the "session" is a mock user picked via the sidebar switcher and persisted
// locally; Phase 3 replaces `currentUser()` with the Azure AD identity and
// `permissionsFor()` with backend-issued permissions. Everything role-aware
// in the UI goes through this module — components never hardcode role
// checks themselves.
// ============================================================================
import type { Role, User } from '../types';
import { entities, users as seedUsers } from './mockData';
import { loadData, loadUsers, saveData } from '../storage/localStorage';

/** Central permission model derived from the user's role. */
export interface Permissions {
  canViewTreasuryDashboard: boolean;
  canManageUsers: boolean;
  canManageTemplates: boolean;
  canManageCycles: boolean;
  canApproveForecasts: boolean;
  canSubmitForecasts: boolean;
  canViewAllEntities: boolean;
  canReviewComments: boolean;
  canViewConsolidated: boolean;
  canChangeSettings: boolean;
}

const FULL_ACCESS: Permissions = {
  canViewTreasuryDashboard: true,
  canManageUsers: true,
  canManageTemplates: true,
  canManageCycles: true,
  canApproveForecasts: true,
  canSubmitForecasts: true,
  canViewAllEntities: true,
  canReviewComments: true,
  canViewConsolidated: true,
  canChangeSettings: true,
};

const NO_ACCESS: Permissions = {
  canViewTreasuryDashboard: false,
  canManageUsers: false,
  canManageTemplates: false,
  canManageCycles: false,
  canApproveForecasts: false,
  canSubmitForecasts: false,
  canViewAllEntities: false,
  canReviewComments: false,
  canViewConsolidated: false,
  canChangeSettings: false,
};

const ROLE_PERMISSIONS: Record<Role, Permissions> = {
  admin: FULL_ACCESS,
  treasury: FULL_ACCESS,
  approver: { ...NO_ACCESS, canApproveForecasts: true, canSubmitForecasts: true },
  submitter: { ...NO_ACCESS, canSubmitForecasts: true },
};

export function permissionsFor(user: User): Permissions {
  return ROLE_PERMISSIONS[user.role] ?? ROLE_PERMISSIONS.submitter;
}

const CURRENT_USER_KEY = 'currentUserEmail';

/** The signed-in user: the locally persisted switcher choice, falling back
 * to the first admin. */
export function currentUser(): User {
  const users = loadUsers(seedUsers);
  const email = loadData<string | null>(CURRENT_USER_KEY, null);
  const selected = email
    ? users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    : undefined;
  return selected ?? users.find((u) => u.role === 'admin') ?? users[0] ?? seedUsers[0];
}

/** Persist the mock-session choice (dev-only user switcher). */
export function setCurrentUser(email: string): void {
  saveData(CURRENT_USER_KEY, email);
}

/**
 * The entities a user works with. Admin/treasury see all; scoped users get
 * their explicit assignment, falling back to the entities that name them as
 * submitter or approver (covers users stored before the field existed).
 */
export function assignedEntitiesFor(user: User): string[] {
  if (permissionsFor(user).canViewAllEntities) return entities.map((e) => e.name);
  if (user.assignedEntities && user.assignedEntities.length > 0) {
    return user.assignedEntities.filter((name) => entities.some((e) => e.name === name));
  }
  const derived = entities
    .filter((e) => e.submitter === user.name || e.approver === user.name)
    .map((e) => e.name);
  return derived.length > 0 ? derived : [entities[0]?.name].filter(Boolean);
}
