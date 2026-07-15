import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { ForecastGrid } from '../submissions/ForecastGrid';
import { dayValue } from '../submissions/gridMath';
import type { GridValues } from '../submissions/gridMath';
import {
  buildStandardTemplate,
  cycles as seedCycles,
  entities,
  generateGridValues,
  seedFor,
} from '../../data/mockData';
import { DEFAULT_PERIOD, dayLabelsForPeriod, periodLabel, prevPeriodKey } from '../../data/periods';
import { loadCycles, saveCycles } from '../../storage/localStorage';
import { exportGridXlsx } from '../../utils/excel';

const EMPTY_FLAGS = new Set<string>();

interface Kpis {
  inflows: number;
  outflows: number;
  net: number;
  inflowsDelta: number;
  outflowsDelta: number;
  netDelta: number;
  minBalance: number;
  minDay: number;
}

function computeKpis(
  rows: ReturnType<typeof buildStandardTemplate>['rows'],
  values: GridValues,
  priorValues: GridValues,
  numDays: number,
): Kpis {
  const subtotalIdxs = rows
    .map((r, i) => (r.kind === 'subtotal' ? i : -1))
    .filter((i) => i >= 0);
  const totalIdx = rows.findIndex((r) => r.kind === 'total');

  const sumRow = (v: GridValues, rowIdx: number) => {
    let s = 0;
    for (let i = 0; i < numDays; i++) s += dayValue(rows, v, rowIdx, i);
    return s;
  };

  const inflows = sumRow(values, subtotalIdxs[0]);
  const outflows = sumRow(values, subtotalIdxs[1] ?? subtotalIdxs[0]);
  const net = sumRow(values, totalIdx);
  const pInflows = sumRow(priorValues, subtotalIdxs[0]);
  const pOutflows = sumRow(priorValues, subtotalIdxs[1] ?? subtotalIdxs[0]);
  const pNet = sumRow(priorValues, totalIdx);

  const pct = (cur: number, prior: number) =>
    ((cur - prior) / Math.max(Math.abs(prior), 1)) * 100;

  // Minimum cumulative net balance across the horizon.
  let running = 0;
  let minBalance = Infinity;
  let minDay = 1;
  for (let i = 0; i < numDays; i++) {
    running += dayValue(rows, values, totalIdx, i);
    if (running < minBalance) {
      minBalance = running;
      minDay = i + 1;
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
}

/** Treasury read-only consolidated view across all approved entities. */
export function Consolidated() {
  const period = DEFAULT_PERIOD;
  const template = useMemo(() => buildStandardTemplate(), []);
  const dayLabels = useMemo(() => dayLabelsForPeriod(period), [period]);
  const [cycles, setCycles] = useState(() => loadCycles(seedCycles));
  const activeCycle = cycles.find((c) => c.status === 'submitted');

  const values = useMemo<GridValues>(
    () => generateGridValues(template.rows, period, seedFor(`Consolidated:${period}`), false).values,
    [template, period],
  );
  const priorValues = useMemo<GridValues>(() => {
    const prev = prevPeriodKey(period);
    return generateGridValues(template.rows, period, seedFor(`Consolidated:${prev}`), false).values;
  }, [template, period]);

  const kpis = useMemo(
    () => computeKpis(template.rows, values, priorValues, dayLabels.length),
    [template, values, priorValues, dayLabels],
  );

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
    exportGridXlsx(
      template.rows,
      dayLabels,
      values,
      `consolidated-${period}.xlsx`,
      'Consolidated',
    ).catch((err) => alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  return (
    <div className="view active">
      <TopBar
        crumb={`Treasury · ${activeCycle?.id ?? periodLabel(period)}`}
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
            <div className="kpi-label">Inflows · 30d</div>
            <div className="kpi-value">{fmtM(kpis.inflows)}</div>
            <div className="kpi-sub">{deltaPill(kpis.inflowsDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Outflows · 30d</div>
            <div className="kpi-value">{fmtM(Math.abs(kpis.outflows))}</div>
            <div className="kpi-sub">{deltaPill(kpis.outflowsDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net · 30d</div>
            <div className="kpi-value">{fmtM(kpis.net)}</div>
            <div className="kpi-sub">{deltaPill(kpis.netDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Min Daily Balance</div>
            <div className="kpi-value">{fmtM(kpis.minBalance)}</div>
            <div className="kpi-sub text-dim">on day {kpis.minDay}</div>
          </div>
        </div>

        <div className="section-header">
          <h2>Consolidated Grid</h2>
          <span className="tag">All entities · approved only</span>
        </div>
        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>{entities.length} entities consolidated</strong> ·{' '}
              <span className="text-muted">
                {periodLabel(period)} · read-only
              </span>
            </div>
          </div>
          <div className="forecast-grid-wrap">
            <ForecastGrid
              rows={template.rows}
              dayLabels={dayLabels}
              values={values}
              flags={EMPTY_FLAGS}
              editable={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
