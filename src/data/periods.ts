// ============================================================================
// Forecast periods. Forecasts are maintained on a rolling weekly basis: a
// period key is the ISO date of a week's Monday ("2026-07-13"), and each
// submission covers a four-week horizon of working days (Mon–Fri, 20 days),
// exactly like the standard CF_Forecast_Template workbook.
// ============================================================================

import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../components/settings/defaults';
import { loadSettings } from '../storage/localStorage';

export interface DayLabel {
  dm: string;
  dow: string;
  weekend: boolean;
  /** ISO date of the day, used to align imports/exports. */
  iso: string;
}

export const WORKDAYS_PER_WEEK = 5;
/** The horizon used when no setting has been chosen: four working weeks. */
export const DEFAULT_HORIZON_DAYS = 20;

/**
 * Forecast horizon in WORKING DAYS, from the Settings screen.
 *
 * The Cycle Configuration panel used to be inert — the horizon and frequency
 * persisted and changed nothing anywhere, so it read as a set of rules the
 * app obeyed when in fact no screen consulted it. Both options now drive real
 * behaviour: this decides how many columns a forecast has, and `cadenceWeeks`
 * below decides how far apart cycles sit.
 */
const HORIZON_WORKING_DAYS: Record<string, number> = {
  '30 days': 20, // four working weeks — the classic template horizon
  '13 weeks': 65,
  '90 days': 60,
};

export function horizonDays(settings?: Pick<Settings, 'horizon'>): number {
  const configured = settings ?? loadSettings(DEFAULT_SETTINGS);
  return HORIZON_WORKING_DAYS[configured.horizon] ?? DEFAULT_HORIZON_DAYS;
}

/** How many weeks apart consecutive cycles open, from Cycle Frequency. */
const CADENCE_WEEKS: Record<string, number> = {
  'Weekly (Mon → Fri close)': 1,
  'Bi-weekly': 2,
  Monthly: 4,
};

export function cadenceWeeks(settings?: Pick<Settings, 'frequency'>): number {
  const configured = settings ?? loadSettings(DEFAULT_SETTINGS);
  return CADENCE_WEEKS[configured.frequency] ?? 1;
}

/** Whole weeks the horizon spans, for labels like "4-Week Outlook". */
export function horizonWeeks(settings?: Pick<Settings, 'horizon'>): number {
  return Math.max(1, Math.round(horizonDays(settings) / WORKDAYS_PER_WEEK));
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEK_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Is `key` a parsable ISO week key ("YYYY-MM-DD")? Storage written by very
 * old app versions used other period formats; label helpers must not crash
 * on them. */
export function isValidWeekKey(key: string): boolean {
  return WEEK_KEY_RE.test(key) && !isNaN(fromKey(key).getTime());
}

/** The Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  const dow = out.getDay(); // 0 Sun .. 6 Sat
  out.setDate(out.getDate() + (dow === 0 ? -6 : 1 - dow));
  return out;
}

/** Week key for any date = ISO date of its Monday. */
export function weekKeyFor(d: Date): string {
  return toIso(mondayOf(d));
}

/** The current forecast week (Monday of today's week). */
export function currentWeekKey(): string {
  return weekKeyFor(new Date());
}

/** The week immediately before `key` (used for rolling variance comparison). */
export function prevWeekKey(key: string): string {
  const d = fromKey(key);
  d.setDate(d.getDate() - 7);
  return toIso(d);
}

/** The week `n` weeks after `key` (negative n moves back). */
export function shiftWeeks(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n * 7);
  return toIso(d);
}

