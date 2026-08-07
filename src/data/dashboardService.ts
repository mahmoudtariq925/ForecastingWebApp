// ============================================================================
// Everything the merged treasury dashboard aggregates.
//
// The dashboard is now one page — stat boxes plus a single outlook chart —
// with the old Cycle Progress, Consolidated and Forecast-vs-Forecast screens
// folded into modals behind it. All of them ask the same three questions:
//
//   who has submitted (and who has not),
//   what does the group's forecast add up to,
//   and which country is driving a given move?
//
// The answers live here rather than in the screen, so the modals and the page
// can never disagree, and the whole lot moves behind an API untouched.
// ============================================================================
import type { Entity, ForecastTemplate, Settings, SubmissionStatus } from '../types';
import { listEntities } from './appData';
import { periodsOf } from './periods';
import {
  consolidatedValues,
  getPriorValues,
  isVariance,
  mergedEntityStatus,
  peekSubmission,
  priorValueFor,
  settingsForEntity,
  templateForEntity,
} from './submissionService';
import { loadTemplates, type ApprovalMap } from '../storage/localStorage';
import { dayInflows, dayNet, dayOutflows } from '../components/submissions/gridMath';

/** One country's line in the cycle-progress and approval views. */
export interface CountryProgress {
  entity: Entity;
  status: SubmissionStatus;
  templateId: string;
  /** Full-horizon net total for the week, EUR thousands. */
  total: number;
  /** Week-over-week move, or null when there is no prior forecast. */
  delta: number | null;
  /** Flagged cells still without commentary. */
  needCommentary: number;
  received: boolean;
  approved: boolean;
}

/** A region band with its countries, for the collapsible progress views. */
export interface RegionProgress {
  name: string;
  countries: CountryProgress[];
  total: number;
  received: number;
  /** Countries submitted but not yet approved. */
  awaiting: number;
}

/**
 * Region → country rollup of the active cycle. One pass over the entities
 * produces every number the progress modal, the approvals modal and the stat
 * boxes show, so a country can never be "received" in one and not the other.
 */
export function cycleProgress(week: string, overrides: ApprovalMap): RegionProgress[] {
  const templates = loadTemplates();
  const order: string[] = [];
  const byRegion = new Map<string, CountryProgress[]>();

  for (const entity of listEntities()) {
    const template = templateForEntity(templates, entity.name);
    const status = mergedEntityStatus(entity, week, template?.id ?? '', overrides);
    const row: CountryProgress = {
      entity,
      status,
      templateId: template?.id ?? '',
      total: 0,
      delta: null,
      needCommentary: 0,
      received: status !== 'pending',
      approved: status === 'approved',
    };
    if (template) {
      const periods = periodsOf(template).count;
      const cats = template.categories.length;
      const sub = peekSubmission(entity.name, week, template);
      const priorValues = getPriorValues(entity.name, week, template);
      let total = 0;
      let prior = 0;
      for (let d = 0; d < periods; d++) {
        total += dayNet(cats, sub.values, d);
        prior += dayNet(cats, priorValues, d);
      }
      row.total = total;
      row.delta = prior === 0 ? null : ((total - prior) / Math.abs(prior)) * 100;
      row.needCommentary = sub.flags.filter((k) => !sub.comments?.[k]?.trim()).length;
    }
    if (!byRegion.has(entity.region)) {
      byRegion.set(entity.region, []);
      order.push(entity.region);
    }
    byRegion.get(entity.region)!.push(row);
  }

  return order.map((name) => {
    const countries = byRegion.get(name)!;
    return {
      name,
      countries,
      total: countries.reduce((s, c) => s + c.total, 0),
      received: countries.filter((c) => c.received).length,
      awaiting: countries.filter((c) => c.received && !c.approved).length,
    };
  });
}

/** Flatten a region rollup back to countries (for counting and filtering). */
export function allCountries(regions: RegionProgress[]): CountryProgress[] {
  return regions.flatMap((r) => r.countries);
}

/** Drop countries a view does not care about, keeping the region banding. */
export function filterRegions(
  regions: RegionProgress[],
  keep: (c: CountryProgress) => boolean,
): RegionProgress[] {
  return regions
    .map((r) => ({ ...r, countries: r.countries.filter(keep) }))
    .filter((r) => r.countries.length > 0);
}

// ---------------------------------------------------------------------------
// Requires attention: which countries owe commentary, biggest move first.
// ---------------------------------------------------------------------------

/** One country's commentary debt, ranked by the size of its largest move. */
export interface AttentionRow {
  entity: string;
  region: string;
  templateId: string;
  /** Flagged cells with no commentary yet. */
  needCommentary: number;
  flagged: number;
  /** Largest unexplained move, as a percentage. */
  worstPct: number;
  /** Absolute size of that move in EUR thousands — the ranking key. */
  worstAbs: number;
  worstLabel: string;
  /** Cell key of the worst move, so a caller can deep-link to it. */
  worstCell: string;
  submitter: string;
}

