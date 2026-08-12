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
import type { Entity, LegalEntity, User } from '../types';
import { IS_LIVE } from './dataSource';
import { buildLegalEntities, users as demoUsers } from './mockData';
import { loadLegalEntities, loadUsers } from '../storage/localStorage';

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

/**
 * The reporting entities every aggregate screen iterates.
 *
 * Derived entirely from Legal Entity Setup — names and regions from the
 * configured entities, submitter/approver display names resolved against User
 * Management. Demo and live differ only in what Legal Entity Setup is seeded
 * with, so there is a single implementation and no second list of people to
 * fall out of step with the first.
 *
 * Figures and workflow status are deliberately absent: those belong to the
 * stored submission, and every screen reads them from there.
 */
export function listEntities(): Entity[] {
  const legal = loadLegalEntities(seedLegalEntities()).filter((e) => e.status === 'active');
  const users = loadUsers(seedUsers());
  const nameOf = (email?: string): string =>
    users.find((u) => u.email.toLowerCase() === (email ?? '').toLowerCase())?.name ?? '—';

  return legal.map((e) => ({
    name: e.name,
    region: e.region,
    submitter: nameOf(e.submitters[0]),
    approver: nameOf(e.approvers[0]),
  }));
}
