// ============================================================================
// Reporting periods (month/year). A period key is "YYYY-MM"; the forecast
// grid for a period covers every day of that month.
// ============================================================================

export interface DayLabel {
  dm: string;
  dow: string;
  weekend: boolean;
}

export interface PeriodOption {
  key: string;
  label: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The period the seeded demo data refers to (cycle CW-2026-21). */
export const DEFAULT_PERIOD = '2026-05';

export function periodLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Selectable reporting periods (Jan 2025 → Dec 2026). */
export function listPeriods(): PeriodOption[] {
  const out: PeriodOption[] = [];
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      out.push({ key, label: periodLabel(key) });
    }
  }
  return out;
}

/** The period immediately before `key` (used for variance comparison). */
export function prevPeriodKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Every calendar day of the period's month. */
export function datesForPeriod(key: string): Date[] {
  const [y, m] = key.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dates: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) dates.push(new Date(y, m - 1, d));
  return dates;
}

export function dayLabelsForPeriod(key: string): DayLabel[] {
  return datesForPeriod(key).map((d) => ({
    dm: `${d.getDate()}/${d.getMonth() + 1}`,
    dow: d.toLocaleDateString('en-US', { weekday: 'short' }),
    weekend: d.getDay() === 0 || d.getDay() === 6,
  }));
}
