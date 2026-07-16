import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { ErrorView, LoadingView } from '../common/Async';
import { ForecastGrid } from '../submissions/ForecastGrid';
import {
  dayInflows,
  dayNet,
  dayOutflows,
  runningBalance,
  type GridValues,
} from '../submissions/gridMath';
import { useApi } from '../../hooks/useApi';
import { getCycles, getEntities, getTemplates, updateCycle } from '../../api/resources';
import { generateGridValues, seedFor, STANDARD_TEMPLATE_ID } from '../../data/demoData';
import {
  currentWeekKey,
  dayLabelsForWeek,
  horizonDates,
  prevWeekKey,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import { exportSubmissionXlsx } from '../../utils/excel';
import type { Cycle, TemplateCategory } from '../../types';

const EMPTY_FLAGS = new Set<string>();
const CONSOLIDATED_START_BALANCE = 42000;

/** Treasury read-only consolidated view across all approved entities. */
export function Consolidated() {
  const week = currentWeekKey();
  const { data, error, loading, reload } = useApi(() =>
    Promise.all([getCycles(), getEntities(), getTemplates()]),
  );
  const [cycles, setCycles] = useState<Cycle[]>([]);
  useEffect(() => {
    if (data) setCycles(data[0]);
  }, [data]);

  const categories: TemplateCategory[] = useMemo(() => {
    const templates = data?.[2] ?? [];
    const std = templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0];
    return std?.categories ?? [];
  }, [data]);

  const dayLabels = useMemo(() => dayLabelsForWeek(week), [week]);
  const numDays = dayLabels.length;
  const numCats = categories.length;

  const values = useMemo<GridValues>(
    () =>
      numCats === 0
        ? {}
        : generateGridValues(categories, week, seedFor(`Consolidated:${week}`), false).values,
    [categories, numCats, week],
  );
  const priorValues = useMemo<GridValues>(() => {
    if (numCats === 0) return {};
    const prev = prevWeekKey(week);
    return generateGridValues(categories, prev, seedFor(`Consolidated:${prev}`), false).values;
  }, [categories, numCats, week]);

  const kpis = useMemo(() => {
    const sum = (fn: (v: GridValues, d: number) => number, v: GridValues) => {
      let s = 0;
      for (let d = 0; d < numDays; d++) s += fn(v, d);
      return s;
    };
    const inflows = sum((v, d) => dayInflows(numCats, v, d), values);
    const outflows = sum((v, d) => dayOutflows(numCats, v, d), values);
    const net = sum((v, d) => dayNet(numCats, v, d), values);
    const pInflows = sum((v, d) => dayInflows(numCats, v, d), priorValues);
    const pOutflows = sum((v, d) => dayOutflows(numCats, v, d), priorValues);
    const pNet = sum((v, d) => dayNet(numCats, v, d), priorValues);
    const pct = (cur: number, prior: number) =>
      ((cur - prior) / Math.max(Math.abs(prior), 1)) * 100;

    let minBalance = Infinity;
    let minDay = 1;
    for (let d = 0; d < numDays; d++) {
      const bal = runningBalance(numCats, values, CONSOLIDATED_START_BALANCE, d);
      if (bal < minBalance) {
        minBalance = bal;
        minDay = d + 1;
      }
    }
    return {
      inflows,
      outflows,
      net,
      inflowsDelta: pct(inflows, pInflows),
      outflowsDelta: pct(Math.abs(outflows), Math.abs(pOutflows)),
      netDelta: pct(net, pNet),
      minBalance: minBalance === Infinity ? 0 : minBalance,
      minDay,
    };
  }, [values, priorValues, numCats, numDays]);

  if (error)
    return <ErrorView crumb="Treasury" title="Consolidated Forecast" message={error} onRetry={reload} />;
  if (loading || !data) return <LoadingView crumb="Treasury" title="Consolidated Forecast" />;

  const entities = data[1];
  const activeCycle = cycles.find((c) => c.status === 'submitted');

  const fmtM = (v: number) => `€ ${(v / 1000).toFixed(1)}M`;
  const deltaPill = (v: number) => (
    <span className={`delta ${v >= 0 ? 'up' : 'down'}`}>
      {v >= 0 ? '↑' : '↓'} {Math.abs(v).toFixed(1)}%
    </span>
  );

  const closeCycle = async () => {
    if (!activeCycle) {
      alert('No open cycle to close.');
      return;
    }
    if (!confirm(`Close cycle ${activeCycle.id}? This will lock all submissions.`)) return;
    try {
      const updated = await updateCycle(activeCycle.id, { status: 'consolidated' });
      setCycles((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      alert(`Cycle ${updated.id} closed. Final consolidated forecast archived.`);
    } catch (err) {
      alert(`Close failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const exportXlsx = () => {
    const std = data[2].find((t) => t.id === STANDARD_TEMPLATE_ID) ?? data[2][0];
    if (!std) return;
    exportSubmissionXlsx({
      template: { ...std, categories },
      layout: 'days-across',
      entity: 'Consolidated (all entities)',
      weekLabel: weekLabelShort(week),
      dates: horizonDates(week),
      dayLabels,
      values,
      startingBalance: CONSOLIDATED_START_BALANCE,
      filename: `consolidated-${week}.xlsx`,
    }).catch((err) => alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  return (
    <div className="view active">
      <TopBar
        crumb={`Treasury · ${activeCycle?.id ?? weekLabel(week)}`}
        title="Consolidated Forecast"
        actions={
          <>
            <button className="btn btn-ghost" onClick={exportXlsx}>
              Export XLSX
            </button>
            <button className="btn btn-success" onClick={closeCycle}>
              Close Cycle
            </button>
          </>
        }
      />
      <div className="content">
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Inflows · 4wk</div>
            <div className="kpi-value">{fmtM(kpis.inflows)}</div>
            <div className="kpi-sub">{deltaPill(kpis.inflowsDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Outflows · 4wk</div>
            <div className="kpi-value">{fmtM(Math.abs(kpis.outflows))}</div>
            <div className="kpi-sub">{deltaPill(kpis.outflowsDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net · 4wk</div>
            <div className="kpi-value">{fmtM(kpis.net)}</div>
            <div className="kpi-sub">{deltaPill(kpis.netDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Min Balance</div>
            <div className="kpi-value">{fmtM(kpis.minBalance)}</div>
            <div className="kpi-sub text-dim">on day {kpis.minDay}</div>
          </div>
        </div>

        <div className="section-header">
          <h2>Consolidated Grid</h2>
          <span className="tag">All entities · approved only · {weekLabel(week)}</span>
        </div>
        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>{entities.length} entities consolidated</strong> ·{' '}
              <span className="text-muted">read-only</span>
            </div>
          </div>
          <div className="forecast-grid-wrap">
            <ForecastGrid
              categories={categories}
              layout="days-across"
              dayLabels={dayLabels}
              values={values}
              flags={EMPTY_FLAGS}
              startingBalance={CONSOLIDATED_START_BALANCE}
              editable={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
