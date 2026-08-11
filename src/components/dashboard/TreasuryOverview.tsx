import { useEffect, useMemo, useState } from 'react';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from '../submissions/ForecastGrid';
import { CycleProgressModal } from './CycleProgressModal';
import { AttentionModal } from './AttentionModal';
import { ConsolidatedModal } from './ConsolidatedModal';
import { DayBreakdownModal } from './DayBreakdownModal';
import { CountryMatrix } from './CountryMatrix';
import { MultiSelect } from '../common/MultiSelect';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listEntities, seedUsers } from '../../data/appData';
import {
  periodsOf,
  rollShift,
  shiftWeeks,
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
import { consolidatedValues } from '../../data/submissionService';
import { currentUser } from '../../data/session';
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

/** How many prior cycles can be overlaid — beyond four there is no overlap. */
const COMPARE_DEPTH = 4;

/** Distinct from the live series so an overlay is never read as this cycle. */
const OVERLAY_COLORS = ['#8e92a3', '#7a5ea8', '#4f8a8b', '#a86b3c'];

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
  const settings = useMemo(() => loadSettings(DEFAULT_SETTINGS), []);
  const overrides = loadApprovals(cycleId);
  const allTemplates = useMemo(() => loadTemplates(), []);

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
  const countries = useMemo(
    () => (countryFilter.length > 0 ? countryFilter : scopedNames),
    [countryFilter, scopedNames],
  );

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
   * The period a single click on the chart has filtered the page to. Null is
   * the whole horizon. Everything downstream — stat boxes, matrix, modals —
   * reads this, so one click narrows the page rather than one panel.
   */
  const [period, setPeriod] = useState<number | null>(null);

  const [statModal, setStatModal] = useState<StatModal>(null);
  const [consolidatedOpen, setConsolidatedOpen] = useState(false);
  /** Day the forecast-vs-forecast breakdown is open on (double click). */
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  /** Prior cycles overlaid on the outlook chart (forecast vs forecast). */
  const [compareWeeks, setCompareWeeks] = useState<string[]>([]);
  /** The consolidated table below, folded away until it is asked for. */
  const [tableOpen, setTableOpen] = useState(false);

  const dayLabels = useMemo(() => templateDayLabels(template, week), [template, week]);
  const numCats = template?.categories.length ?? 0;
  const numPeriods = periodsOf(template).count;
  // Clicking a column of one template's horizon means nothing on another's.
  useEffect(() => setPeriod(null), [templateId]);

  const periodLabel =
    period !== null && dayLabels[period]
      ? `${dayLabels[period].dow} ${dayLabels[period].dm}`
      : null;

  // ---- One rollup drives the stat boxes AND both progress modals ----------
  const regions = useMemo(
    () => cycleProgress(week, overrides, countries, period),
    // overrides is a fresh object per render; its cycle id is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [week, cycleId, allTemplates, countries, period],
  );
  const countryRows = useMemo(() => allCountries(regions), [regions]);
  const received = countryRows.filter((c) => c.received).length;
  const awaiting = countryRows.filter((c) => c.received && !c.approved).length;

  const attention = useMemo(
    () => attentionRows(week, settings, countries, period),
    [week, settings, countries, period],
  );
  const openComments = attention.reduce((s, r) => s + r.needCommentary, 0);

  // ---- 4-week outlook, consolidated across the selected countries ---------
  // Straight off `consolidatedValues`, which reads every entity's stored
  // submission through `peekSubmission` — the same read the forecast screens
  // edit. The outlook is an aggregation OF the forecasts, never a forecast of
  // its own, so a number changed in a grid moves this chart.
  const outlookSeries: ChartSeries[] = useMemo(() => {
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
  }, [template, week, dayLabels, numCats, countries]);

  // Forecast vs forecast, folded into the same axes: each selected cycle adds
  // its cumulative net line, aligned on the calendar days the two share.
  const compareOptions = useMemo(
    () =>
      Array.from({ length: COMPARE_DEPTH }, (_v, i) => {
        const key = shiftWeeks(week, -(i + 1));
        return { week: key, label: weekLabelShort(key) };
      }),
    [week],
  );
  const overlaySeries: ChartSeries[] = useMemo(() => {
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
  }, [compareWeeks, template, dayLabels, numCats, numPeriods, compareOptions, countries]);

  const matrix = useMemo(
    () => (template ? categoryCountryMatrix(week, template, countries, period) : null),
    [template, week, countries, period],
  );

  // The consolidated four-week outlook as a grid, on the same filters.
  const consolidated = useMemo(
    () => (template ? consolidatedValues(week, template, countries) : null),
    [template, week, countries],
  );

  const toggleCompare = (key: string) =>
    setCompareWeeks((prev) =>
      prev.includes(key) ? prev.filter((w) => w !== key) : [...prev, key],
    );

  // ---- Actions the progress modals hand back ------------------------------
  const openForecast = (target: { entity: string; templateId?: string; focusCell?: string }) =>
    onOpenSubmission?.({ ...target, week });

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
  };

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
          {/* Only present once the chart has been clicked, so it is a state
              to clear rather than a control to set. */}
          {period !== null && (
            <div className="filter-field">
              <span className="filter-field-label">Period</span>
              <button className="filter-chip on period-chip" onClick={() => setPeriod(null)}>
                {periodLabel} <span aria-hidden="true">×</span>
                <span className="sr-only">Clear the period filter</span>
              </button>
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
            <h3>4-Week Outlook</h3>
            <div className="row-flex">
              <span className="panel-unit">€k</span>
              <button
                className="btn btn-ghost"
                data-tour="open-consolidated"
                onClick={() => setConsolidatedOpen(true)}
              >
                Consolidated Forecast
              </button>
            </div>
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
              activeIndex={period}
              onPointClick={(i) => setPeriod((prev) => (prev === i ? null : i))}
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
      {consolidatedOpen && template && (
        <ConsolidatedModal
          open
          week={week}
          template={template}
          onlyEntities={countries}
          dayIdx={period}
          onClose={() => setConsolidatedOpen(false)}
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
