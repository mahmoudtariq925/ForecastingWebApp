import { useMemo } from 'react';
import { TopBar } from '../layout/TopBar';
import { ForecastGrid } from '../submissions/ForecastGrid';
import type { GridValues } from '../submissions/gridMath';
import { generateGridValues, seedFor } from '../../data/mockData';

const EMPTY_FLAGS = new Set<string>();

/** Treasury read-only consolidated view across all approved entities. */
export function Consolidated() {
  // A distinct seed gives the consolidated grid its own (larger) figures.
  const values = useMemo<GridValues>(
    () => generateGridValues(seedFor('Consolidated · All Entities'), false).values,
    [],
  );

  return (
    <div className="view active">
      <TopBar
        crumb="Treasury · CW-2026-21"
        title="Consolidated Forecast"
        actions={
          <>
            <button className="btn btn-ghost">Export XLSX</button>
            <button
              className="btn btn-success"
              onClick={() => {
                if (confirm('Close cycle CW-2026-21? This will lock all submissions.')) {
                  alert('Cycle closed. Final consolidated forecast archived.');
                }
              }}
            >
              Close Cycle
            </button>
          </>
        }
      />
      <div className="content">
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Inflows · 30d</div>
            <div className="kpi-value">€ 312.8M</div>
            <div className="kpi-sub">
              <span className="delta up">↑ 2.1%</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Outflows · 30d</div>
            <div className="kpi-value">€ 270.1M</div>
            <div className="kpi-sub">
              <span className="delta up">↑ 4.4%</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net · 30d</div>
            <div className="kpi-value">€ 42.7M</div>
            <div className="kpi-sub">
              <span className="delta down">↓ 1.8%</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Min Daily Balance</div>
            <div className="kpi-value">€ 18.2M</div>
            <div className="kpi-sub text-dim">on day 23</div>
          </div>
        </div>

        <div className="section-header">
          <h2>Consolidated Grid</h2>
          <span className="tag">All entities · approved only</span>
        </div>
        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>14 entities consolidated</strong> ·{' '}
              <span className="text-muted">read-only</span>
            </div>
          </div>
          <div className="forecast-grid-wrap">
            <ForecastGrid values={values} flags={EMPTY_FLAGS} editable={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