/** ISO-8601 week number, for labels like "Wk 29". */
export function isoWeekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** "Wk 29 · 13 Jul 2026" (unparsable keys fall back to the raw key). */
export function weekLabel(key: string): string {
  if (!isValidWeekKey(key)) return key;
  const d = fromKey(key);
  return `Wk ${isoWeekNumber(d)} · ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** Short label for crumbs: "Wk 29 2026" (falls back to the raw key). */
export function weekLabelShort(key: string): string {
  if (!isValidWeekKey(key)) return key;
  const d = fromKey(key);
  return `Wk ${isoWeekNumber(d)} ${d.getFullYear()}`;
}

/** Selectable years for the period filter. */
export function listYears(): number[] {
  return [2025, 2026, 2027];
}

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

/**
 * Week keys (Mondays) that fall inside a given year + month (1-12).
 */
export function weeksInMonth(year: number, month: number): string[] {
  const out: string[] = [];
  const d = new Date(year, month - 1, 1);
  // advance to first Monday
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    out.push(toIso(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

/** The year/month a week key belongs to (by its Monday). */
export function weekYearMonth(key: string): { year: number; month: number } {
  const d = fromKey(key);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * The horizon covered by a forecast week: HORIZON_DAYS working days
 * (Mon–Fri), starting on the week's Monday — weekends are skipped, exactly
 * like the WORKDAY() sequence in the standard workbook.
 */
export function horizonDates(key: string): Date[] {
  const out: Date[] = [];
  const d = fromKey(key);
  const count = horizonDays();
  while (out.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function dayLabelsForWeek(key: string): DayLabel[] {
  return horizonDates(key).map((d) => ({
    dm: `${d.getDate()}/${d.getMonth() + 1}`,
    dow: d.toLocaleDateString('en-US', { weekday: 'short' }),
    weekend: false,
    iso: toIso(d),
  }));
}

// ---------------------------------------------------------------------------
// Template-driven horizons. Templates authored in the in-browser editor can
// declare their own number of forecast periods and granularity; templates
// without a `periods` block (uploaded workbooks, the seeded standard one)
// keep the classic four-week / 20-working-day horizon, so every existing
// screen and stored submission behaves exactly as before.
// ---------------------------------------------------------------------------
import type { ForecastTemplate, TemplatePeriods } from '../types';

/** The period config a template uses, defaulted to the standard horizon. */
export function periodsOf(template?: Pick<ForecastTemplate, 'periods'> | null): TemplatePeriods {
  const p = template?.periods;
  if (!p || !Number.isFinite(p.count) || p.count < 1) {
    // Templates that do not declare their own periods follow the horizon
    // configured in Settings.
    return { count: horizonDays(), granularity: 'day' };
  }
  return { count: Math.min(Math.round(p.count), 120), granularity: p.granularity ?? 'day' };
}

/**
 * How many columns a forecast rolls forward between consecutive cycles.
 *
 * Cycles are weekly, so a daily template moves five columns, a weekly one
 * moves one, and a monthly one stays put — that offset is what lines a prior
 * forecast's column up with the same calendar period in the current one.
 */
export function rollShift(template?: Pick<ForecastTemplate, 'periods'> | null): number {
  const { granularity } = periodsOf(template);
  // How far the horizon rolls between cycles depends on how often cycles
  // open, not just on the template's granularity.
  const weeks = cadenceWeeks();
  if (granularity === 'day') return WORKDAYS_PER_WEEK * weeks;
  return granularity === 'week' ? weeks : 0;
}

/** Dates for a template's forecast columns, starting at `key`'s Monday. */
export function templateDates(
  template: Pick<ForecastTemplate, 'periods'> | null | undefined,
  key: string,
): Date[] {
  const { count, granularity } = periodsOf(template);
  if (granularity === 'day') {
    const out: Date[] = [];
    const d = fromKey(key);
    while (out.length < count) {
      if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  const out: Date[] = [];
  const start = fromKey(key);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    if (granularity === 'week') d.setDate(d.getDate() + i * 7);
    else d.setMonth(d.getMonth() + i);
    out.push(d);
  }
  return out;
}

/** Column headers for a template's forecast periods. */
export function templateDayLabels(
  template: Pick<ForecastTemplate, 'periods'> | null | undefined,
  key: string,
): DayLabel[] {
  const { granularity } = periodsOf(template);
  return templateDates(template, key).map((d) => ({
    dm:
      granularity === 'month'
        ? `${MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`
        : `${d.getDate()}/${d.getMonth() + 1}`,
    dow:
      granularity === 'day'
        ? d.toLocaleDateString('en-US', { weekday: 'short' })
        : granularity === 'week'
          ? `Wk ${isoWeekNumber(d)}`
          : MONTHS[d.getMonth()],
    weekend: false,
    iso: toIso(d),
  }));
}
