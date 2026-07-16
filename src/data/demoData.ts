// ============================================================================
// Demo-value generation ONLY. All business data (entities, users, cycles,
// templates, settings, variances, submissions) lives behind the API — this
// module just seeds plausible numbers into a brand-new submission grid so
// the demo isn't empty, after which the generated values are persisted
// through the backend like any user input.
// ============================================================================
import type { LineItemConfig, TemplateCategory } from '../types';
import { horizonDates } from './periods';

/** Id of the seeded standard template (created by the server seed). */
export const STANDARD_TEMPLATE_ID = 'tpl-cf-standard';

/**
 * Demo-value generation config per known category label (value ranges,
 * paydays, tax days). Only labels present here get seeded demo values —
 * categories of uploaded templates start blank. Sign convention: inflows
 * positive, outflows negative.
 */
const lineItemConfigs: LineItemConfig[] = [
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
 * forecast values stable so persistence behaves predictably.
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
