// ============================================================================
// Legal entities: entity master data, the users responsible for each entity
// and the forecast template it submits on.
//
// This module is the single source of truth for "who can do what, WHERE".
// User Management owns the global role (WHAT a user may do) and only READS
// responsibilities from here — nothing stores entity assignments on the user
// object, so removing someone as an approver for an entity immediately
// removes that entity from their responsibilities everywhere.
// ============================================================================
import type { EntityResponsibility, LegalEntity, Role, User } from '../types';
import { buildLegalEntities } from './mockData';
import { loadLegalEntities, saveLegalEntities } from '../storage/localStorage';

/** All configured legal entities (seeded on first use). */
export function listLegalEntities(): LegalEntity[] {
  return loadLegalEntities(buildLegalEntities());
}

/** Persist the full set (callers pass the edited array). */
export function persistLegalEntities(legalEntities: LegalEntity[]): LegalEntity[] {
  saveLegalEntities(legalEntities);
  return legalEntities;
}

/** Insert or update one entity and persist, returning the new set. */
export function upsertLegalEntity(entity: LegalEntity, all: LegalEntity[]): LegalEntity[] {
  const exists = all.some((e) => e.id === entity.id);
  const next = exists ? all.map((e) => (e.id === entity.id ? entity : e)) : [...all, entity];
  return persistLegalEntities(next);
}

/** The global role that may hold a given entity responsibility. */
export const ROLE_FOR_RESPONSIBILITY: Record<EntityResponsibility, Role> = {
  viewer: 'viewer',
  approver: 'approver',
  submitter: 'submitter',
};

/** The entity assignment list backing a responsibility. */
const LIST_KEY: Record<EntityResponsibility, 'viewers' | 'approvers' | 'submitters'> = {
  viewer: 'viewers',
  approver: 'approvers',
  submitter: 'submitters',
};

export function assignmentList(
  entity: LegalEntity,
  responsibility: EntityResponsibility,
): string[] {
  return entity[LIST_KEY[responsibility]] ?? [];
}

/** Add/remove a user for one responsibility on one entity (returns a copy). */
export function withAssignment(
  entity: LegalEntity,
  responsibility: EntityResponsibility,
  email: string,
  assigned: boolean,
): LegalEntity {
  const key = LIST_KEY[responsibility];
  const current = new Set(entity[key] ?? []);
  if (assigned) current.add(email);
  else current.delete(email);
  return { ...entity, [key]: [...current] };
}

/**
 * Users eligible for a responsibility: only active users whose GLOBAL role
 * matches. Admin/treasury are deliberately excluded — their system role
 * already grants visibility, and mixing it with entity duties is exactly the
 * conflation this model avoids.
 */
export function eligibleUsers(users: User[], responsibility: EntityResponsibility): User[] {
  const role = ROLE_FOR_RESPONSIBILITY[responsibility];
  return users.filter((u) => u.role === role && u.status !== 'inactive');
}

/** One entity a user is responsible for, and in what capacity. */
export interface Responsibility {
  entityId: string;
  entityName: string;
  responsibility: EntityResponsibility;
}

/**
 * Everything a user is responsible for, derived live from the entity
 * configuration — never stored on the user. Drives the read-only
 * Responsibilities column in User Management.
 */
export function responsibilitiesFor(
  user: User,
  legalEntities: LegalEntity[] = listLegalEntities(),
): Responsibility[] {
  const email = user.email.toLowerCase();
  const out: Responsibility[] = [];
  for (const entity of legalEntities) {
    (['submitter', 'approver', 'viewer'] as EntityResponsibility[]).forEach((responsibility) => {
      const holders = assignmentList(entity, responsibility).map((e) => e.toLowerCase());
      if (holders.includes(email)) {
        out.push({ entityId: entity.id, entityName: entity.name, responsibility });
      }
    });
  }
  return out;
}

/**
 * The entity names a user works with, from the entity configuration. Used to
 * scope the analyst screens; admin/treasury bypass this via permissions.
 */
export function entityNamesFor(
  user: User,
  legalEntities: LegalEntity[] = listLegalEntities(),
): string[] {
  return [...new Set(responsibilitiesFor(user, legalEntities).map((r) => r.entityName))];
}

/** Compact label for the Responsibilities column, e.g. "Approver: NL, DE". */
export function responsibilitySummary(responsibilities: Responsibility[]): string {
  if (responsibilities.length === 0) return '—';
  const byKind = new Map<EntityResponsibility, string[]>();
  for (const r of responsibilities) {
    if (!byKind.has(r.responsibility)) byKind.set(r.responsibility, []);
    byKind.get(r.responsibility)!.push(r.entityName);
  }
  return [...byKind.entries()]
    .map(([kind, names]) => `${kind[0].toUpperCase()}${kind.slice(1)}: ${names.join(', ')}`)
    .join(' · ');
}