/**
 * Countries whose forecast still needs commentary, sorted by the size of
 * their largest unexplained variance — largest first, which is the order a
 * treasury reviewer works down the list in.
 */
export function attentionRows(week: string, base: Settings): AttentionRow[] {
  const templates = loadTemplates();
  const out: AttentionRow[] = [];
  for (const entity of listEntities()) {
    const template = templateForEntity(templates, entity.name);
    if (!template) continue;
    const settings = settingsForEntity(entity.name, base);
    const sub = peekSubmission(entity.name, week, template);
    const prior = getPriorValues(entity.name, week, template);
    const open = sub.flags.filter((k) => !sub.comments?.[k]?.trim());
    if (open.length === 0) continue;

    let worstAbs = 0;
    let worstPct = 0;
    let worstLabel = '';
    let worstCell = open[0];
    for (const key of open) {
      const [c, d] = key.split('-').map(Number);
      const current = sub.values[key] || 0;
      const prev = priorValueFor(prior, c, d, template) ?? 0;
      const abs = Math.abs(current - prev);
      if (abs < worstAbs) continue;
      worstAbs = abs;
      worstPct = ((current - prev) / Math.max(Math.abs(prev), 1)) * 100;
      worstLabel = `${template.categories[c]?.label ?? `Line ${c + 1}`} · day ${d + 1}`;
      worstCell = key;
    }
    out.push({
      entity: entity.name,
      region: entity.region,
      templateId: template.id,
      needCommentary: open.length,
      flagged: sub.flags.length,
      worstPct,
      worstAbs,
      worstLabel,
      worstCell,
      submitter: entity.submitter,
    });
    void settings; // thresholds already decided which cells are flagged
  }
  return out.sort((a, b) => b.worstAbs - a.worstAbs);
}

// ---------------------------------------------------------------------------
// Consolidated forecast: the group total, and who makes it up.
// ---------------------------------------------------------------------------

/** One country's share of a consolidated line. */
export interface CountryShare {
  entity: string;
  value: number;
}

/** A consolidated line item with the countries that add up to it. */
export interface ConsolidatedLine {
  label: string;
  /** Full-horizon total across every entity, EUR thousands. */
  total: number;
  prior: number;
  pct: number | null;
  /** Country breakdown, biggest contribution first. */
  countries: CountryShare[];
  /** Summary lines (Total inflows / outflows / Net) read as totals. */
  emphasis?: boolean;
}

/** Per-day consolidated series the modal charts. */
export interface ConsolidatedSeriesData {
  inflows: number[];
  outflows: number[];
  net: number[];
}

export interface ConsolidatedReport {
  lines: ConsolidatedLine[];
  series: ConsolidatedSeriesData;
  entityCount: number;
  /** Line items no display-template row could take (never silently dropped). */
  omitted: { label: string; entities: string[]; total: number }[];
}

/** Sum one entity's category over the whole horizon. */
function categoryTotal(
  values: Record<string, number>,
  catIdx: number,
  periods: number,
): number {
  let s = 0;
  for (let d = 0; d < periods; d++) s += values[`${catIdx}-${d}`] || 0;
  return s;
}

/**
 * The consolidated forecast, as the modal renders it: three summary lines
 * (inflows, outflows, net), then every line item — each carrying the
 * country-by-country breakdown that adds up to it.
 */
