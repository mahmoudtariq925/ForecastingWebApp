// ============================================================================
// Demo workflow seeding.
//
// The demo used to describe its starting state twice: a `status` field frozen
// onto each entity, AND whatever the stored submissions said. The two drifted
// immediately — a forecast could read "approved" on the treasury dashboard and
// "still in draft" to the submitter who owned it, because those two screens
// were reading different copies.
//
// There is now one copy. This module materialises the demo's opening position
// as REAL stored submissions with real statuses (plus the matching approval
// map), once per forecast week. After it runs, every screen in the app answers
// "what is the status of this forecast?" from the same place, and the demo is
// indistinguishable from a week of genuine use.
//
// The live instance seeds nothing: its numbers come from imported workbooks.
// ============================================================================
import type { SubmissionStatus } from '../types';
import { DEMO_DATA } from './dataSource';
import { demoCountries } from './mockData';
import { activeCycle, listCycles } from './cycleService';
import { getOrCreateSubmission, templateForEntity } from './submissionService';
import {
  loadApprovals,
  loadData,
  loadSubmission,
  loadTemplates,
  saveApprovals,
  saveData,
  saveSubmission,
} from '../storage/localStorage';

/**
 * The demo's opening position, one status per country.
 *
 * Chosen so every role has something real to do on a fresh browser: the
 * submitter demo account has a draft to submit, the approver demo account has
 * a decision waiting, and treasury has three countries to chase.
 */
const DEMO_STATUS: Record<string, SubmissionStatus> = {
  Netherlands: 'draft',
  Germany: 'submitted',
  France: 'draft',
  'United Kingdom': 'approved',
  Spain: 'submitted',
  Italy: 'approved',
  Poland: 'draft',
  Belgium: 'submitted',
  Switzerland: 'submitted',
  Austria: 'approved',
  Portugal: 'approved',
};

const seededKey = (week: string) => `demoSeeded:${week}`;

/**
 * Give every closed cycle behind the active one a complete, approved set of
 * forecasts.
 *
 * A closed cycle showing "0 / 11 · €0.0M" reads as a bug rather than as
 * history, and the forecast-vs-forecast overlays had nothing real to draw.
 * Past weeks are always fully approved: that is what "closed" means.
 */
function seedClosedHistory(): void {
  for (const cycle of listCycles()) {
    if (cycle.status !== 'consolidated') continue;
    if (loadData<boolean>(seededKey(cycle.weekKey), false)) continue;
    const templates = loadTemplates();
    const approvals: Record<string, SubmissionStatus> = {};
    for (const country of demoCountries) {
      const template = templateForEntity(templates, country.name);
      if (!template) continue;
      if (!loadSubmission(cycle.weekKey, country.name, template.id)) {
        const sub = getOrCreateSubmission(country.name, cycle.weekKey, template);
        saveSubmission({ ...sub, status: 'approved' });
      }
      approvals[country.name] = 'approved';
    }
    saveApprovals(cycle.id, { ...loadApprovals(cycle.id), ...approvals });
    saveData(seededKey(cycle.weekKey), true);
  }
}

/**
 * Give a forecast week its demo opening position, once.
 *
 * Idempotent and non-destructive: the marker stops it re-running, and an
 * entity that already has a stored submission is left exactly as the user
 * left it. Safe to call on every boot.
 */
export function seedDemoWorkflow(week: string): void {
  if (!DEMO_DATA) return;
  seedClosedHistory();
  if (loadData<boolean>(seededKey(week), false)) return;

  const templates = loadTemplates();
  const approvals: Record<string, SubmissionStatus> = {};

  for (const country of demoCountries) {
    const template = templateForEntity(templates, country.name);
    if (!template) continue;
    const status = DEMO_STATUS[country.name] ?? 'draft';
    // getOrCreateSubmission generates the deterministic demo grid the rest of
    // the app already shows, so seeding changes the status, never the numbers.
    const existing = loadSubmission(week, country.name, template.id);
    const sub = existing ?? getOrCreateSubmission(country.name, week, template);
    if (!existing) saveSubmission({ ...sub, status });
    if (status === 'approved') approvals[country.name] = status;
  }

  const cycleId = activeCycle().id;
  saveApprovals(cycleId, { ...loadApprovals(cycleId), ...approvals });
  saveData(seededKey(week), true);
}
