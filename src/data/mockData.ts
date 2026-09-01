// ============================================================================
// All dummy / seed data lives here. Swapping to a real backend later means
// replacing these constants (and the storage layer) rather than touching the
// screen components.
// ============================================================================
import type {
  ForecastTemplate,
  LegalEntity,
  LineItemConfig,
  TemplateCategory,
  User,
} from '../types';
import { horizonDates } from './periods';

/**
 * The demo countries: identity and reporting structure only.
 *
 * Deliberately no submitter, approver, total or status. Those used to live
 * here as a second, frozen copy of information the app already holds, which is
 * how the Approvals screen came to show €31,200k for a forecast the dashboard
 * totalled at €11,988k, and how forecasts were shown as submitted by people
 * who did not exist in User Management. Names now come from Legal Entity
 * Setup, figures and status from the stored submission.
 */
export interface DemoCountry {
  name: string;
  region: string;
}

export const demoCountries: DemoCountry[] = [
  { name: 'Netherlands', region: 'Western Europe' },
  { name: 'Germany', region: 'DACH' },
  { name: 'France', region: 'Western Europe' },
  { name: 'United Kingdom', region: 'UK & Ireland' },
  { name: 'Spain', region: 'Southern Europe' },
  { name: 'Italy', region: 'Southern Europe' },
  { name: 'Poland', region: 'Central Europe' },
  { name: 'Belgium', region: 'Western Europe' },
  { name: 'Switzerland', region: 'DACH' },
  { name: 'Austria', region: 'DACH' },
  { name: 'Portugal', region: 'Southern Europe' },
];

/** Reporting currency per country (used by the legal-entity seed). */
const CURRENCIES: Record<string, string> = {
  'United Kingdom': 'GBP',
  Poland: 'PLN',
  Switzerland: 'CHF',
};

/**
 * Seeded entity responsibilities, keyed by entity name.
 *
 * EVERY entity is assigned, and every email here exists in `users` below with
 * the matching global role — the two lists are asserted against each other by
 * `buildLegalEntities`, so a name can never appear on a forecast without a
 * corresponding account in User Management.
 */
const SEED_ASSIGNMENTS: Record<
  string,
  { viewers?: string[]; approvers?: string[]; submitters?: string[] }
> = (() => {
  /**
   * Three regions, each with one submitter and one approver, covering all
   * eleven countries between them.
   *
   * There used to be an account per country — eleven submitters and ten
   * approvers whose names appeared once each. That is a long User Management
   * list to scroll and a lot of people to introduce for a demo, and it hid the
   * thing worth showing: one approver holding several countries' forecasts.
   */
  const REGIONS: { submitter: string; approver: string; countries: string[] }[] = [
    {
      submitter: 'jan.devries@contoso.com',
      approver: 'pieter.bakker@contoso.com',
      countries: ['Netherlands', 'Belgium', 'United Kingdom'],
    },
    {
      submitter: 'anna.mueller@contoso.com',
      approver: 'klaus.weber@contoso.com',
      countries: ['Germany', 'Switzerland', 'Austria', 'Poland'],
    },
    {
      submitter: 'marie.dubois@contoso.com',
      approver: 'elena.garcia@contoso.com',
      countries: ['France', 'Spain', 'Italy', 'Portugal'],
    },
  ];
  // Group Finance reads everything, so the viewers go on every entity.
  const VIEWERS = ['tom.whitfield@contoso.com', 'sofia.almeida@contoso.com'];
  const out: Record<string, { viewers?: string[]; approvers?: string[]; submitters?: string[] }> =
    {};
  for (const r of REGIONS) {
    for (const country of r.countries) {
      out[country] = {
        submitters: [r.submitter],
        approvers: [r.approver],
        viewers: VIEWERS,
      };
    }
  }
  return out;
})();

/**
 * The configured legal entities, derived from the reporting entities above so
 * the two never drift. This is the source of truth for entity ↔ user
 * responsibilities and the per-entity forecast template.
 */