export function consolidatedReport(
  week: string,
  priorWeek: string,
  display: ForecastTemplate,
): ConsolidatedReport {
  const templates = loadTemplates();
  const periods = periodsOf(display).count;
  const numCats = display.categories.length;
  const current = consolidatedValues(week, display);
  const prior = consolidatedValues(priorWeek, display);

  const pct = (cur: number, prev: number): number | null =>
    prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

  // Per-entity totals, so every line can be broken down by country.
  const perEntity = listEntities().map((e) => {
    const template = templateForEntity(templates, e.name) ?? display;
    const sub = peekSubmission(e.name, week, template);
    const cats = template.categories.length;
    let inflows = 0;
    let outflows = 0;
    let net = 0;
    for (let d = 0; d < periods; d++) {
      inflows += dayInflows(cats, sub.values, d);
      outflows += dayOutflows(cats, sub.values, d);
      net += dayNet(cats, sub.values, d);
    }
    // Line items are matched by LABEL, exactly like the consolidation itself,
    // so an entity on another template still lands on the right row.
    const byLabel = new Map<string, number>();
    template.categories.forEach((cat, catIdx) => {
      if (cat.subtotal) return;
      const key = cat.label.trim().toLowerCase();
      byLabel.set(key, (byLabel.get(key) ?? 0) + categoryTotal(sub.values, catIdx, periods));
    });
    return { entity: e.name, inflows, outflows, net, byLabel };
  });

  const shares = (pick: (row: (typeof perEntity)[number]) => number): CountryShare[] =>
    perEntity
      .map((row) => ({ entity: row.entity, value: pick(row) }))
      .filter((s) => s.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const sumDays = (
    values: Record<string, number>,
    fn: (cats: number, v: Record<string, number>, d: number) => number,
  ): number => {
    let s = 0;
    for (let d = 0; d < periods; d++) s += fn(numCats, values, d);
    return s;
  };

  const summary: ConsolidatedLine[] = [
    {
      label: 'Total inflows',
      total: sumDays(current.values, dayInflows),
      prior: sumDays(prior.values, dayInflows),
      pct: null,
      countries: shares((r) => r.inflows),
      emphasis: true,
    },
    {
      label: 'Total outflows',
      total: sumDays(current.values, dayOutflows),
      prior: sumDays(prior.values, dayOutflows),
      pct: null,
      countries: shares((r) => r.outflows),
      emphasis: true,
    },
    {
      label: 'Net cash flow',
      total: sumDays(current.values, dayNet),
      prior: sumDays(prior.values, dayNet),
      pct: null,
      countries: shares((r) => r.net),
      emphasis: true,
    },
  ].map((l) => ({ ...l, pct: pct(l.total, l.prior) }));

  const lines: ConsolidatedLine[] = display.categories
    .filter((cat) => !cat.subtotal)
    .map((cat) => {
      const catIdx = display.categories.indexOf(cat);
      const total = categoryTotal(current.values, catIdx, periods);
      const prev = categoryTotal(prior.values, catIdx, periods);
      const key = cat.label.trim().toLowerCase();
      return {
        label: cat.label,
        total,
        prior: prev,
        pct: pct(total, prev),
        countries: shares((r) => r.byLabel.get(key) ?? 0),
      };
    });

  return {
    lines: [...summary, ...lines],
    series: {
      inflows: Array.from({ length: periods }, (_v, d) => dayInflows(numCats, current.values, d)),
      outflows: Array.from({ length: periods }, (_v, d) => dayOutflows(numCats, current.values, d)),
      net: Array.from({ length: periods }, (_v, d) => dayNet(numCats, current.values, d)),
    },
    entityCount: current.entityCount,
    omitted: current.omitted,
  };
}

// ---------------------------------------------------------------------------
// One day of the outlook chart, broken down by country.
// ---------------------------------------------------------------------------

/** One country's contribution to a single day of the consolidated forecast. */
export interface DayContribution {
  entity: string;
  region: string;
  templateId: string;
  inflows: number;
  outflows: number;
  net: number;
  /** The same day in the prior forecast, or null beyond its horizon. */
  priorNet: number | null;
  /** Change vs that prior forecast — what the sort is on. */
  varianceAbs: number;
  variancePct: number | null;
  /** Line items behind this country's number, biggest move first. */
  lines: {
    label: string;
    current: number;
    prior: number | null;
    delta: number;
    flagged: boolean;
    comment: string;
  }[];
}

/**
 * Country-level breakdown of one day of the outlook, ranked by how much each
 * country moved the group number versus the prior forecast — so clicking a
 * spike answers "who caused this?" from the top of the list down.
 */
export function dayContributions(
  week: string,
  dayIdx: number,
  base: Settings,
): DayContribution[] {
  const templates = loadTemplates();
  const out: DayContribution[] = [];
  for (const entity of listEntities()) {
    const template = templateForEntity(templates, entity.name);
    if (!template) continue;
    const settings = settingsForEntity(entity.name, base);
    const sub = peekSubmission(entity.name, week, template);
    const prior = getPriorValues(entity.name, week, template);
    const cats = template.categories.length;

    const net = dayNet(cats, sub.values, dayIdx);
    // The prior forecast's view of the SAME calendar day (horizons roll).
    let priorNet: number | null = 0;
    let sawPrior = false;
    let lines: DayContribution['lines'] = [];
    template.categories.forEach((cat, catIdx) => {
      if (cat.subtotal) return;
      const key = `${catIdx}-${dayIdx}`;
      const current = sub.values[key] || 0;
      const prev = priorValueFor(prior, catIdx, dayIdx, template);
      if (prev !== null) {
        sawPrior = true;
        priorNet = (priorNet ?? 0) + prev;
      }
      if (current === 0 && (prev ?? 0) === 0) return;
      lines.push({
        label: cat.label,
        current,
        prior: prev,
        delta: current - (prev ?? 0),
        flagged: sub.flags.includes(key) || isVariance(current, prev, settings),
        comment: sub.comments?.[key]?.trim() ?? '',
      });
    });
    if (!sawPrior) priorNet = null;
    lines = lines.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    out.push({
      entity: entity.name,
      region: entity.region,
      templateId: template.id,
      inflows: dayInflows(cats, sub.values, dayIdx),
      outflows: dayOutflows(cats, sub.values, dayIdx),
      net,
      priorNet,
      varianceAbs: priorNet === null ? Math.abs(net) : Math.abs(net - priorNet),
      variancePct:
        priorNet === null || priorNet === 0
          ? null
          : ((net - priorNet) / Math.abs(priorNet)) * 100,
      lines,
    });
  }
  return out.sort((a, b) => b.varianceAbs - a.varianceAbs);
}
