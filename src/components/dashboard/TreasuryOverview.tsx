import { useEffect, useMemo, useState } from 'react';
import { Chart, CHART_COLORS, OVERLAY_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from '../submissions/ForecastGrid';
import { categoryGroups } from '../submissions/gridMath';
import { CycleProgressModal } from './CycleProgressModal';
import { AttentionModal } from './AttentionModal';
import { DayBreakdownModal } from './DayBreakdownModal';
import { CountryMatrix } from './CountryMatrix';
import { MultiSelect } from '../common/MultiSelect';
import { countryCode } from '../../data/countryCodes';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listEntities, seedUsers } from '../../data/appData';
import { useDataVersion } from '../../data/useDataVersion';
import { listCycles, loadChasers, markChaserSent } from '../../data/cycleService';
import {
  horizonWeeks,
  periodsOf,
  rollShift,
  templateDayLabels,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import {
  allCountries,
  attentionRows,
  categoryCountryMatrix,
  cycleProgress,
  filterRegions,
} from '../../data/dashboardService';
import {
  consolidatedValues,
  entityStatus,
  templateForEntity,
} from '../../data/submissionService';
import { ForecastPreviewModal } from '../submissions/ForecastPreviewModal';
import { currentUser, permissionsFor } from '../../data/session';
import { loadApprovals, loadSettings, loadTemplates, loadUsers } from '../../storage/localStorage';
import { dayInflows, dayNet, dayOutflows } from '../submissions/gridMath';
import { emailForName, mailDomain, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { Entity } from '../../types';
import type { SubmissionTarget } from '../submissions/Submission';

interface TreasuryOverviewProps {
  week: string;
  cycleId: string;
  /** Deadline shown on the progress modals. */
  cycleCloses?: string;
  /**
   * Entities this user may see. Treasury omits it (the whole group); an
   * approver passes their own countries, and every aggregate below — stat
   * boxes, chart, matrix, table, modals — is built from that same list.
   */
  scopeEntities?: string[];
  onOpenSubmission?: (target: SubmissionTarget) => void;
}

/** Which stat box (if any) has its modal open. */
type StatModal = 'received' | 'awaiting' | 'attention' | null;

/**
 * Which forecasts the page is built from.
 *
 * The group position is what has been REPORTED, but "reported" covers two very
 * different things: a forecast an approver has signed off, and one that has
 * only been submitted and could still change. Treasury needs to see the total
 * both ways — with and without the numbers still under review.
 */
type StatusFilter = 'all' | 'approved' | 'submitted';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'submitted', label: 'Awaiting approval' },
];

/** A country's forecast opened in a dialog from one of the modals above. */
interface PreviewTarget {
  entity: string;
  templateId?: string;
  /** Cell to raise the commentary-request dialog on, when arriving from a
   *  row that named one ("this country's largest unexplained move"). */
  focusCell?: string;
}

/** How many prior cycles can be overlaid — beyond four there is no overlap. */
const COMPARE_DEPTH = 4;

/**
 * A running total of a series, carrying gaps through: once a prior forecast's
 * horizon runs out there is nothing left to accumulate, and drawing a flat
 * line from that point would read as "no movement" rather than "no data".
 */
function cumulative(values: (number | null)[]): (number | null)[] {
  let sum = 0;
  return values.map((v) => (v === null ? null : (sum += v)));
}

/**
 * The treasury view of a cycle: three numbers, the group outlook, the same
 * data as a country matrix beside it, and the consolidated forecast beneath.
 *
 * It lives in its own component because it is not treasury's alone any more —
 * an approver gets the identical page under their checklist, scoped to their
 * own countries. Two copies of "the group position" would drift apart within
 * a release, so there is one, and `scopeEntities` is the only difference
 * between what the two roles see.
 */
