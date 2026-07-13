// ============================================================================
// All dummy / seed data lives here. Swapping to a real backend later means
// replacing these constants (and the storage layer) rather than touching the
// screen components.
// ============================================================================
import type { Cycle, Entity, LineItem, User, Variance } from '../types';

export const entities: Entity[] = [
  { name: 'Netherlands', submitter: 'Jan de Vries', approver: 'Pieter Bakker', total: 24350, delta: 2.1, status: 'approved' },
  { name: 'Germany', submitter: 'Anna Müller', approver: 'Klaus Weber', total: 31200, delta: -1.4, status: 'submitted' },
  { name: 'France', submitter: 'Marie Dubois', approver: 'Pierre Martin', total: 18900, delta: 4.7, status: 'pending' },
  { name: 'United Kingdom', submitter: 'James Patel', approver: "Sarah O'Brien", total: 22100, delta: 0.3, status: 'approved' },
  { name: 'Spain', submitter: 'Carlos Ruiz', approver: 'Elena García', total: 12400, delta: -2.8, status: 'submitted' },
  { name: 'Italy', submitter: 'Marco Rossi', approver: 'Giulia Conti', total: 9200, delta: 1.1, status: 'approved' },
  { name: 'Poland', submitter: 'Tomasz Nowak', approver: 'Anna Wójcik', total: 7600, delta: -0.9, status: 'pending' },
  { name: 'Belgium', submitter: 'Sophie Janssens', approver: 'Luc De Smet', total: 6450, delta: 3.2, status: 'approved' },
  { name: 'Switzerland', submitter: 'Hans Müller', approver: 'Beat Wyss', total: 4200, delta: 0.0, status: 'submitted' },
  { name: 'Austria', submitter: 'Lukas Huber', approver: 'Maria Gruber', total: 2800, delta: 1.8, status: 'approved' },
  { name: 'Portugal', submitter: 'João Silva', approver: 'Ana Costa', total: 1900, delta: -3.4, status: 'pending' },
];

export const cycles: Cycle[] = [
  { id: 'CW-2026-21', start: 'May 18', closes: 'May 22 · 18:00', status: 'submitted', subs: '14 / 18', total: 184.2 },
  { id: 'CW-2026-20', start: 'May 11', closes: 'May 15 · 18:00', status: 'consolidated', subs: '18 / 18', total: 178.4 },
  { id: 'CW-2026-19', start: 'May 04', closes: 'May 08 · 18:00', status: 'consolidated', subs: '18 / 18', total: 181.0 },
  { id: 'CW-2026-18', start: 'Apr 27', closes: 'May 01 · 18:00', status: 'consolidated', subs: '17 / 17', total: 175.8 },
  { id: 'CW-2026-17', start: 'Apr 20', closes: 'Apr 24 · 18:00', status: 'consolidated', subs: '17 / 17', total: 172.1 },
];

export const users: User[] = [
  { name: 'Maja Kowalska', email: 'maja.kowalska@contoso.com', team: 'Treasury HQ', role: 'admin', scope: 'All entities', last: 'Now' },
  { name: 'Jan de Vries', email: 'jan.devries@contoso.com', team: 'NL Operations', role: 'submitter', scope: '—', last: '2h ago' },
  { name: 'Pieter Bakker', email: 'pieter.bakker@contoso.com', team: 'NL Operations', role: 'approver', scope: 'NL Operations', last: '1h ago' },
  { name: 'Anna Müller', email: 'anna.mueller@contoso.com', team: 'DE Sales', role: 'submitter', scope: '—', last: '4h ago' },
  { name: 'Klaus Weber', email: 'klaus.weber@contoso.com', team: 'DE Sales', role: 'approver', scope: 'DE Sales, DE Manufacturing', last: '3h ago' },
  { name: "Sarah O'Brien", email: 'sarah.obrien@contoso.com', team: 'UK Services', role: 'approver', scope: 'UK Services, UK Support', last: 'Yesterday' },
  { name: 'Linda Chen', email: 'linda.chen@contoso.com', team: 'Treasury HQ', role: 'treasury', scope: 'All entities', last: '20m ago' },
];

export const variances: Variance[] = [
  { ent: 'NL Operations', cat: 'Customer Receipts', day: 'Day 14', prior: 2150, current: 2883, comment: 'Large invoice — Acme Corp paid early' },
  { ent: 'DE Sales', cat: 'Supplier Payments', day: 'Day 8', prior: -1820, current: -2540, comment: 'New equipment delivery moved forward' },
  { ent: 'US Corporate', cat: 'Tax Payments', day: 'Day 21', prior: 0, current: -3200, comment: '' },
  { ent: 'FR Manufacturing', cat: 'Payroll', day: 'Day 15', prior: -890, current: -1340, comment: 'Bonus accruals included' },
  { ent: 'UK Services', cat: 'Customer Receipts', day: 'Day 5', prior: 1450, current: 1820, comment: 'Pipeline tightening — confirmed deals' },
];

