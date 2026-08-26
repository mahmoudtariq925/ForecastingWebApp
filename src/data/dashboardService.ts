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
import type {
  Cycle,
  Entity,
  ForecastTemplate,
  Settings,
  Submission,
  SubmissionStatus,
} from '../types';
import { cycleSummary, type CycleSummary } from './cycleService';
import { listEntities } from './appData';
import { periodsOf } from './periods';
import {
  consolidatedValues,
  entityStatus,
  getPriorValues,
  isReceived,
  isVariance,
  pctChange,
  peekSubmission,
  priorValueFor,
  settingsForEntity,
  templateForEntity,
} from './submissionService';
import { loadApprovals, loadTemplates, type ApprovalMap } from '../storage/localStorage';
import { activeCycleId } from './submissionService';
import { dayInflows, dayNet, dayOutflows } from '../components/submissions/gridMath';
import { customRowsOf, gridCatCount } from './customRows';

/**
 * One country's line in the cycle-progress and approval views.
 *
 * Deliberately no forecast total: this rollup answers "is it in yet?", and a
 * €k figure beside a country name told you nothing about whether that country
 * had reported. The numbers live in the outlook, the matrix and the
 * consolidated forecast, where they are what is being read.
 */
export interface CountryProgress {
  entity: Entity;
  status: SubmissionStatus;
  templateId: string;
  /** Flagged cells still without commentary. */
  needCommentary: number;
  received: boolean;
  approved: boolean;
}

/** A region band with its countries, for the collapsible progress views. */
export interface RegionProgress {
  name: string;
  countries: CountryProgress[];
  received: number;
  /** Countries submitted but not yet approved. */
  awaiting: number;
}

/**
 * One entity's line-item sums, keyed by label — the shape every cross-entity
 * rollup matches on, because entities can be on different templates.
 *
 * The rows a SUBMITTER added are folded into their section, onto its first
 * input line. "Customer A" is one country's way of splitting its receivables,
 * not a line of the group's forecast; what the group needs is the money, and
 * the money belongs to the section. Consolidation does exactly the same thing
 * (see `consolidatedValues`), so the two agree.
 */
function sumsByLabel(
  template: ForecastTemplate,
  sub: Submission,
  selection: number[],
): Map<string, number> {
  const byLabel = new Map<string, number>();
  const add = (label: string, value: number) => {
    const key = label.trim().toLowerCase();
    byLabel.set(key, (byLabel.get(key) ?? 0) + value);
  };
  const sectionLine = new Map<string, string>();
  template.categories.forEach((cat, catIdx) => {
    if (cat.subtotal) return;
    if (cat.group && !sectionLine.has(cat.group.trim().toLowerCase())) {
      sectionLine.set(cat.group.trim().toLowerCase(), cat.label);
    }
    add(cat.label, categorySum(sub.values, catIdx, selection));
  });
  customRowsOf(sub).forEach((row, i) => {
    // The line the row breaks down, or the first line of its section.
    const parent = row.parent?.trim().toLowerCase();
    const target =
      (parent && byLabel.has(parent) ? row.parent?.trim() : undefined) ??
      sectionLine.get(row.section.trim().toLowerCase());
    if (target === undefined) return;
    add(target, categorySum(sub.values, template.categories.length + i, selection));
  });
  return byLabel;
}

/**
 * The entities an aggregate covers. `onlyEntities` is how a role (an approver
 * seeing their own countries) and the dashboard's country selector both narrow
 * every rollup — one definition, so the stat boxes, the chart, the matrix and
 * the modals can never disagree about who is in scope.
 */
function scopedEntities(onlyEntities?: string[]): Entity[] {
  return onlyEntities ? listEntities().filter((e) => onlyEntities.includes(e.name)) : listEntities();
}

/**
 * The entities whose forecast is actually PART of the group position for a
 * week: in scope, and reported (submitted, approved or consolidated).
 *
 * Every figure treasury reads — the outlook chart, the country matrix, a day's
 * breakdown, the consolidated report — is built from this list. A country
 * still drafting, or one whose forecast has been returned for update, has not
 * told the group anything yet; including it meant the headline total moved
 * while a submitter was mid-keystroke, and counted countries the cycle
 * progress modal listed as outstanding in the same breath.
 */
