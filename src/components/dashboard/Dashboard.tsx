import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Chart } from '../common/Chart';
import { entities } from '../../data/mockData';
import type { Entity } from '../../types';
import type { ModalId } from '../../types/nav';

interface DashboardProps {
  onOpenModal: (id: ModalId) => void;
}

function Delta({ delta }: { delta: number }) {
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
  const sign = delta > 0 ? '↑' : delta < 0 ? '↓' : '—';
  return (
    <span className={`delta ${cls}`}>
      {sign} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

// Deterministic "updated N hours ago" per row so the dashboard is stable.
const updatedHours = [3, 11, 26, 7, 19];

function ProgressRow({ entity, hours }: { entity: Entity; hours: number }) {
  return (
    <tr>
      <td>
        <strong>{entity.name}</strong>
      </td>
      <td className="text-dim">{entity.submitter}</td>
      <td className="text-dim">{entity.approver}</td>
      <td>
        <StatusPill status={entity.status} />
      </td>
      <td className="num">€{entity.total.toLocaleString()}k</td>
      <td className="num">
        <Delta delta={entity.delta} />
      </td>
      <td className="text-muted" style={{ fontSize: 12 }}>
        {hours}h ago
      </td>
      <td>
        {entity.status === 'approved' ? (
          <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }}>
            View
          </button>
        ) : (
          <button
            className="btn btn-ghost"
            style={{ padding: '4px 10px', fontSize: 11 }}
            onClick={() =>
              alert(`Chaser sent to ${entity.name} submitter and approver via email & Teams.`)
            }
          >
            Send Chaser
          </button>
        )}
      </td>
    </tr>
  );
}

export function Dashboard({ onOpenModal }: DashboardProps) {
  const progress = entities.slice(0, 5);
  return (
    <div className="view active">
      <TopBar
        crumb="Overview"
        title="Treasury Dashboard"
        actions={
          <>
            <CyclePill label="Active Cycle" value="CW-2026-21" />
            <button className="btn btn-ghost" onClick={() => onOpenModal('export')}>
              Export
            </button>
            <button className="btn btn-primary" onClick={() => onOpenModal('newCycle')}>
              + New Cycle
            </button>
          </>
        }
      />
      <div className="content">
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total Forecast · 30d</div>
            <div className="kpi-value">€ 184.2M</div>
            <div className="kpi-sub">
              <span className="delta up">↑ 3.2%</span> vs prior cycle
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net Cash Position</div>
            <div className="kpi-value">€ 42.7M</div>
            <div className="kpi-sub">
              <span className="delta down">↓ 1.8%</span> from CW-20
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Submissions Received</div>
            <div className="kpi-value">3 / 5</div>
            <div className="kpi-sub text-dim">2 pending approval</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Variance Flags</div>
            <div className="kpi-value">7</div>
            <div className="kpi-sub text-dim">3 require commentary</div>
          </div>
        </div>

        <div className="section-header">
          <h2>Cycle Progress</h2>
          <span className="tag">CW-2026-21 · Closes Fri 18:00 CET</span>
        </div>

        <div className="panel">
          <div className="panel-body no-pad">
            <table>
              <thead>
                <tr>
                  <th>Entity / Team</th>
                  <th>Submitter</th>
                  <th>Approver</th>
                  <th>Status</th>
                  <th className="num">Total (€)</th>
                  <th className="num">Δ vs Prior</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {progress.map((e, i) => (
                  <ProgressRow key={e.name} entity={e} hours={updatedHours[i]} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section-header">
          <h2>30-Day Outlook</h2>
          <span className="tag">Consolidated · €M</span>
        </div>
        <div className="panel">
          <Chart variant="mixed" />
        </div>
      </div>
    </div>
  );
}
