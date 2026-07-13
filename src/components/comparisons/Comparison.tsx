import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Chart } from '../common/Chart';
import { variances } from '../../data/mockData';

const TABS = ['Daily Variance', 'By Entity', 'By Category'];

/** Forecast-vs-forecast comparison with variance drill-down table. */
export function Comparison() {
  const [tab, setTab] = useState(0);

  return (
    <div className="view active">
      <TopBar
        crumb="Analysis"
        title="Forecast vs Forecast"
        actions={
          <select className="form-select" style={{ width: 'auto' }}>
            <option>CW-2026-21 vs CW-2026-20</option>
            <option>CW-2026-21 vs CW-2026-19</option>
            <option>CW-2026-20 vs CW-2026-19</option>
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
          <div className="panel-body">
            <Chart variant="compare" />
          </div>
        </div>

        <div className="section-header">
          <h2>Largest Variances</h2>
          <span className="tag">±15% threshold</span>
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
                  const cls = pct > 0 ? 'up' : 'down';
                  const sign = pct > 0 ? '+' : '';
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
                        <span className={`delta ${cls}`}>
                          {sign}
                          {pct.toFixed(1)}%
                        </span>
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
