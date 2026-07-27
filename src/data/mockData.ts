// ============================================================================
// All dummy / seed data lives here. Swapping to a real backend later means
// replacing these constants (and the storage layer) rather than touching the
// screen components.
// ============================================================================
import type {
  Cycle,
  Entity,
  ForecastTemplate,
  LegalEntity,
  LineItemConfig,
  TemplateCategory,
  User,
} from '../types';
import { horizonDates } from './periods';

export const entities: Entity[] = [
  { name: 'Netherlands', region: 'Western Europe', submitter: 'Jan de Vries', approver: 'Pieter Bakker', total: 24350, delta: 2.1, status: 'approved' },
  { name: 'Germany', region: 'DACH', submitter: 'Anna Müller', approver: 'Klaus Weber', total: 31200, delta: -1.4, status: 'submitted' },
  { name: 'France', region: 'Western Europe', submitter: 'Marie Dubois', approver: 'Pierre Martin', total: 18900, delta: 4.7, status: 'pending' },
  { name: 'United Kingdom', region: 'UK & Ireland', submitter: 'James Patel', approver: "Sarah O'Brien", total: 22100, delta: 0.3, status: 'approved' },
  { name: 'Spain', region: 'Southern Europe', submitter: 'Carlos Ruiz', approver: 'Elena García', total: 12400, delta: -2.8, status: 'submitted' },
  { name: 'Italy', region: 'Southern Europe', submitter: 'Marco Rossi', approver: 'Giulia Conti', total: 9200, delta: 1.1, status: 'approved' },
  { name: 'Poland', region: 'Central Europe', submitter: 'Tomasz Nowak', approver: 'Anna Wójcik', total: 7600, delta: -0.9, status: 'pending' },
  { name: 'Belgium', region: 'Western Europe', submitter: 'Sophie Janssens', approver: 'Luc De Smet', total: 6450, delta: 3.2, status: 'approved' },
  { name: 'Switzerland', region: 'DACH', submitter: 'Hans Müller', approver: 'Beat Wyss', total: 4200, delta: 0.0, status: 'submitted' },
  { name: 'Austria', region: 'DACH', submitter: 'Lukas Huber', approver: 'Maria Gruber', total: 2800, delta: 1.8, status: 'approved' },
  { name: 'Portugal', region: 'Southern Europe', submitter: 'João Silva', approver: 'Ana Costa', total: 1900, delta: -3.4, status: 'pending' },
];

/** Reporting currency per country (used by the legal-entity seed). */
const CURRENCIES: Record<string, string> = {
  'United Kingdom': 'GBP',
  Poland: 'PLN',
  Switzerland: 'CHF',
};

/**
 * Seeded entity responsibilities, keyed by entity name. Only users that
 * exist in `users` with the matching global role are seeded; every other
 * entity starts unassigned and is configured in Legal Entity Setup.
 */
const SEED_ASSIGNMENTS: Record<
  string,
  { viewers?: string[]; approvers?: string[]; submitters?: string[] }
> = {
  Netherlands: {
    submitters: ['jan.devries@contoso.com', 'nina.brandt@contoso.com'],
    approvers: ['pieter.bakker@contoso.com'],
    viewers: ['tom.whitfield@contoso.com', 'priya.raman@contoso.com'],
  },
  Germany: {
    submitters: ['anna.mueller@contoso.com'],
    approvers: ['klaus.weber@contoso.com', 'omar.haddad@contoso.com'],
    viewers: ['tom.whitfield@contoso.com', 'priya.raman@contoso.com'],
  },
  'United Kingdom': { approvers: ['sarah.obrien@contoso.com'] },
  Switzerland: { approvers: ['klaus.weber@contoso.com'] },
};

/**
 * The configured legal entities, derived from the reporting entities above so
 * the two never drift. This is the source of truth for entity ↔ user
 * responsibilities and the per-entity forecast template.
 */
