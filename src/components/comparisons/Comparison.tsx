import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Chart } from '../common/Chart';
import { ErrorView, LoadingView } from '../common/Async';
import { useApi } from '../../hooks/useApi';
import {
  getCycles,
  getEntities,
  getSettings,
  getTemplates,
  getVariances,
} from '../../api/resources';
import { generateGridValues, seedFor, STANDARD_TEMPLATE_ID } from '../../data/demoData';
import { currentWeekKey, HORIZON_DAYS, prevWeekKey } from '../../data/periods';

const TABS = ['Daily Variance', 'By Entity', 'By Category'] as const;

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

/** Forecast-vs-forecast comparison with variance drill-down. */
export function Comparison() {
  const [tab, setTab] = useState(0);
  const [pairIdx, setPairIdx] = useState(0);
  const { data, error, loading, reload } = useApi(() =>
    Promise.all([getCycles(), getEntities(), getVariances(), getSettings(), getTemplates()]),
  );

  // Category totals (current vs prior week) from the consolidated demo data.
  const categories = useMemo(() => {
    const templates = data?.[4] ?? [];
    const std = templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0];
    if (!std) return [];
    const week = currentWeekKey();
    const prevKey = prevWeekKey(week);
    const current = generateGridValues(std.categories, week, seedFor(`Consolidated:${week}`), false)
      .values;
    const prior = generateGridValues(
      std.categories,
      prevKey,
      seedFor(`Consolidated:${prevKey}`),
      false,
    ).values;
    return std.categories.map((cat, catIdx) => {
      let cur = 0;
      let pri = 0;
      for (let i = 0; i < HORIZON_DAYS; i++) {
        cur += current[`${catIdx}-${i}`] || 0;
        pri += prior[`${catIdx}-${i}`] || 0;
      }
      const pct = ((cur - pri) / Math.max(Math.abs(pri), 1)) * 100;
      return { label: cat.label, current: cur, prior: pri, pct };
    });
  }, [data]);

  if (error)
    return <ErrorView crumb="Analysis" title="Forecast vs Forecast" message={error} onRetry={reload} />;
  if (loading || !data) return <LoadingView crumb="Analysis" title="Forecast vs Forecast" />;

  const [cycles, entities, variances, settings] = data;

  // Consecutive cycle pairs from the store drive the selector.
  const pairs: { label: string; current: string; prior: string }[] = [];
  for (let i = 0; i < cycles.length - 1; i++) {
    pairs.push({
      label: `${cycles[i].id} vs ${cycles[i + 1].id}`,
      current: cycles[i].id,
      prior: cycles[i + 1].id,
    });
  }
  const pair = pairs[Math.min(pairIdx, Math.max(pairs.length - 1, 0))];

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
          <div className="comparison-tabs">
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
            <div className="panel-body">
              <Chart
                variant="compare"
                seed={pairIdx}
                legend={pair ? `- - - ${pair.prior} | ─── ${pair.current}` : undefined}
              />
            </div>
          )}

          {tab === 1 && (
            <div className="panel-body no-pad">
              <table>
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th className="num">Prior (€k)</th>
                    <th className="num">Current (€k)</th>
                    <th className="num">Δ %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map((e) => {
                    const prior = Math.round(e.total / (1 + e.delta / 100));
                    return (
                      <tr key={e.name}>
                        <td>
                          <strong>{e.name}</strong>
                        </td>
                        <td className="num">{prior.toLocaleString()}</td>
                        <td className="num">{e.total.toLocaleString()}</td>
                        <td className="num">
                          <DeltaCell pct={e.delta} />
                        </td>
                        <td>
                          <StatusPill status={e.status} />
                        </td>
                      </tr>
                    );
                  })}
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
                  {categories.map((c) => (
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
          <span className="tag">±{settings.varianceThreshold}% threshold</span>
        </div>
        <div className="panel">
          <div className="panel-body no-pad">
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
                {variances.map((v, i) => {
                  const pct = ((v.current - v.prior) / Math.max(Math.abs(v.prior), 1)) * 100;
                  return (
                    <tr key={i}>
                      <td>
                        <strong>{v.ent}</strong>
                      </td>
                      <td className="text-dim">{v.cat}</td>
                      <td className="text-dim">{v.day}</td>
                      <td className="num">{v.prior.toLocaleString()}</td>
                      <td className="num">{v.current.toLocaleString()}</td>
                      <td className="num">
                        <DeltaCell pct={pct} />
                      </td>
                      <td className="text-dim" style={{ fontSize: 12, maxWidth: 280 }}>
                        {v.comment || <StatusPill status="pending" label="commentary needed" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