export function buildLegalEntities(): LegalEntity[] {
  return demoCountries.map((e) => {
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

/**
 * Managed users: identity + GLOBAL role only. Which entities they are
 * responsible for is configured in Legal Entity Setup (see `legalEntities`
 * below) and derived from there wherever it is displayed.
 *
 * Every submitter and approver named in `SEED_ASSIGNMENTS` has an account
 * here. They used to be free text on the entity list, so the Approvals queue
 * and the cycle-progress modal credited forecasts to a dozen people User
 * Management had never heard of.
 */
export const users: User[] = [
  { name: 'Maja Kowalska', email: 'maja.kowalska@contoso.com', team: 'Treasury HQ', role: 'treasury', status: 'active', last: 'Now' },
  { name: 'Linda Chen', email: 'linda.chen@contoso.com', team: 'Treasury HQ', role: 'treasury', status: 'active', last: '20m ago' },

  // Regional submitters. One person files for several countries, which is how
  // a shared service centre actually works — and it keeps the roster to people
  // you can name rather than one account per flag.
  { name: 'Jan de Vries', email: 'jan.devries@contoso.com', team: 'Benelux & UK', role: 'submitter', status: 'active', last: '2h ago' },
  { name: 'Anna Müller', email: 'anna.mueller@contoso.com', team: 'DACH & CEE', role: 'submitter', status: 'active', last: '4h ago' },
  { name: 'Marie Dubois', email: 'marie.dubois@contoso.com', team: 'Southern Europe', role: 'submitter', status: 'active', last: '3h ago' },

  // Regional approvers, each covering the same region as a submitter above.
  { name: 'Pieter Bakker', email: 'pieter.bakker@contoso.com', team: 'Benelux & UK', role: 'approver', status: 'active', last: '1h ago' },
  { name: 'Klaus Weber', email: 'klaus.weber@contoso.com', team: 'DACH & CEE', role: 'approver', status: 'active', last: '3h ago' },
  { name: 'Elena García', email: 'elena.garcia@contoso.com', team: 'Southern Europe', role: 'approver', status: 'active', last: '10h ago' },

  { name: 'Tom Whitfield', email: 'tom.whitfield@contoso.com', team: 'Group Finance', role: 'viewer', status: 'active', last: '1d ago' },
  { name: 'Sofia Almeida', email: 'sofia.almeida@contoso.com', team: 'Group Finance', role: 'viewer', status: 'inactive', last: '3w ago' },
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
  // An intercompany SECTION: the rows a submitter adds under it name a group
  // company, and each amount appears in that company's own forecast. The two
  // lines are the section's own totals in and out — a counterparty never
  // belongs in a template label ("IC Inflows - NL" made one country's
  // relationship part of every country's template), it belongs on the row the
  // submitter adds.
  { label: 'IC Inflows', group: 'IC Settlements', intercompany: true },
  { label: 'IC Outflows', group: 'IC Settlements', intercompany: true },
  { label: 'Other' },
];

export function buildStandardTemplate(): ForecastTemplate {
  return {
    id: STANDARD_TEMPLATE_ID,
    name: 'CF Forecast (Standard)',
    fileName: 'CF_Forecast_Template.xlsx',
    uploadedAt: '2026-07-01T09:00:00.000Z',
    uploadedBy: 'Maja Kowalska',
    assignedEntities: demoCountries.map((e) => e.name),
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

/** Deterministic 0..1 drawn from any string — stable across reloads. */
function rand01(key: string): number {
  return mulberry32(seedFor(key))();
}

const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * The expectation for one cell: what this entity thinks that line item does on
 * that CALENDAR DATE, independent of which cycle is looking at it.
 *
 * Keyed by the date rather than by the cycle because a rolling forecast is a
 * view of the same future from a week closer to it. Drawing every cell afresh
 * per week made consecutive forecasts unrelated, so a 15% threshold flagged
 * three quarters of the grid and none of it meant anything.
 */
function baseValue(config: LineItemConfig, date: Date, entity: string): number {
  if (config.payday && date.getDate() !== 28 && date.getDate() !== 15) return 0;
  if (config.taxday && date.getDate() !== 22) return 0;
  const range = config.baseMax - config.baseMin;
  return config.baseMin + rand01(`${entity}:${config.label}:${dateKey(date)}`) * range;
}

/** How much a cycle's view of a date wanders from the base, either way. */
const DRIFT = 0.06;
/** Deliberate revisions per forecast — the cells actually worth asking about. */
const REVISIONS = 3;

/** The cells this cycle revised, as `${catIdx}-${dayIdx}` keys. */
function revisedCells(
  categories: TemplateCategory[],
  entity: string,
  weekKey: string,
  days: number,
): Map<string, number> {
  const rand = mulberry32(seedFor(`${entity}:${weekKey}:revisions`));
  // Only line items the demo actually fills, so a revision always lands on a
  // number somebody can see.
  const fillable = categories
    .map((c, i) => (lineItemConfigs.some((cfg) => cfg.label === c.label) ? i : -1))
    .filter((i) => i >= 0);
  const out = new Map<string, number>();
  if (fillable.length === 0 || days === 0) return out;
  for (let n = 0; n < REVISIONS; n++) {
    const catIdx = fillable[Math.floor(rand() * fillable.length)];
    const dayIdx = Math.floor(rand() * days);
    // Half again to two and a half times: unmistakably past any sane
    // threshold, which is what makes it worth a question.
    out.set(`${catIdx}-${dayIdx}`, 1.5 + rand());
  }
  return out;
}

/**
 * Generate demo cell values for a template + forecast week. Categories whose
 * label has a generation config get seeded values; unknown labels stay 0
 * (blank). Returns a map keyed `${catIdx}-${dayIdx}`.
 *
 * Values only, and values that behave like a rolling forecast: the same date
 * carries the same expectation from one cycle to the next, give or take a few
 * percent, apart from a handful of genuine revisions. Flags are then derived
 * from the numbers by the rule the live grid uses (see `buildSubmission`) —
 * they used to be sprinkled in here at random, four percent of cells whatever
 * the numbers did, so the guided flow spotlit a −7.9% move against a 15%
 * threshold and called it a variance.
 */
export function generateGridValues(
  categories: TemplateCategory[],
  weekKey: string,
  entity: string,
): { values: Record<string, number> } {
  const dates = horizonDates(weekKey);
  const revised = revisedCells(categories, entity, weekKey, dates.length);
  const values: Record<string, number> = {};

  categories.forEach((cat, catIdx) => {
    const config = lineItemConfigs.find((c) => c.label === cat.label);
    dates.forEach((date, i) => {
      if (!config) {
        values[`${catIdx}-${i}`] = 0;
        return;
      }
      const base = baseValue(config, date, entity);
      // This cycle's read on that date: a few percent either side of the
      // expectation, and occasionally a real revision.
      const drift =
        1 + (rand01(`${entity}:${weekKey}:${cat.label}:${dateKey(date)}`) - 0.5) * 2 * DRIFT;
      const revision = revised.get(`${catIdx}-${i}`) ?? 1;
      values[`${catIdx}-${i}`] = Math.round(base * drift * revision);
    });
  });

  return { values };
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
