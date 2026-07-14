// ============================================================================
// Submission lifecycle helpers shared by the Submission screen and the
// Dashboard KPIs. Sits on top of the storage layer; knows how to seed demo
// data for the standard template and where prior-period values come from.
// ============================================================================
import type { ForecastTemplate, Settings, Submission } from '../types';
import { generateGridValues, seedFor, STANDARD_TEMPLATE_ID } from './mockData';
import { prevPeriodKey } from './periods';
import { loadSubmission, saveSubmission } from '../storage/localStorage';
import type { GridValues } from '../components/submissions/gridMath';

/**
 * Load the stored submission for (period, entity, template) or create and
 * persist a fresh one. The standard template seeds demo values; uploaded
 * templates start blank.
 */
export function getOrCreateSubmission(
  entity: string,
  period: string,
  template: ForecastTemplate,
): Submission {
  const stored = loadSubmission(period, entity, template.id);
  if (stored) return stored;

  const isStandard = template.id === STANDARD_TEMPLATE_ID;
  const { values, flags } = isStandard
    ? generateGridValues(template.rows, period, seedFor(`${entity}:${period}`), true)
    : { values: {}, flags: [] };

  const fresh: Submission = {
    period,
    entity,
    templateId: template.id,
    status: 'draft',
    values,
    flags,
    comments: {},
    updatedAt: new Date().toISOString(),
  };
  saveSubmission(fresh);
  return fresh;
}

/**
 * Prior-period values used for variance comparison and "Copy Prior Forecast":
 * the stored previous-period submission if one exists, otherwise (standard
 * template only) deterministic generated data, otherwise blank.
 */
export function getPriorValues(
  entity: string,
  period: string,
  template: ForecastTemplate,
): GridValues {
  const prevKey = prevPeriodKey(period);
  const stored = loadSubmission(prevKey, entity, template.id);
  if (stored) return stored.values;
  if (template.id === STANDARD_TEMPLATE_ID) {
    return generateGridValues(template.rows, period, seedFor(`${entity}:${prevKey}`), false).values;
  }
  return {};
}

/** Does an edited cell breach the variance threshold vs its prior value? */
export function isVariance(current: number, prior: number, settings: Settings): boolean {
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