// ---------------------------------------------------------------------------
// Forecast grid definition — the row template shared by the submission and
// consolidated grids.
// ---------------------------------------------------------------------------
export const lineItems: LineItem[] = [
  { section: 'INFLOWS' },
  { label: 'Customer Receipts', baseMin: 1800, baseMax: 2400 },
  { label: 'Intercompany Receipts', baseMin: 200, baseMax: 600 },
  { label: 'Other Inflows', baseMin: 0, baseMax: 150 },
  { label: 'Total Inflows', isSubtotal: true },
  { section: 'OUTFLOWS' },
  { label: 'Supplier Payments', baseMin: -1900, baseMax: -1200, negative: true },
  { label: 'Payroll', baseMin: -800, baseMax: -200, negative: true, payday: true },
  { label: 'Tax Payments', baseMin: -600, baseMax: 0, negative: true, taxday: true },
  { label: 'Intercompany Payments', baseMin: -400, baseMax: 0, negative: true },
  { label: 'Capex', baseMin: -300, baseMax: 0, negative: true },
  { label: 'Other Outflows', baseMin: -200, baseMax: 0, negative: true },
  { label: 'Total Outflows', isSubtotal: true },
  { label: 'Net Cash Flow', isTotal: true },
];

/** The 30 days of the current forecast horizon (starts 25 May 2026). */
export function getDates(): Date[] {
  const dates: Date[] = [];
  const start = new Date(2026, 4, 25);
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d);
  }
  return dates;
}

export interface DayLabel {
  dm: string;
  dow: string;
  weekend: boolean;
}

export const dates: Date[] = getDates();

export const dayLabels: DayLabel[] = dates.map((d) => {
  const dow = d.toLocaleDateString('en-US', { weekday: 'short' });
  const dm = `${d.getDate()}/${d.getMonth() + 1}`;
  return { dm, dow, weekend: d.getDay() === 0 || d.getDay() === 6 };
});

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

/**
 * Generate the default value for a data cell, mirroring the prototype's
 * genValue rules (paydays, tax days, weekends). `rand` is supplied so callers
 * can seed generation deterministically per entity.
 */
export function genValue(item: LineItem, dayIdx: number, rand: () => number): number {
  const d = dates[dayIdx];
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  if (item.payday && d.getDate() !== 28 && d.getDate() !== 15) return 0;
  if (item.taxday && d.getDate() !== 22) return 0;
  if (isWeekend && !item.negative) return 0;
  const range = (item.baseMax ?? 0) - (item.baseMin ?? 0);
  return Math.round(((item.baseMin ?? 0) + rand() * range) * (isWeekend ? 0.3 : 1));
}

/**
 * Build the default cell values for an entity's grid. Data rows get generated
 * values; subtotal / total rows are computed. Returns a map keyed
 * `${rowIdx}-${dayIdx}` plus a set of variance-flagged keys.
 */
export function generateGridValues(
  seed: number,
  flagSome: boolean,
): { values: Record<string, number>; flags: string[] } {
  const rand = mulberry32(seed);
  const values: Record<string, number> = {};
  const flags: string[] = [];

  lineItems.forEach((item, rowIdx) => {
    if (item.section) return;
    dayLabels.forEach((_dl, i) => {
      let val = 0;
      if (!item.isSubtotal && !item.isTotal) {
        val = genValue(item, i, rand);
        values[`${rowIdx}-${i}`] = val;
        if (flagSome && rand() < 0.04) flags.push(`${rowIdx}-${i}`);
      } else if (item.isSubtotal) {
        if (item.label === 'Total Inflows') {
          for (let r = 1; r <= 3; r++) val += values[`${r}-${i}`] || 0;
        } else {
          for (let r = 6; r <= 11; r++) val += values[`${r}-${i}`] || 0;
        }
        values[`${rowIdx}-${i}`] = val;
      } else if (item.isTotal) {
        val = (values[`4-${i}`] || 0) + (values[`12-${i}`] || 0);
        values[`${rowIdx}-${i}`] = val;
      }
    });
  });

  return { values, flags };
}

/** Stable numeric seed derived from an entity name. */
export function seedFor(entity: string): number {
  let h = 0;
  for (let i = 0; i < entity.length; i++) {
    h = (Math.imul(31, h) + entity.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