export function TreasuryOverview({
  week,
  cycleId,
  cycleCloses,
  scopeEntities,
  onOpenSubmission,
}: TreasuryOverviewProps) {
  // Every rollup below re-reads when anything is written to storage, so a
  // decision taken on this page refreshes the panels beside it rather than
  // leaving them asserting the state from before the click.
  const dataVersion = useDataVersion();
  /** Treasury and approvers may ask a submitter about a cell from the dialog. */
  const canAsk = useMemo(() => permissionsFor(currentUser()).canRequestCommentary, []);
  const settings = useMemo(() => {
    void dataVersion;
    return loadSettings(DEFAULT_SETTINGS);
  }, [dataVersion]);
  const overrides = loadApprovals(cycleId);
  const allTemplates = useMemo(() => {
    void dataVersion;
    return loadTemplates();
  }, [dataVersion]);

  // Every country in scope, in entity order — the selector's full menu.
  const scopedNames = useMemo(() => {
    const names = listEntities().map((e) => e.name);
    return scopeEntities ? names.filter((n) => scopeEntities.includes(n)) : names;
  }, [scopeEntities]);

  // ---- Filters: which countries, which template, which period -------------
  /**
   * The country filter. EMPTY MEANS EVERY COUNTRY IN SCOPE — an unset filter,
   * not an empty page. Nothing else in here has to know that: `countries`
   * below resolves it once and every aggregate reads that.
   */
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  // Entities can be renamed or reassigned under the user; drop what no longer
  // exists rather than filtering the page against a country that is gone.
  useEffect(() => {
    setCountryFilter((prev) => {
      const kept = prev.filter((n) => scopedNames.includes(n));
      return kept.length === prev.length ? prev : kept;
    });
  }, [scopedNames]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  /** Where each country's forecast stands this cycle, for the filter and the flags. */
  const statusByCountry = useMemo(() => {
    void dataVersion;
    const templates = loadTemplates();
    const map = new Map<string, ReturnType<typeof entityStatus>>();
    for (const name of scopedNames) {
      const templateId = templateForEntity(templates, name)?.id ?? '';
      map.set(name, entityStatus(name, week, templateId, overrides));
    }
    return map;
    // overrides is a fresh object per render; its cycle id is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedNames, week, cycleId, dataVersion]);

  /**
   * Countries whose forecast is in but NOT approved — the numbers in the totals
   * that an approver could still send back. Flagged beside the filter rather
   * than buried in a modal, because it qualifies everything else on the page.
   */
  const unapproved = useMemo(
    () => scopedNames.filter((n) => statusByCountry.get(n) === 'submitted'),
    [scopedNames, statusByCountry],
  );

  const countries = useMemo(() => {
    const picked = countryFilter.length > 0 ? countryFilter : scopedNames;
    if (statusFilter === 'all') return picked;
    return picked.filter((n) => {
      const status = statusByCountry.get(n);
      return statusFilter === 'approved'
        ? status === 'approved' || status === 'consolidated'
        : status === 'submitted';
    });
  }, [countryFilter, scopedNames, statusFilter, statusByCountry]);

  const [templateId, setTemplateId] = useState(
    () =>
      (allTemplates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? allTemplates[0])?.id ?? '',
  );
  // Display template for every consolidated figure; each entity is still read
  // on whatever template Legal Entity Setup gives it.
  const template = useMemo(
    () => allTemplates.find((t) => t.id === templateId) ?? allTemplates[0] ?? null,
    [allTemplates, templateId],
  );

  /**
   * The periods a click on the chart has filtered the page to. Empty is the
   * whole horizon. Everything downstream — stat boxes, matrix, consolidated
   * table — reads this, so a click narrows the page rather than one panel.
   *
   * A plain click replaces the selection; ctrl (or cmd) adds to it, so several
   * days that are nowhere near each other — three month-ends, say — can be
   * looked at as one number.
   */
  const [periods, setPeriods] = useState<number[]>([]);

  const [statModal, setStatModal] = useState<StatModal>(null);
  /** The forecast being read in a dialog over this page, if any. */
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  /** Day the forecast-vs-forecast breakdown is open on (double click). */
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  /** Prior cycles overlaid on the outlook chart (forecast vs forecast). */
  const [compareWeeks, setCompareWeeks] = useState<string[]>([]);
  /** The consolidated table below, folded away until it is asked for. */
  const [tableOpen, setTableOpen] = useState(false);
  /**
   * Sections of the consolidated table that are folded to their total. It
   * opens fully collapsed: the group position is a section-level question, and
   * twelve line items across twenty days is not what you want to meet first.
   * `null` means "not decided yet" and resolves to every section on first
   * render, so a template with different sections still starts folded.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number> | null>(null);

  const dayLabels = useMemo(() => templateDayLabels(template, week), [template, week]);
  const numCats = template?.categories.length ?? 0;
  const numPeriods = periodsOf(template).count;
  // Clicking a column of one template's horizon means nothing on another's.
  useEffect(() => setPeriods([]), [templateId]);

  const labelFor = (i: number) =>
    dayLabels[i] ? `${dayLabels[i].dow} ${dayLabels[i].dm}` : `Day ${i + 1}`;
  const sortedPeriods = useMemo(() => [...periods].sort((a, b) => a - b), [periods]);
  const periodLabel =
    sortedPeriods.length === 0
      ? null
      : sortedPeriods.length === 1
        ? labelFor(sortedPeriods[0])
        : `${sortedPeriods.length} periods`;

  /** Plain click replaces the selection; ctrl/cmd click adds to or removes from it. */
  const pickPeriod = (i: number, additive: boolean) =>
    setPeriods((prev) => {
      if (!additive) return prev.length === 1 && prev[0] === i ? [] : [i];
      return prev.includes(i) ? prev.filter((p) => p !== i) : [...prev, i];
    });

  // ---- One rollup drives the stat boxes AND both progress modals ----------
  const regions = useMemo(
    () => {
      void dataVersion;
      return cycleProgress(week, overrides, countries, periods);
    },
    // overrides is a fresh object per render; its cycle id is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [week, cycleId, allTemplates, countries, periods, dataVersion],
  );
  const countryRows = useMemo(() => allCountries(regions), [regions]);
  const received = countryRows.filter((c) => c.received).length;
  const awaiting = countryRows.filter((c) => c.received && !c.approved).length;

  const attention = useMemo(
    () => {
      void dataVersion;
      return attentionRows(week, settings, countries, periods);
    },
    [week, settings, countries, periods, dataVersion],
  );
  const openComments = attention.reduce((s, r) => s + r.needCommentary, 0);

  // ---- 4-week outlook, consolidated across the selected countries ---------
  // Straight off `consolidatedValues`, which reads every entity's stored
  // submission through `peekSubmission` — the same read the forecast screens
  // edit. The outlook is an aggregation OF the forecasts, never a forecast of
  // its own, so a number changed in a grid moves this chart.
  const outlookSeries: ChartSeries[] = useMemo(() => {
    void dataVersion;
    if (!template) return [];
    const { values } = consolidatedValues(week, template, countries);
    return [
      {
        label: 'Inflows',
        values: dayLabels.map((_dl, d) => dayInflows(numCats, values, d)),
        color: CHART_COLORS.green,
        kind: 'bar',
      },
      {
        label: 'Outflows',
        values: dayLabels.map((_dl, d) => dayOutflows(numCats, values, d)),
        color: CHART_COLORS.red,
        kind: 'bar',
      },
      {
        // Cumulative, not per day: what treasury is watching over four weeks
        // is where the position ENDS UP, and a daily net line answered that
        // only by mental arithmetic across twenty columns.
        label: 'Net Cash Flow · cumulative',
        values: cumulative(dayLabels.map((_dl, d) => dayNet(numCats, values, d))),
        color: CHART_COLORS.accent,
        kind: 'line',
      },
    ];
  }, [template, week, dayLabels, numCats, countries, dataVersion]);

  // Forecast vs forecast, folded into the same axes: each selected cycle adds
  // its cumulative net line, aligned on the calendar days the two share.
  /**
   * The cycles this forecast can be compared against: the COMPARE_DEPTH most
   * recent ones BEFORE the active cycle, newest first.
   *
   * Derived from the cycle list rather than by stepping back a fixed number of
   * calendar weeks, so opening a new cycle rolls the window forward — the new
   * one becomes the current forecast and the oldest option drops off — and the
   * options honour the configured cycle frequency instead of assuming weekly.
   */
  const compareOptions = useMemo(() => {
    void dataVersion;
    return listCycles()
      .filter((c) => c.weekKey < week)
      .slice(0, COMPARE_DEPTH)
      .map((c) => ({ week: c.weekKey, label: weekLabelShort(c.weekKey) }));
  }, [week, dataVersion]);

  // A compare week that has rolled out of the window must not stay selected.
  useEffect(() => {
    setCompareWeeks((prev) => {
      const available = new Set(compareOptions.map((o) => o.week));
      const kept = prev.filter((w) => available.has(w));
      return kept.length === prev.length ? prev : kept;
    });
  }, [compareOptions]);
  const overlaySeries: ChartSeries[] = useMemo(() => {
    void dataVersion;
    if (!template) return [];
    // Horizons roll forward one week per cycle, so a forecast N weeks back
    // covers this week's day d at its own day d + N·rollShift. Past that its
    // horizon ran out — a gap, not a zero.
    const step = rollShift(template);
    return compareWeeks.map((key, i) => {
      const past = consolidatedValues(key, template, countries);
      const back = compareOptions.findIndex((o) => o.week === key) + 1;
      return {
        label: `${weekLabelShort(key)} · cumulative net`,
        values: cumulative(
          dayLabels.map((_dl, d) => {
            const from = d + back * step;
            return from >= numPeriods ? null : dayNet(numCats, past.values, from);
          }),
        ),
        color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
        kind: 'line' as const,
        dashed: true,
      };
    });
  }, [compareWeeks, template, dayLabels, numCats, numPeriods, compareOptions, countries, dataVersion]);

  const matrix = useMemo(
    () => {
      void dataVersion;
      return template ? categoryCountryMatrix(week, template, countries, periods) : null;
    },
    [template, week, countries, periods, dataVersion],
  );

  // The consolidated four-week outlook as a grid, on the same filters.
  const consolidated = useMemo(
    () => {
      void dataVersion;
      return template ? consolidatedValues(week, template, countries) : null;
    },
    [template, week, countries, dataVersion],
  );

  /**
   * Sections of the consolidated table, folded unless opened. Resolving `null`
   * here rather than in state keeps "collapsed by default" true for whatever
   * sections the selected template happens to have.
   */
  const foldedGroups = useMemo(() => {
    if (collapsedGroups) return collapsedGroups;
    const count = template ? categoryGroups(template.categories).length : 0;
    return new Set(Array.from({ length: count }, (_v, i) => i));
  }, [collapsedGroups, template]);

  const toggleGroup = (groupIndex: number) =>
    setCollapsedGroups(() => {
      const next = new Set(foldedGroups);
      if (next.has(groupIndex)) next.delete(groupIndex);
      else next.add(groupIndex);
      return next;
    });

  const toggleCompare = (key: string) =>
    setCompareWeeks((prev) =>
      prev.includes(key) ? prev.filter((w) => w !== key) : [...prev, key],
    );

  // ---- Actions the progress modals hand back ------------------------------
  /**
   * Viewing a country's forecast opens it HERE, in a dialog over the list it
   * was picked from — the way an approver's checklist already opens one.
   * Navigating to the full forecast page threw away the progress list, the
   * filters and the place in it, for a forecast the reader only wanted to look
   * at. The full page is still one button away inside the dialog.
   */
  const openForecast = (target: { entity: string; templateId?: string; focusCell?: string }) =>
    setPreview({ entity: target.entity, templateId: target.templateId, focusCell: target.focusCell });

  const openFullForecast = (target: { entity: string; templateId?: string; focusCell?: string }) => {
    setPreview(null);
    onOpenSubmission?.({ ...target, week });
  };

  const sendChaser = (e: Entity) => {
    const me = currentUser();
    const domain = mailDomain(settings);
    const users = loadUsers(seedUsers());
    openEmail({
      to: [emailForName(e.submitter, users, domain), emailForName(e.approver, users, domain)],
      subject: `Reminder — ${cycleId} cash flow forecast (${e.name})`,
      body:
        `Hi ${e.submitter.split(' ')[0]}, hi ${e.approver.split(' ')[0]},\n\n` +
        `Gentle reminder that the ${e.name} cash flow forecast for cycle ` +
        `${cycleId} (${weekLabel(week)}) is still outstanding.\n` +
        `The cycle closes ${cycleCloses ?? 'soon'}.\n\n` +
        `Submit or approve it here: ${window.location.origin + window.location.pathname}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
    // Record the send so the row can say so. Opening a mail draft and leaving
    // the list unchanged gave treasury no way to tell who they had already
    // nudged, so countries were chased twice or not at all.
    markChaserSent(cycleId, e.name);
  };

  const chasers = useMemo(() => {
    void dataVersion;
    return loadChasers(cycleId);
  }, [cycleId, dataVersion]);

  return (
    <>
      {/* One filter bar for the whole block: which countries, which template,
          and whichever period the chart has been clicked down to. */}
      <div className="panel filter-panel" data-tour="overview-filters">
        <div className="filter-panel-head">
          <h3>Filter By</h3>
        </div>
        <div className="filter-row">
          <div className="filter-field">
            <span className="filter-field-label">Select Country</span>
            <MultiSelect
              ariaLabel="Select country"
              options={scopedNames}
              selected={countryFilter}
              onChange={setCountryFilter}
              emptyLabel="All countries"
              noun="countries"
              placeholder="Search countries…"
            />
          </div>
          <div className="filter-field">
            <span className="filter-field-label">Select Template</span>
            <select
              className="form-select"
              value={template?.id ?? ''}
              onChange={(e) => setTemplateId(e.target.value)}
              aria-label="Select template"
            >
              {allTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <span className="filter-field-label">Forecast Status</span>
            <div className="seg-toggle" role="group" aria-label="Filter by forecast status">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={statusFilter === o.value ? 'active' : ''}
                  aria-pressed={statusFilter === o.value}
                  onClick={() => setStatusFilter(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {/* Only present once the chart has been clicked, so it is a state
              to clear rather than a control to set. */}
          {sortedPeriods.length > 0 && (
            <div className="filter-field">
              <span className="filter-field-label">
                {sortedPeriods.length === 1 ? 'Period' : 'Periods'}
              </span>
              <button
                className="filter-chip on period-chip"
                onClick={() => setPeriods([])}
                title={sortedPeriods.map(labelFor).join(', ')}
              >
                {periodLabel} <span aria-hidden="true">×</span>
                <span className="sr-only">Clear the period filter</span>
              </button>
            </div>
          )}
          {/* Submitted but not approved: the figures are in the totals above
              and could still be sent back. Each flag filters the page to that
              country, which is the next thing you want after seeing it. */}
          {unapproved.length > 0 && (
            <div className="filter-flags" title="Submitted, not yet approved">
              {unapproved.map((name) => (
                <button
                  key={name}
                  className={`filter-flag${countryFilter.includes(name) ? ' on' : ''}`}
                  title={`${name} — submitted, awaiting approval`}
                  onClick={() =>
                    setCountryFilter((prev) =>
                      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
                    )
                  }
                >
                  <span className="filter-flag-mark" aria-hidden="true">
                    !
                  </span>
                  {countryCode(name)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Three numbers, each a door into the detail behind it. */}
      <div className="kpi-grid kpi-grid-3" data-tour="dashboard-kpis">
        <StatBox
          label="Submissions Received"
          value={`${received} / ${countryRows.length}`}
          sub={
            received === countryRows.length
              ? 'Every entity has submitted'
              : `${countryRows.length - received} still outstanding`
          }
          tone={received === countryRows.length ? 'ok' : 'warn'}
          dataTour="stat-received"
          onOpen={() => setStatModal('received')}
        />
        <StatBox
          label="Awaiting Approval"
          value={String(awaiting)}
          sub={awaiting === 0 ? 'Approval queue is clear' : 'Submitted, not yet approved'}
          tone={awaiting === 0 ? 'ok' : 'warn'}
          dataTour="stat-awaiting"
          onOpen={() => setStatModal('awaiting')}
        />
        <StatBox
          label="Requires Commentary"
          value={String(openComments)}
          sub={
            attention.length === 0
              ? periodLabel
                ? `Nothing outstanding on ${periodLabel}`
                : 'Nothing blocking cycle close'
              : `Across ${attention.length} countr${attention.length === 1 ? 'y' : 'ies'}${
                  periodLabel ? ` on ${periodLabel}` : ''
                }`
          }
          tone={openComments === 0 ? 'ok' : 'warn'}
          dataTour="stat-attention"
          onOpen={() => setStatModal('attention')}
        />
      </div>

      {/* The outlook and the same numbers as a matrix, side by side: the
          chart says WHEN the money moves, the matrix says WHO and WHAT. */}
      <div className="outlook-row">
        <div className="panel outlook-panel" data-tour="outlook-chart">
          <div className="panel-header">
            {/* The horizon follows the Settings value, so the heading has to
                as well rather than always claiming four weeks. */}
            <h3>{horizonWeeks()}-Week Outlook</h3>
            <span className="panel-unit">€k</span>
          </div>
          <div className="chart-controls compare-controls">
            <span className="grid-info">
              <strong>Compare with</strong>
            </span>
            {compareOptions.map((o) => (
              <label key={o.week} className="series-check">
                <input
                  type="checkbox"
                  checked={compareWeeks.includes(o.week)}
                  onChange={() => toggleCompare(o.week)}
                />
                {o.label}
              </label>
            ))}
          </div>
          {template ? (
            <Chart
              labels={dayLabels.map((dl) => dl.dm)}
              series={[...overlaySeries, ...outlookSeries]}
              unit="k"
              height={260}
              stacked
              // Fridays are the week-to-week reference point on a daily
              // horizon, so they are marked out rather than left to be
              // counted off in fives.
              emphasis={dayLabels.map((dl) => dl.dow === 'Fri')}
              activeIndexes={sortedPeriods}
              onPointClick={pickPeriod}
              onPointDoubleClick={setDayIdx}
            />
          ) : (
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No forecast templates available. Upload one under Admin → Templates.</p>
            </div>
          )}
        </div>

        <div className="panel matrix-panel" data-tour="outlook-matrix">
          <div className="panel-header">
            <h3>Breakdown by Category</h3>
            <span className="panel-unit">{periodLabel ? `${periodLabel} · €k` : '€k'}</span>
          </div>
          {matrix ? (
            <CountryMatrix matrix={matrix} />
          ) : (
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No forecast templates available.</p>
            </div>
          )}
        </div>
      </div>

      {/* The consolidated four-week outlook as a grid. Folded away by
          default — the same pattern as the chart on the forecast screen. */}
      <div className="panel chart-panel" data-tour="consolidated-table">
        <button
          className="panel-collapse-head"
          aria-expanded={tableOpen}
          onClick={() => setTableOpen((v) => !v)}
        >
          <span className="section-caret" aria-hidden="true">
            {tableOpen ? '▾' : '▸'}
          </span>
          <strong>Consolidated Forecast</strong>
          <span className="panel-unit">€k</span>
        </button>
        {tableOpen &&
          (template && consolidated ? (
            <div className="forecast-grid-wrap">
              <ForecastGrid
                categories={template.categories}
                layout="days-across"
                dayLabels={dayLabels}
                values={consolidated.values}
                flags={EMPTY_FLAGS}
                startingBalance={consolidated.startingBalance}
                editable={false}
                showColumnTotals={template.columnTotals === true}
                collapsedGroups={foldedGroups}
                onToggleGroup={toggleGroup}
              />
            </div>
          ) : (
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No forecast templates available.</p>
            </div>
          ))}
      </div>

      {/* ---------- Modals ---------- */}
      {statModal === 'received' && (
        <CycleProgressModal
          open
          title="Cycle Progress · Region → Country"
          subtitle={`${cycleId} · closes ${cycleCloses ?? '—'}`}
          regions={regions}
          onClose={() => setStatModal(null)}
          onView={openForecast}
          onChase={sendChaser}
          chasers={chasers}
          emptyMessage="No entities are configured yet."
        />
      )}
      {statModal === 'awaiting' && (
        <CycleProgressModal
          open
          title="Awaiting Approval"
          subtitle={`Submitted but not yet approved · ${cycleId}`}
          regions={filterRegions(regions, (c) => c.received && !c.approved)}
          onClose={() => setStatModal(null)}
          onView={openForecast}
          onChase={sendChaser}
          chasers={chasers}
          emptyMessage="Every submitted forecast has been approved."
        />
      )}
      {statModal === 'attention' && (
        <AttentionModal
          open
          rows={attention}
          subtitle={`${weekLabel(week)}${
            periodLabel ? ` · ${periodLabel} only` : ''
          } · largest unexplained move first`}
          onClose={() => setStatModal(null)}
          onOpen={(r) =>
            openForecast({ entity: r.entity, templateId: r.templateId, focusCell: r.worstCell })
          }
        />
      )}
      {dayIdx !== null && (
        <DayBreakdownModal
          open
          week={week}
          dayIdx={dayIdx}
          onlyEntities={countries}
          dayLabel={
            dayLabels[dayIdx]
              ? `${dayLabels[dayIdx].dow} ${dayLabels[dayIdx].dm}`
              : `Day ${dayIdx + 1}`
          }
          onClose={() => setDayIdx(null)}
          onOpen={openForecast}
        />
      )}
      {/* Rendered last so it sits over whichever list it was opened from, and
          closing it returns to that list rather than to a different screen. */}
      {preview && (
        <ForecastPreviewModal
          open
          entity={preview.entity}
          week={week}
          title={`${preview.entity} · ${weekLabelShort(week)}`}
          canRequestComments={canAsk}
          focusCell={preview.focusCell}
          onClose={() => setPreview(null)}
          actions={
            onOpenSubmission && (
              <button className="btn btn-primary" onClick={() => openFullForecast(preview)}>
                Open Full Forecast
              </button>
            )
          }
        />
      )}
    </>
  );
}

/** A consolidated grid has no per-cell variance flags of its own. */
const EMPTY_FLAGS: Set<string> = new Set();

/**
 * A headline number that opens its own detail. Same card as the stats it
 * replaces; the only addition is that the whole card is the button.
 */
function StatBox({
  label,
  value,
  sub,
  tone,
  dataTour,
  onOpen,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn';
  dataTour: string;
  onOpen: () => void;
}) {
  return (
    <button className={`kpi-card kpi-clickable tone-${tone}`} data-tour={dataTour} onClick={onOpen}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub text-dim">{sub}</div>
      <span className="kpi-open" aria-hidden="true">
        View →
      </span>
    </button>
  );
}