export function reportedEntities(week: string, onlyEntities?: string[]): Entity[] {
  const templates = loadTemplates();
  const overrides = loadApprovals(activeCycleId());
  return scopedEntities(onlyEntities).filter((e) => {
    const templateId = templateForEntity(templates, e.name)?.id ?? '';
    return isReceived(entityStatus(e.name, week, templateId, overrides));
  });
}

/**
 * The period columns an aggregate sums over: the whole horizon, or just the
 * ones a cross-filter has selected on the outlook chart.
 *
 * Selection is a SET, not a range — ctrl-clicking several columns picks days
 * that need not be adjacent (three month-ends, say), and a range could not
 * express that.
 */
function selectedPeriods(periods: number, days?: number[] | null): number[] {
  const valid = (days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d < periods);
  if (valid.length === 0) return Array.from({ length: periods }, (_v, i) => i);
  return [...new Set(valid)].sort((a, b) => a - b);
}

/** Does a `${catIdx}-${dayIdx}` cell key fall in the selected periods? */
function inSelection(cellKey: string, selection: Set<number>): boolean {
  const d = Number(cellKey.split('-')[1]);
  return Number.isFinite(d) && selection.has(d);
}

/** Sum one entity's category over the selected periods. */
function categorySum(
  values: Record<string, number>,
  catIdx: number,
  selection: number[],
): number {
  let s = 0;
  for (const d of selection) s += values[`${catIdx}-${d}`] || 0;
  return s;
}

/**
 * Region → country rollup of the active cycle. One pass over the entities
 * produces every number the progress modal, the approvals modal and the stat
 * boxes show, so a country can never be "received" in one and not the other.
 */
export function cycleProgress(
  week: string,
  overrides: ApprovalMap,
  /** Restrict the rollup to these entities (role scoping / country filter). */
  onlyEntities?: string[],
  /** Count commentary in these periods only (cross-filter); omit for all. */
  days?: number[] | null,
): RegionProgress[] {
  const templates = loadTemplates();
  const order: string[] = [];
  const byRegion = new Map<string, CountryProgress[]>();

  for (const entity of scopedEntities(onlyEntities)) {
    const template = templateForEntity(templates, entity.name);
    const status = entityStatus(entity.name, week, template?.id ?? '', overrides);
    const row: CountryProgress = {
      entity,
      status,
      templateId: template?.id ?? '',
      needCommentary: 0,
      // A forecast returned for update has NOT been received — counting
      // 'rejected' as received is what let a rejection push the "submissions
      // received" number up instead of down.
      received: isReceived(status),
      approved: status === 'approved' || status === 'consolidated',
    };
    if (template) {
      const selection = new Set(selectedPeriods(periodsOf(template).count, days));
      const sub = peekSubmission(entity.name, week, template);
      row.needCommentary = sub.flags.filter(
        (k) => !sub.comments?.[k]?.trim() && inSelection(k, selection),
      ).length;
    }
    if (!byRegion.has(entity.region)) {
      byRegion.set(entity.region, []);
      order.push(entity.region);
    }
    byRegion.get(entity.region)!.push(row);
  }

  return order.map((name) => rollUp(name, byRegion.get(name)!));
}

/**
 * Region totals derived from the countries actually in the band.
 *
 * Always compute them here rather than carrying them alongside a list that
 * callers then filter: the approvals view narrowed each region to the
 * countries awaiting a decision but kept the region's original `received`
 * count, so it rendered "DACH 3 / 2 received" with a progress bar past 100%.
 */
