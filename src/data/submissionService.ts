// ============================================================================
// Submission lifecycle helpers shared by the Submission screen and the
// Dashboard KPIs. All persistence goes through the API; this module knows how
// to seed demo data for a brand-new grid and how rolling weekly horizons
// align for variance comparison.
// ============================================================================
import type { ForecastTemplate, Settings, Submission } from '../types';
import { generateGridValues, seedFor, STANDARD_TEMPLATE_ID, startingBalanceFor } from './demoData';
import { HORIZON_DAYS, prevWeekKey, WORKDAYS_PER_WEEK } from './periods';
import { getSubmission, putSubmission } from '../api/resources';
import type { GridValues } from '../components/submissions/gridMath';

/**
 * Load the stored submission for (week, entity, template) or create and
 * persist a fresh one through the API. The standard template seeds demo
 * values; uploaded templates start blank.
 */
export async function getOrCreateSubmission(
  entity: string,
  week: string,
  template: ForecastTemplate,
): Promise<Submission> {
  const stored = await getSubmission(week, entity, template.id);
  if (stored) return stored;

  const isStandard = template.id === STANDARD_TEMPLATE_ID;
  const { values, flags } = isStandard
    ? generateGridValues(template.categories, week, seedFor(`${entity}:${week}`), true)
    : { values: {}, flags: [] };

  const fresh: Submission = {
    period: week,
    entity,
    templateId: template.id,
    status: 'draft',
    values,
    flags,
    comments: {},
    dayComments: {},
    startingBalance: startingBalanceFor(entity),
    updatedAt: new Date().toISOString(),
  };
  return putSubmission(fresh);
}

/**
 * Prior-week values used for variance comparison and "Copy Prior Forecast":
 * the stored previous-week submission if one exists, otherwise (standard
 * template only) deterministic generated data, otherwise blank.
 */
export async function getPriorValues(
  entity: string,
  week: string,
  template: ForecastTemplate,
): Promise<{ values: GridValues; stored: boolean }> {
  const prevKey = prevWeekKey(week);
  const stored = await getSubmission(prevKey, entity, template.id);
  if (stored) return { values: stored.values, stored: true };
  if (template.id === STANDARD_TEMPLATE_ID) {
    return {
      values: generateGridValues(template.categories, prevKey, seedFor(`${entity}:${prevKey}`), false)
        .values,
      stored: false,
    };
  }
  return { values: {}, stored: false };
}

/**
 * The prior-week value that corresponds to a current-horizon cell. Horizons
 * roll by one week, so current day d falls on the same calendar date as
 * prior day d + 5 working days. Returns null for the final week of the
 * horizon, which the prior submission did not cover.
 */
export function priorValueFor(
  prior: GridValues,
  catIdx: number,
  dayIdx: number,
): number | null {
  const shifted = dayIdx + WORKDAYS_PER_WEEK;
  if (shifted >= HORIZON_DAYS) return null;
  return prior[`${catIdx}-${shifted}`] || 0;
}

/** Does an edited cell breach the variance threshold vs its prior value? */
export function isVariance(
  current: number,
  prior: number | null,
  settings: Settings,
): boolean {
  if (prior === null) {
    // Days beyond the prior horizon: flag only if the admin disabled the exemption.
    if (settings.exemptNewPeriods.startsWith('Yes')) return false;
    prior = 0;
  }
  const minAbs = Number(String(settings.minValueToTrigger).replace(/[,\s]/g, '')) / 1000 || 0;
  if (Math.abs(current) < minAbs) return false;
  const pct = (Math.abs(current - prior) / Math.max(Math.abs(prior), 1)) * 100;
  return pct > settings.varianceThreshold;
}

/** Templates assigned to an entity, falling back to all templates. */
export function templatesForEntity(
  templates: ForecastTemplate[],
  entity: string,
): ForecastTemplate[] {
  const assigned = templates.filter((t) => t.assignedEntities.includes(entity));
  return assigned.length > 0 ? assigned : templates;
}
