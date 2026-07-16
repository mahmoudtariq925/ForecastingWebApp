import { useMemo } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Chart } from '../common/Chart';
import {
  buildStandardTemplate,
  cycles as seedCycles,
  entities,
  generateGridValues,
  seedFor,
} from '../../data/mockData';
import { currentWeekKey, HORIZON_DAYS, weekLabel } from '../../data/periods';
import { getOrCreateSubmission } from '../../data/submissionService';
import {
  loadApprovals,
  loadCycles,
  loadTemplates,
  listSubmissions,
} from '../../storage/localStorage';
import { dayNet } from '../submissions/gridMath';
import type { Entity, SubmissionStatus } from '../../types';
import type { ModalId, ViewId } from '../../types/nav';

interface DashboardProps {
  onOpenModal: (id: ModalId) => void;
  onNavigate: (view: ViewId) => void;
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

// Mock "last updated" hours per progress row (until submissions carry real ones).
const updatedHours = [3, 11, 26, 7, 19];

export function Dashboard({ onOpenModal, onNavigate }: DashboardProps) {
  const cycles = loadCycles(seedCycles);
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];
  const overrides = loadApprovals(activeCycle?.id ?? 'CW-2026-21');

  const statusOf = (e: Entity): SubmissionStatus => overrides[e.name] ?? e.status;

  // --- KPIs computed from the data stores -------------------------------
  const totalForecast = entities.reduce((s, e) => s + e.total, 0) / 1000;
  const weightedDelta =
    entities.reduce((s, e) => s + e.total * e.delta, 0) /
    Math.max(entities.reduce((s, e) => s + e.total, 0), 1);

  const week = currentWeekKey();

  const netPosition = useMemo(() => {
    const tpl = buildStandardTemplate();
    const values = generateGridValues(
      tpl.categories,
      week,
      seedFor(`Consolidated:${week}`),
      false,
    ).values;
    let net = 0;
    for (let d = 0; d < HORIZON_DAYS; d++) net += dayNet(tpl.categories.length, values, d);
    return net / 1000;
  }, [week]);

  const received = entities.filter((e) => statusOf(e) !== 'pending').length;
  const pendingApproval = entities.filter((e) => statusOf(e) === 'submitted').length;

  const { flagCount, needComment } = useMemo(() => {
    // Ensure at least the first entity has a submission so the KPI is live.
    const templates = loadTemplates();
    if (templates.length > 0) {
      getOrCreateSubmission(entities[0].name, week, templates[0]);
    }
    const subs = listSubmissions(week);
    const flags = subs.reduce((s, sub) => s + sub.flags.length, 0);
    const missing = subs.reduce(
      (s, sub) => s + sub.flags.filter((k) => !sub.comments?.[k]?.trim()).length,
      0,
    );
    return { flagCount: flags, needComment: missing };
  }, [week]);

  const progress = entities.slice(0, 5);

  return (
    <div className="view active">
      <TopBar
        crumb="Overview"
        title="Treasury Dashboard"
        actions={
          <>
            <CyclePill label="Active Cycle" value={activeCycle?.id ?? '—'} />
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
            <div className="kpi-label">Total Forecast · 4wk</div>
            <div className="kpi-value">€ {totalForecast.toFixed(1)}M</div>
            <div className="kpi-sub">
              <Delta delta={weightedDelta} /> vs prior cycle
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net Cash Position</div>
            <div className="kpi-value">€ {netPosition.toFixed(1)}M</div>
            <div className="kpi-sub text-dim">{weekLabel(week)} consolidated</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Submissions Received</div>
            <div className="kpi-value">
              {received} / {entities.length}
            </div>
            <div className="kpi-sub text-dim">{pendingApproval} pending approval</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Variance Flags</div>
            <div className="kpi-value">{flagCount}</div>
            <div className="kpi-sub text-dim">{needComment} require commentary</div>
          </div>
        </div>

        <div className="section-header">
          <h2>Cycle Progress</h2>
          <span className="tag">{activeCycle?.id ?? '—'} · Closes Fri 18:00 CET</span>
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
                {progress.map((e, i) => {
                  const status = statusOf(e);
                  return (
                    <tr key={e.name}>
                      <td>
                        <strong>{e.name}</strong>
                      </td>
                      <td className="text-dim">{e.submitter}</td>
                      <td className="text-dim">{e.approver}</td>
                      <td>
                        <StatusPill status={status} />
                      </td>
                      <td className="num">€{e.total.toLocaleString()}k</td>
                      <td className="num">
                        <Delta delta={e.delta} />
                      </td>
                      <td className="text-muted" style={{ fontSize: 12 }}>
                        {updatedHours[i]}h ago
                      </td>
                      <td>
                        {status === 'approved' ? (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => onNavigate('submission')}
                          >
                            View
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() =>
                              alert(
                                `Chaser sent to ${e.name} submitter and approver via email & Teams.`,
                              )
                            }
                          >
                            Send Chaser
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
