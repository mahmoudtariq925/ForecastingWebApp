// ============================================================================
// The data access layer for seed/reference data.
//
// EVERY screen that needs the entity list, the cycle list or the seeded user
// list reads it from here — never from mockData directly. This module decides
// per DATA_SOURCE what those reads return:
//
//   static — the demo constants from mockData, exactly as before.
//   live   — everything derives from what the administrator configured:
//            entities from Legal Entity Setup, users from a single bootstrap
//            administrator, the cycle generated for the current week, and
//            totals computed from imported submissions. Nothing is invented.
//
// Phase 2 swaps the live branches for API calls; the static demo keeps
// working unchanged because its branch never leaves this file.
// ============================================================================
import type { Cycle, Entity, LegalEntity, User } from '../types';
import { IS_LIVE } from './dataSource';
import {
  buildLegalEntities,
  cycles as demoCycles,
  entities as demoEntities,
  users as demoUsers,
} from './mockData';
import { currentWeekKey, horizonDates, isoWeekNumber, prevWeekKey } from './periods';
import { listSubmissions, loadLegalEntities, loadUsers } from '../storage/localStorage';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * The live instance boots with one treasury user (identity set at build time
 * via VITE_ADMIN_NAME / VITE_ADMIN_EMAIL) who then creates the real users in
 * User Management. Treasury is the full role, so this single account can
 * configure everything. No demo people, no demo joiners.
 */
function liveBootstrapAdmin(): User {
  return {
    name: import.meta.env.VITE_ADMIN_NAME || 'Administrator',
    email: import.meta.env.VITE_ADMIN_EMAIL || 'admin@example.com',
    team: 'Treasury HQ',
    role: 'treasury',
    status: 'active',
    last: 'Now',
  };
}

/** Seed user list handed to `loadUsers` everywhere. */
export function seedUsers(): User[] {
  return IS_LIVE ? [liveBootstrapAdmin()] : demoUsers;
}

// ---------------------------------------------------------------------------
// Legal entities
// ---------------------------------------------------------------------------

/** Seed for the legal-entity store: demo config, or nothing to start from. */
export function seedLegalEntities(): LegalEntity[] {
  return IS_LIVE ? [] : buildLegalEntities();
}

// ---------------------------------------------------------------------------
// Reporting entities
// ---------------------------------------------------------------------------

/** Total of one entity's stored submissions for a week, in EUR thousands. */
function storedTotal(entity: string, week: string): number {
  return listSubmissions(week)
    .filter((s) => s.entity === entity)
    .reduce(
      (total, s) =>
        total + Object.values(s.values ?? {}).reduce((a, b) => a + (Number(b) || 0), 0),
      0,
    );
}

/**
 * Live entities derive entirely from Legal Entity Setup: names/regions from
 * the configured entities, submitter/approver display names from the
 * responsibility assignments, totals from imported submissions. Status starts
 * 'pending' — workflow state comes from stored submissions and approvals,
 * which `mergedEntityStatus` already prefers over this seed.
 */
function liveEntities(): Entity[] {
  const legal = loadLegalEntities(seedLegalEntities()).filter((e) => e.status === 'active');
  const users = loadUsers(seedUsers());
  const nameOf = (email?: string): string =>
    users.find((u) => u.email.toLowerCase() === (email ?? '').toLowerCase())?.name ?? '—';
  const week = currentWeekKey();
  const prior = prevWeekKey(week);

  return legal.map((e) => {
    const total = storedTotal(e.name, week);
    const prev = storedTotal(e.name, prior);
    return {
      name: e.name,
      region: e.region,
      submitter: nameOf(e.submitters[0]),
      approver: nameOf(e.approvers[0]),
      total,
      delta: prev ? Math.round(((total - prev) / Math.abs(prev)) * 1000) / 10 : 0,
      status: 'pending' as const,
    };
  });
}

/**
 * Demo entities, with their master data taken from Legal Entity Setup.
 *
 * The demo list is seeded from the same constants `buildLegalEntities()` is,
 * so they can be matched by the seeded id. Reading the configured name here
 * is what makes renaming an entity actually show up on the other screens —
 * previously the rename lived only on the Legal Entity Setup table.
 */
function demoEntitiesWithConfig(): Entity[] {
  const configured = new Map(
    loadLegalEntities(buildLegalEntities()).map((e) => [e.id, e]),
  );
  return demoEntities.map((e) => {
    const legal = configured.get(`le-${e.name.toLowerCase().replace(/\s+/g, '-')}`);
    if (!legal) return e;
    return { ...e, name: legal.name, region: legal.region };
  });
}

/** The reporting entities every aggregate screen iterates. */
export function listEntities(): Entity[] {
  return IS_LIVE ? liveEntities() : demoEntitiesWithConfig();
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

/** The live instance has no history: one generated cycle for this week. */
function liveCycles(): Cycle[] {
  const week = currentWeekKey();
  const dates = horizonDates(week);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { month: 'short', day: '2-digit' });
  const expected = loadLegalEntities(seedLegalEntities()).filter(
    (e) => e.status === 'active',
  ).length;
  const stored = listSubmissions(week);
  const submitted = new Set(
    stored.filter((s) => s.status !== 'draft').map((s) => s.entity),
  ).size;
  const totalK = stored.reduce(
    (total, s) =>
      total + Object.values(s.values ?? {}).reduce((a, b) => a + (Number(b) || 0), 0),
    0,
  );

  return [
    {
      id: `CW-${dates[0].getFullYear()}-${String(isoWeekNumber(dates[0])).padStart(2, '0')}`,
      start: fmt(dates[0]),
      closes: `${fmt(dates[4] ?? dates[0])} · 18:00`,
      // 'submitted' marks the ACTIVE cycle (Dashboard picks it as current).
      status: 'submitted',
      subs: `${submitted} / ${Math.max(expected, 1)}`,
      total: Math.round(totalK / 100) / 10, // €k → €m, one decimal
    },
  ];
}

/** Seed cycle list handed to `loadCycles` everywhere. */
export function listCycles(): Cycle[] {
  return IS_LIVE ? liveCycles() : demoCycles;
}
