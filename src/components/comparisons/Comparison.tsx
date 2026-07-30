import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import {
  dayInflows,
  dayNet,
  dayOutflows,
  runningBalance,
  type GridValues,
} from '../submissions/gridMath';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listCycles, listEntities } from '../../data/appData';
import {
  currentWeekKey,
  periodsOf,
  prevWeekKey,
  rollShift,
  shiftWeeks,
  templateDayLabels,
  weekLabelShort,
} from '../../data/periods';
import {
  consolidatedValues,
  largestVariances,
  mergedEntityStatus,
  peekSubmission,
} from '../../data/submissionService';
import {
  loadApprovals,
  loadCycles,
  loadSettings,
  loadTemplates,
} from '../../storage/localStorage';
import { DEFAULT_SETTINGS } from '../settings/defaults';

const TABS = ['Daily Variance', 'By Entity', 'By Category'] as const;

type Metric = 'net' | 'balance' | 'inflows' | 'outflows';

const METRIC_LABELS: Record<Metric, string> = {
  net: 'Net Cash Flow',
  balance: 'Running Balance',
  inflows: 'Inflows',
  outflows: 'Outflows',
};

function DeltaCell({ pct }: { pct: number }) {
  const cls = pct > 0 ? 'up' : 'down';
  const sign = pct > 0 ? '+' : '';
  return (
    <span className={`delta ${cls}`}>
      {sign}
      {pct.toFixed(1)}%
    </span>
  );
}

/** Sum the net position over one submission's full horizon. */
function horizonTotal(values: GridValues, numCats: number, periods: number): number {
  let s = 0;
  for (let d = 0; d < periods; d++) s += dayNet(numCats, values, d);
  return s;
}

/**
 * Forecast-vs-forecast comparison. Every number on this screen derives from
 * the same stored submissions the Submission screen edits (with deterministic
 * demo data standing in for entities that have no stored submission yet), so
 * editing a forecast is immediately reflected here.
 */
interface ComparisonProps {
  /**
   * Restrict every view to these entities (approver / submitter scoping);
   * undefined = the whole group, which is what Treasury sees.
   */
  scopeEntities?: string[];
}