export function buildLegalEntities(): LegalEntity[] {
  return entities.map((e) => {
    const seeded = SEED_ASSIGNMENTS[e.name] ?? {};
    return {
      id: `le-${e.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: e.name,
      country: e.name,
      region: e.region,
      currency: CURRENCIES[e.name] ?? 'EUR',
      status: 'active' as const,
      viewers: seeded.viewers ?? [],
      approvers: seeded.approvers ?? [],
      submitters: seeded.submitters ?? [],
      forecastTemplateId: STANDARD_TEMPLATE_ID,
    };
  });
}

export const cycles: Cycle[] = [
  { id: 'CW-2026-21', start: 'May 18', closes: 'May 22 · 18:00', status: 'submitted', subs: '14 / 18', total: 184.2 },
  { id: 'CW-2026-20', start: 'May 11', closes: 'May 15 · 18:00', status: 'consolidated', subs: '18 / 18', total: 178.4 },
  { id: 'CW-2026-19', start: 'May 04', closes: 'May 08 · 18:00', status: 'consolidated', subs: '18 / 18', total: 181.0 },
  { id: 'CW-2026-18', start: 'Apr 27', closes: 'May 01 · 18:00', status: 'consolidated', subs: '17 / 17', total: 175.8 },
  { id: 'CW-2026-17', start: 'Apr 20', closes: 'Apr 24 · 18:00', status: 'consolidated', subs: '17 / 17', total: 172.1 },
];

/**
 * Managed users: identity + GLOBAL role only. Which entities they are
 * responsible for is configured in Legal Entity Setup (see `legalEntities`
 * below) and derived from there wherever it is displayed.
 */
export const users: User[] = [
  { name: 'Maja Kowalska', email: 'maja.kowalska@contoso.com', team: 'Treasury HQ', role: 'admin', status: 'active', last: 'Now' },
  { name: 'Jan de Vries', email: 'jan.devries@contoso.com', team: 'NL Operations', role: 'submitter', status: 'active', last: '2h ago' },
  { name: 'Pieter Bakker', email: 'pieter.bakker@contoso.com', team: 'NL Operations', role: 'approver', status: 'active', last: '1h ago' },
  { name: 'Anna Müller', email: 'anna.mueller@contoso.com', team: 'DE Sales', role: 'submitter', status: 'active', last: '4h ago' },
  { name: 'Klaus Weber', email: 'klaus.weber@contoso.com', team: 'DE Sales', role: 'approver', status: 'active', last: '3h ago' },
  { name: "Sarah O'Brien", email: 'sarah.obrien@contoso.com', team: 'UK Services', role: 'approver', status: 'active', last: 'Yesterday' },
  { name: 'Linda Chen', email: 'linda.chen@contoso.com', team: 'Treasury HQ', role: 'treasury', status: 'active', last: '20m ago' },
  { name: 'Tom Whitfield', email: 'tom.whitfield@contoso.com', team: 'Group Finance', role: 'viewer', status: 'active', last: '1d ago' },
  { name: 'Sofia Almeida', email: 'sofia.almeida@contoso.com', team: 'Group Finance', role: 'viewer', status: 'inactive', last: '3w ago' },

  // ---------------------------------------------------------------------
  // Brand-new joiners, one per role. They have never signed in, so picking
  // one from the user switcher always runs that role's guided walkthrough
  // — the quickest way to review every tour end to end.
  // ---------------------------------------------------------------------
  { name: 'Nina Brandt', email: 'nina.brandt@contoso.com', team: 'NL Operations', role: 'submitter', status: 'active', last: 'Never', alwaysTour: true },
  { name: 'Omar Haddad', email: 'omar.haddad@contoso.com', team: 'DE Sales', role: 'approver', status: 'active', last: 'Never', alwaysTour: true },
  { name: 'Priya Raman', email: 'priya.raman@contoso.com', team: 'Group Finance', role: 'viewer', status: 'active', last: 'Never', alwaysTour: true },
  { name: 'Rasmus Nilsen', email: 'rasmus.nilsen@contoso.com', team: 'Treasury HQ', role: 'treasury', status: 'active', last: 'Never', alwaysTour: true },
  { name: 'Elena Fischer', email: 'elena.fischer@contoso.com', team: 'Treasury HQ', role: 'admin', status: 'active', last: 'Never', alwaysTour: true },
];

// ---------------------------------------------------------------------------
// The seeded default template — derived from the standard treasury workbook
// (samples/CF_Forecast_Template.xlsx): categories grouped under bands, one
// row per working day, plus Comments / Total / Running total and a Starting
// balance. It lives in the template store alongside user-uploaded ones.
// ---------------------------------------------------------------------------
export const STANDARD_TEMPLATE_ID = 'tpl-cf-standard';

export const standardCategories: TemplateCategory[] = [
  { label: 'Receivables', group: 'Trade AR & AP' },
  { label: 'Payables', group: 'Trade AR & AP' },
  { label: 'Corporate Income', group: 'Taxes' },
  { label: 'Other Taxes', group: 'Taxes' },
  { label: 'Salaries', group: 'Payroll' },
  { label: 'Social Securities', group: 'Payroll' },
  { label: 'CAPEX' },
  { label: 'IC Inflows - NL', group: 'IC Settlements' },
  { label: 'IC Outflows - NL', group: 'IC Settlements' },
  { label: 'IC Inflows', group: 'IC Settlements' },
  { label: 'IC Outflows', group: 'IC Settlements' },
  { label: 'Other' },
];

export function buildStandardTemplate(): ForecastTemplate {
  return {
    id: STANDARD_TEMPLATE_ID,
    name: 'CF Forecast (Standard)',
    fileName: 'CF_Forecast_Template.xlsx',
    uploadedAt: '2026-07-01T09:00:00.000Z',
    uploadedBy: 'Maja Kowalska',
    assignedEntities: entities.map((e) => e.name),
    layout: 'grouped',
    categories: standardCategories,
  };
}

/**
 * Demo-value generation config per known category label (value ranges,
 * paydays, tax days). Only labels present here get seeded demo values —
 * categories of uploaded templates start blank. Sign convention: inflows
 * positive, outflows negative.
 */
export const lineItemConfigs: LineItemConfig[] = [
  { label: 'Receivables', baseMin: 1800, baseMax: 2400 },
  { label: 'Payables', baseMin: -1900, baseMax: -1200 },
  { label: 'Corporate Income', baseMin: -600, baseMax: 0, taxday: true },
  { label: 'Other Taxes', baseMin: -200, baseMax: 0 },
  { label: 'Salaries', baseMin: -800, baseMax: -300, payday: true },
  { label: 'Social Securities', baseMin: -300, baseMax: -80, payday: true },
  { label: 'CAPEX', baseMin: -300, baseMax: 0 },
  { label: 'IC Inflows - NL', baseMin: 200, baseMax: 600 },
  { label: 'IC Outflows - NL', baseMin: -400, baseMax: 0 },
  { label: 'IC Inflows', baseMin: 100, baseMax: 400 },
  { label: 'IC Outflows', baseMin: -300, baseMax: 0 },
  { label: 'Other', baseMin: -100, baseMax: 150 },
];

/**
 * Small deterministic PRNG (mulberry32). Using a seed keeps the generated
 * forecast values stable across reloads so persistence behaves predictably —
 * the original prototype used Math.random and regenerated on every render.
 */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Demo value for one cell (payday on the 15th/28th, tax day on the 22nd). */
function genValue(config: LineItemConfig, date: Date, rand: () => number): number {
  if (config.payday && date.getDate() !== 28 && date.getDate() !== 15) return 0;
  if (config.taxday && date.getDate() !== 22) return 0;
  const range = config.baseMax - config.baseMin;
  return Math.round(config.baseMin + rand() * range);
}

/**
 * Generate demo cell values for a template + forecast week. Categories whose
 * label has a generation config get seeded values; unknown labels stay 0
 * (blank). Returns a map keyed `${catIdx}-${dayIdx}` plus flagged keys.
 */
export function generateGridValues(
  categories: TemplateCategory[],
  weekKey: string,
  seed: number,
  flagSome: boolean,
): { values: Record<string, number>; flags: string[] } {
  const rand = mulberry32(seed);
  const dates = horizonDates(weekKey);
  const values: Record<string, number> = {};
  const flags: string[] = [];

  categories.forEach((cat, catIdx) => {
    const config = lineItemConfigs.find((c) => c.label === cat.label);
    dates.forEach((date, i) => {
      const val = config ? genValue(config, date, rand) : 0;
      values[`${catIdx}-${i}`] = val;
      if (flagSome && config && rand() < 0.04) flags.push(`${catIdx}-${i}`);
    });
  });

  return { values, flags };
}

/** Deterministic demo opening balance for an entity, EUR thousands. */
export function startingBalanceFor(entity: string): number {
  return 5000 + (seedFor(entity) % 15000);
}

/** Stable numeric seed derived from any string (entity, week, …). */
export function seedFor(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
