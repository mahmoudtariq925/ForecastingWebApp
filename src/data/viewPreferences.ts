// ============================================================================
// View preferences: how a reader wants a forecast DRAWN, as opposed to what
// it says. Nothing here changes a figure, so it is stored per browser rather
// than on the forecast, and it survives a reload because a setting somebody
// has to re-pick on every visit is a setting they end up fighting.
// ============================================================================
import { loadData, saveData } from '../storage/localStorage';

/**
 * Conditional formatting on the forecast grids.
 *
 * `row` shades each line against its own biggest periods — "is this a big
 * week for receivables?". `grid` puts every cell on one scale — "where is the
 * money in this forecast at all?". `off` is a plain grid of numbers, which is
 * what a reader who works in the figures rather than the colours wants, and
 * what anyone printing or screen-sharing a forecast usually wants too.
 */
export type ConditionalFormatting = 'row' | 'grid' | 'off';

const KEY = 'forecastConditionalFormatting';

const isMode = (v: unknown): v is ConditionalFormatting =>
  v === 'row' || v === 'grid' || v === 'off';

export function loadConditionalFormatting(): ConditionalFormatting {
  const stored = loadData<unknown>(KEY, 'row');
  return isMode(stored) ? stored : 'row';
}

export function saveConditionalFormatting(mode: ConditionalFormatting): void {
  saveData(KEY, mode);
}

/** What each option is called, and what it does — the toggle reads these. */
export const FORMATTING_OPTIONS: {
  mode: ConditionalFormatting;
  label: string;
  title: string;
}[] = [
  { mode: 'row', label: 'Row', title: 'Shade each line against its own biggest periods' },
  { mode: 'grid', label: 'Whole forecast', title: 'Shade every cell against the whole forecast' },
  { mode: 'off', label: 'Off', title: 'No shading — just the numbers' },
];