export function Comparison({ scopeEntities }: ComparisonProps = {}) {
  const [tab, setTab] = useState(0);
  const [metric, setMetric] = useState<Metric>('net');
  const settings = useMemo(() => loadSettings(DEFAULT_SETTINGS), []);
  const template = useMemo(() => {
    const templates = loadTemplates();
    return templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0];
  }, []);

  // Comparable week pairs: this week vs last week, and the three before it.
  const pairs = useMemo(() => {
    const current = currentWeekKey();
    return [0, 1, 2, 3].map((back) => {
      const cur = shiftWeeks(current, -back);
      const prev = prevWeekKey(cur);
      return {
        label: `${weekLabelShort(cur)} vs ${weekLabelShort(prev)}`,
        current: cur,
        prior: prev,
      };
    });
  }, []);
  const [pairIdx, setPairIdx] = useState(0);
  const pair = pairs[Math.min(pairIdx, pairs.length - 1)];

  const activeCycleId = useMemo(() => {
    const cycles = loadCycles(listCycles());
    return (cycles.find((c) => c.status === 'submitted') ?? cycles[0])?.id ?? 'CW-2026-21';
  }, []);
  const overrides = useMemo(() => loadApprovals(activeCycleId), [activeCycleId]);

  const numCats = template?.categories.length ?? 0;
  // Every aggregate on this screen spans the display template's own horizon —
  // a template declaring 30 periods used to have its last 10 columns ignored.
  const periods = useMemo(() => periodsOf(template).count, [template]);
  const shift = useMemo(() => rollShift(template), [template]);

  // Consolidated grids for the selected pair (live: recomputed per render).
  const current = useMemo(
    () => (template ? consolidatedValues(pair.current, template, scopeEntities) : null),
    [template, pair, scopeEntities],
  );
  const priorData = useMemo(
    () => (template ? consolidatedValues(pair.prior, template, scopeEntities) : null),
    [template, pair, scopeEntities],
  );

  const dayLabels = useMemo(() => templateDayLabels(template, pair.current), [template, pair]);

  // ---- Daily Variance chart: current horizon vs the prior forecast's view
  // of the same calendar days (horizons roll by one week = 5 working days;
  // the prior forecast said nothing about the final 5 days → gap). ----
  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!current || !priorData) return [];
    const metricAt = (v: GridValues, bal: number, d: number): number => {
      switch (metric) {
        case 'net':
          return dayNet(numCats, v, d);
        case 'balance':
          return runningBalance(numCats, v, bal, d);
        case 'inflows':
          return dayInflows(numCats, v, d);
        case 'outflows':
          return dayOutflows(numCats, v, d);
      }
    };
    const cur = Array.from({ length: periods }, (_v, d) =>
      metricAt(current.values, current.startingBalance ?? 0, d),
    );
    const prev = Array.from({ length: periods }, (_v, d) => {
      const shifted = d + shift;
      if (shifted >= periods) return null;
      return metricAt(priorData.values, priorData.startingBalance ?? 0, shifted);
    });
    return [
      {
        label: `${weekLabelShort(pair.prior)} (prior)`,
        values: prev,
        color: CHART_COLORS.muted,
        kind: 'line',
        dashed: true,
      },
      {
        label: `${weekLabelShort(pair.current)} (current)`,
        values: cur,
        color: CHART_COLORS.accent,
        kind: 'line',
      },
    ];
  }, [current, priorData, metric, numCats, pair, periods, shift]);

  // ---- By Entity: full-horizon net totals per entity, current vs prior. ----
  const entityRows = useMemo(() => {
    if (!template) return [];
    const scoped = scopeEntities
      ? listEntities().filter((e) => scopeEntities.includes(e.name))
      : listEntities();
    return scoped.map((e) => {
      const cur = horizonTotal(
        peekSubmission(e.name, pair.current, template).values,
        numCats,
        periods,
      );
      const prev = horizonTotal(
        peekSubmission(e.name, pair.prior, template).values,
        numCats,
        periods,
      );
      const pct = ((cur - prev) / Math.max(Math.abs(prev), 1)) * 100;
      return {
        name: e.name,
        prior: prev,
        current: cur,
        pct,
        status: mergedEntityStatus(e, pair.current, template.id, overrides),
      };
    });
  }, [template, pair, numCats, periods, overrides, scopeEntities]);

  // ---- By Category: consolidated per-category totals, current vs prior. ----
  const categoryRows = useMemo(() => {
    if (!template || !current || !priorData) return [];
    return template.categories.map((cat, catIdx) => {
      let cur = 0;
      let prev = 0;
      for (let d = 0; d < periods; d++) {
        cur += current.values[`${catIdx}-${d}`] || 0;
        prev += priorData.values[`${catIdx}-${d}`] || 0;
      }
      const pct = ((cur - prev) / Math.max(Math.abs(prev), 1)) * 100;
      return { label: cat.label, current: cur, prior: prev, pct };
    });
  }, [template, current, priorData, periods]);

  // ---- Largest cell-level variances across all entities (live). ----
  const varianceRows = useMemo(
    () => (template ? largestVariances(pair.current, template, settings, 12, scopeEntities) : []),
    [template, pair, settings, scopeEntities],
  );

  if (!template) {
    return (
      <div className="view active">
        <TopBar crumb="Analysis" title="Forecast vs Forecast" />
        <div className="content">
          <div className="panel">
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No forecast templates available. Upload one under Admin → Templates.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view active">
      <TopBar
        crumb="Analysis"
        title="Forecast vs Forecast"
        actions={
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={pairIdx}
            onChange={(e) => setPairIdx(Number(e.target.value))}
            aria-label="Weeks to compare"
          >
            {pairs.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        }
      />
      <div className="content">
        <div className="panel">
          <div className="comparison-tabs" data-tour="comparison-tabs">
            {TABS.map((label, i) => (
              <div
                key={label}
                className={`tab${tab === i ? ' active' : ''}`}
                onClick={() => setTab(i)}
              >
                {label}
              </div>
            ))}
          </div>

          {tab === 0 && (
            <>
              <div className="chart-controls">
                <span className="grid-info">
                  {scopeEntities ? 'Your entities' : 'Consolidated · all entities'} · €k
                  {shift > 0 && ` · last ${shift} periods have no prior forecast`}
                </span>
                <select
                  className="form-select"
                  style={{ width: 'auto', marginLeft: 'auto', padding: '5px 10px' }}
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as Metric)}
                  aria-label="Chart metric"
                >
                  {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
                    <option key={m} value={m}>
                      {METRIC_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <Chart labels={dayLabels.map((dl) => dl.dm)} series={chartSeries} unit="k" />
            </>
          )}

          {tab === 1 && (
            <div className="panel-body no-pad">
              <table>
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th className="num">Prior Net (€k)</th>
                    <th className="num">Current Net (€k)</th>
                    <th className="num">Δ %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entityRows.map((e) => (
                    <tr key={e.name}>
                      <td>
                        <strong>{e.name}</strong>
                      </td>
                      <td className="num">{Math.round(e.prior).toLocaleString()}</td>
                      <td className="num">{Math.round(e.current).toLocaleString()}</td>
                      <td className="num">
                        <DeltaCell pct={e.pct} />
                      </td>
                      <td>
                        <StatusPill status={e.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 2 && (
            <div className="panel-body no-pad">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Prior (€k)</th>
                    <th className="num">Current (€k)</th>
                    <th className="num">Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map((c) => (
                    <tr key={c.label}>
                      <td>
                        <strong>{c.label}</strong>
                      </td>
                      <td className="num">{c.prior.toLocaleString()}</td>
                      <td className="num">{c.current.toLocaleString()}</td>
                      <td className="num">
                        <DeltaCell pct={c.pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section-header">
          <h2>Largest Variances</h2>
          <span className="tag">
            ±{settings.varianceThreshold}% threshold · {weekLabelShort(pair.current)} vs{' '}
            {weekLabelShort(pair.prior)}
          </span>
        </div>
        <div className="panel">
          <div className="panel-body no-pad">
            {varianceRows.length === 0 ? (
              <div className="empty-state">
                <div className="ic">✓</div>
                <p>No cell breaches the variance threshold for this pair of weeks.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Category</th>
                    <th>Day</th>
                    <th className="num">Prior (€k)</th>
                    <th className="num">Current (€k)</th>
                    <th className="num">Δ %</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {varianceRows.map((v, i) => (
                    <tr key={i}>
                      <td>
                        <strong>{v.entity}</strong>
                      </td>
                      <td className="text-dim">{v.category}</td>
                      <td className="text-dim">
                        Day {v.dayIdx + 1} · {dayLabels[v.dayIdx]?.dm ?? ''}
                      </td>
                      <td className="num">{v.prior.toLocaleString()}</td>
                      <td className="num">{v.current.toLocaleString()}</td>
                      <td className="num">
                        <DeltaCell pct={v.pct} />
                      </td>
                      <td className="text-dim" style={{ fontSize: 12, maxWidth: 280 }}>
                        {v.comment || <StatusPill status="pending" label="commentary needed" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