function rollUp(name: string, countries: CountryProgress[]): RegionProgress {
  return {
    name,
    countries,
    received: countries.filter((c) => c.received).length,
    awaiting: countries.filter((c) => c.received && !c.approved).length,
  };
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
    // Re-roll the counts against what survived the filter, so a region's
    // numerator can never exceed the list underneath it.
    .map((r) => rollUp(r.name, r.countries.filter(keep)))
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
  /** Largest unexplained move as a percentage, or null when one would mislead. */
  worstPct: number | null;
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
export function attentionRows(
  week: string,
  base: Settings,
  /** Restrict the scan to these entities (role scoping / country filter). */
  onlyEntities?: string[],
  /** Count only cells in these periods (cross-filter); omit for the horizon. */
  days?: number[] | null,
): AttentionRow[] {
  const templates = loadTemplates();
  const out: AttentionRow[] = [];
  // Deliberately every entity in scope, submitted or not: a variance has to be
  // explained BEFORE a forecast can be submitted, so a country still drafting
  // owes commentary too — and that is usually why its forecast has not
  // arrived. Restricting this to received forecasts would also put the KPI
  // permanently at odds with the Comments Review queue it opens onto.
  for (const entity of scopedEntities(onlyEntities)) {
    const template = templateForEntity(templates, entity.name);
    if (!template) continue;
    const settings = settingsForEntity(entity.name, base);
    const sub = peekSubmission(entity.name, week, template);
    const prior = getPriorValues(entity.name, week, template);
    const selection = new Set(selectedPeriods(periodsOf(template).count, days));
    const open = sub.flags.filter((k) => !sub.comments?.[k]?.trim() && inSelection(k, selection));
    if (open.length === 0) continue;

    let worstAbs = 0;
    let worstPct: number | null = null;
    let worstLabel = '';
    let worstCell = open[0];
    for (const key of open) {
      const [c, d] = key.split('-').map(Number);
      const current = sub.values[key] || 0;
      const prev = priorValueFor(prior, c, d, template) ?? 0;
      const abs = Math.abs(current - prev);
      if (abs < worstAbs) continue;
      worstAbs = abs;
      worstPct = pctChange(current, prev);
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

/**
 * The consolidated forecast, as the modal renders it: three summary lines
 * (inflows, outflows, net), then every line item — each carrying the
 * country-by-country breakdown that adds up to it.
 */
export function consolidatedReport(
  week: string,
  priorWeek: string,
  display: ForecastTemplate,
  /** Restrict the consolidation to these entities (country filter). */
  onlyEntities?: string[],
  /** Sum only these periods rather than the whole horizon (cross-filter). */
  days?: number[] | null,
): ConsolidatedReport {
  const templates = loadTemplates();
  const periods = periodsOf(display).count;
  const selection = selectedPeriods(periods, days);
  const numCats = display.categories.length;
  const current = consolidatedValues(week, display, onlyEntities);
  const prior = consolidatedValues(priorWeek, display, onlyEntities);

  const pct = pctChange;

  // Per-entity totals, so every line can be broken down by country. Same
  // population as `consolidatedValues` above, or the shares would not add up
  // to the line they are shares of.
  const perEntity = reportedEntities(week, onlyEntities).map((e) => {
    const template = templateForEntity(templates, e.name) ?? display;
    const sub = peekSubmission(e.name, week, template);
    // The entity's own rows are part of its forecast, so they are part of its
    // totals — `gridCatCount` is what the grid itself sums over.
    const cats = gridCatCount(template, sub);
    let inflows = 0;
    let outflows = 0;
    let net = 0;
    for (const d of selection) {
      inflows += dayInflows(cats, sub.values, d);
      outflows += dayOutflows(cats, sub.values, d);
      net += dayNet(cats, sub.values, d);
    }
    // Line items are matched by LABEL, exactly like the consolidation itself,
    // so an entity on another template still lands on the right row.
    const byLabel = sumsByLabel(template, sub, selection);
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
    for (const d of selection) s += fn(numCats, values, d);
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
      const total = categorySum(current.values, catIdx, selection);
      const prev = categorySum(prior.values, catIdx, selection);
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
  /** Restrict the breakdown to these entities (role scoping / country filter). */
  onlyEntities?: string[],
): DayContribution[] {
  const templates = loadTemplates();
  const out: DayContribution[] = [];
  for (const entity of reportedEntities(week, onlyEntities)) {
    const template = templateForEntity(templates, entity.name);
    if (!template) continue;
    const settings = settingsForEntity(entity.name, base);
    const sub = peekSubmission(entity.name, week, template);
    const prior = getPriorValues(entity.name, week, template);
    const cats = gridCatCount(template, sub);

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
      variancePct: priorNet === null ? null : pctChange(net, priorNet),
      lines,
    });
  }
  return out.sort((a, b) => b.varianceAbs - a.varianceAbs);
}

// ---------------------------------------------------------------------------
// Category × country matrix: the outlook chart's numbers, read the other way.
// ---------------------------------------------------------------------------

/** One line item of the matrix, with its value per country. */
export interface MatrixRow {
  label: string;
  /** Section band the line item belongs to, if the template groups them. */
  group?: string;
  /** Value per country, EUR thousands — countries with nothing are 0. */
  byCountry: Record<string, number>;
  total: number;
}

export interface CategoryCountryMatrix {
  /** Column order: the countries in scope, biggest absolute total first. */
  countries: string[];
  rows: MatrixRow[];
  /** Column totals, in `countries` order. */
  countryTotals: Record<string, number>;
  grandTotal: number;
}

/**
 * The same aggregation the four-week outlook plots, pivoted: line items down
 * the rows, countries across the columns. Built from `peekSubmission` per
 * entity — the identical read the chart and every forecast screen use — so
 * the matrix can never show a different number from the chart beside it.
 *
 * `dayIdx` narrows it to a single period, which is what clicking the chart
 * does; omit it for the whole horizon.
 */
export function categoryCountryMatrix(
  week: string,
  display: ForecastTemplate,
  onlyEntities?: string[],
  days?: number[] | null,
): CategoryCountryMatrix {
  const templates = loadTemplates();
  const periods = periodsOf(display).count;
  const selection = selectedPeriods(periods, days);
  // Only reported forecasts: a country column of numbers nobody has submitted
  // is a column of guesses, and it made the matrix disagree with the cycle
  // progress modal sitting one click away.
  const entities = reportedEntities(week, onlyEntities);
  const countries = entities.map((e) => e.name);

  // Line items are matched by LABEL, exactly like `consolidatedValues`, so an
  // entity on another template still lands on the right row.
  const perCountry = new Map<string, Map<string, number>>();
  for (const e of entities) {
    const template = templateForEntity(templates, e.name) ?? display;
    const sub = peekSubmission(e.name, week, template);
    perCountry.set(e.name, sumsByLabel(template, sub, selection));
  }

  const countryTotals: Record<string, number> = {};
  countries.forEach((c) => (countryTotals[c] = 0));

  const rows: MatrixRow[] = display.categories
    .filter((cat) => !cat.subtotal)
    .map((cat) => {
      const key = cat.label.trim().toLowerCase();
      const byCountry: Record<string, number> = {};
      let total = 0;
      for (const country of countries) {
        const v = perCountry.get(country)?.get(key) ?? 0;
        byCountry[country] = v;
        countryTotals[country] += v;
        total += v;
      }
      return { label: cat.label, group: cat.group, byCountry, total };
    });

  return {
    countries,
    rows,
    countryTotals,
    grandTotal: Object.values(countryTotals).reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------------------
// Cycles, wired to the live submission data.
// ---------------------------------------------------------------------------

/**
 * What a cycle contains, resolved against the real entities and templates.
 *
 * `cycleService` deliberately stays free of the entity layer, so this is where
 * the two meet — and it is the only place the Forecast Cycles screen, the
 * close-cycle dialog and the exports read their counts from, so they cannot
 * disagree about how many forecasts a cycle collected.
 */
export function cycleOverview(cycle: Cycle): CycleSummary {
  const templates = loadTemplates();
  const overrides = loadApprovals(cycle.id);
  return cycleSummary(
    cycle,
    listEntities(),
    (entity) => templateForEntity(templates, entity),
    (entity, week, templateId) => entityStatus(entity, week, templateId, overrides),
  );
}
