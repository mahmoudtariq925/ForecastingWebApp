import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { ForecastGrid } from '../submissions/ForecastGrid';
import {
  dayInflows,
  dayNet,
  dayOutflows,
  runningBalance,
  type GridValues,
} from '../submissions/gridMath';
import {
  buildStandardTemplate,
  cycles as seedCycles,
  entities,
  generateGridValues,
  seedFor,
} from '../../data/mockData';
import {
  currentWeekKey,
  dayLabelsForWeek,
  horizonDates,
  prevWeekKey,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import { loadCycles, saveCycles } from '../../storage/localStorage';
import { exportSubmissionXlsx } from '../../utils/excel';

const EMPTY_FLAGS = new Set<string>();
const CONSOLIDATED_START_BALANCE = 42000;

/** Treasury read-only consolidated view across all approved entities. */
export function Consolidated() {
  const week = currentWeekKey();
  const template = useMemo(() => buildStandardTemplate(), []);
  const dayLabels = useMemo(() => dayLabelsForWeek(week), [week]);
  const numDays = dayLabels.length;
  const numCats = template.categories.length;
  const [cycles, setCycles] = useState(() => loadCycles(seedCycles));
  const activeCycle = cycles.find((c) => c.status === 'submitted');

  const values = useMemo<GridValues>(
    () =>
      generateGridValues(template.categories, week, seedFor(`Consolidated:${week}`), false)
        .values,
    [template, week],
  );
  const priorValues = useMemo<GridValues>(() => {
    const prev = prevWeekKey(week);
    return generateGridValues(template.categories, prev, seedFor(`Consolidated:${prev}`), false)
      .values;
  }, [template, week]);

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
      minBalance,
      minDay,
    };
  }, [values, priorValues, numCats, numDays]);

  const fmtM = (v: number) => `€ ${(v / 1000).toFixed(1)}M`;
  const deltaPill = (v: number) => (
    <span className={`delta ${v >= 0 ? 'up' : 'down'}`}>
      {v >= 0 ? '↑' : '↓'} {Math.abs(v).toFixed(1)}%
    </span>
  );

  const closeCycle = () => {
    if (!activeCycle) {
      alert('No open cycle to close.');
      return;
    }
    if (!confirm(`Close cycle ${activeCycle.id}? This will lock all submissions.`)) return;
    const next = cycles.map((c) =>
      c.id === activeCycle.id ? { ...c, status: 'consolidated' as const } : c,
    );
    setCycles(next);
    saveCycles(next);
    alert(`Cycle ${activeCycle.id} closed. Final consolidated forecast archived.`);
  };

  const exportXlsx = () => {
    exportSubmissionXlsx({
      template,
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
              categories={template.categories}
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
