import { useMemo } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import {
  cycles as seedCycles,
  entities,
  seedFor,
  STANDARD_TEMPLATE_ID,
  users as seedUsers,
} from '../../data/mockData';
import { currentWeekKey, dayLabelsForWeek, HORIZON_DAYS, weekLabel } from '../../data/periods';
import {
  consolidatedValues,
  mergedEntityStatus,
  peekSubmission,
} from '../../data/submissionService';
import { currentUser } from '../../data/session';
import {
  loadApprovals,
  loadCycles,
  loadSettings,
  loadSubmission,
  loadTemplates,
} from '../../storage/localStorage';
import { dayInflows, dayNet, dayOutflows } from '../submissions/gridMath';
import { emailForName, mailDomain, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
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

/** "3h ago" / "2d ago" from an ISO timestamp. */
function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Dashboard({ onOpenModal, onNavigate }: DashboardProps) {
  const cycles = loadCycles(seedCycles);
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];
  const overrides = loadApprovals(activeCycle?.id ?? 'CW-2026-21');
  const week = currentWeekKey();
  const template = useMemo(() => {
    const templates = loadTemplates();
    return templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0] ?? null;
  }, []);

  const statusOf = (e: Entity): SubmissionStatus =>
    template ? mergedEntityStatus(e, week, template.id, overrides) : e.status;

  // --- KPIs computed from the data stores -------------------------------
  const totalForecast = entities.reduce((s, e) => s + e.total, 0) / 1000;
  const weightedDelta =
    entities.reduce((s, e) => s + e.total * e.delta, 0) /
    Math.max(entities.reduce((s, e) => s + e.total, 0), 1);

  // Consolidated across ALL entities from the same data the Submission
  // screen edits — recomputed on mount, so edits show up here immediately.
  const consolidated = useMemo(
    () => (template ? consolidatedValues(week, template) : null),
    [template, week],
  );
  const numCats = template?.categories.length ?? 0;

  const netPosition = useMemo(() => {
    if (!consolidated) return 0;
    let net = 0;
    for (let d = 0; d < HORIZON_DAYS; d++) net += dayNet(numCats, consolidated.values, d);
    return net / 1000;
  }, [consolidated, numCats]);

  const received = entities.filter((e) => statusOf(e) !== 'pending').length;
  const pendingApproval = entities.filter((e) => statusOf(e) === 'submitted').length;

  const { flagCount, needComment } = useMemo(() => {
    // Same coverage as the Comments Review screen: every entity's current
    // week (stored submission or the deterministic demo data).
    if (!template) return { flagCount: 0, needComment: 0 };
    let flags = 0;
    let missing = 0;
    for (const e of entities) {
      const sub = peekSubmission(e.name, week, template);
      flags += sub.flags.length;
      missing += sub.flags.filter((k) => !sub.comments?.[k]?.trim()).length;
    }
    return { flagCount: flags, needComment: missing };
  }, [template, week]);

  // --- 4-week outlook chart from the consolidated grid ------------------
  const dayLabels = useMemo(() => dayLabelsForWeek(week), [week]);
  const outlookSeries: ChartSeries[] = useMemo(() => {
    if (!consolidated) return [];
    const inflows = dayLabels.map((_dl, d) => dayInflows(numCats, consolidated.values, d));
    const outflows = dayLabels.map((_dl, d) => dayOutflows(numCats, consolidated.values, d));
    const net = dayLabels.map((_dl, d) => dayNet(numCats, consolidated.values, d));
    return [
      { label: 'Inflows', values: inflows, color: CHART_COLORS.green, kind: 'bar' },
      { label: 'Outflows', values: outflows, color: CHART_COLORS.red, kind: 'bar' },
      { label: 'Net Cash Flow', values: net, color: CHART_COLORS.accent, kind: 'line' },
    ];
  }, [consolidated, dayLabels, numCats]);

  /** Last-updated label: real timestamp when a submission exists, otherwise
   * a stable demo value derived from the entity name. */
  const updatedLabel = (entityName: string): string => {
    if (template) {
      const stored = loadSubmission(week, entityName, template.id);
      if (stored?.updatedAt) return agoLabel(stored.updatedAt);
    }
    return `${(seedFor(entityName) % 26) + 1}h ago`;
  };

  const sendChaser = (e: Entity) => {
    const me = currentUser();
    const domain = mailDomain(loadSettings(DEFAULT_SETTINGS));
    const users = seedUsers;
    openEmail({
      to: [emailForName(e.submitter, users, domain), emailForName(e.approver, users, domain)],
      subject: `Reminder — ${activeCycle?.id ?? 'current cycle'} cash flow forecast (${e.name})`,
      body:
        `Hi ${e.submitter.split(' ')[0]}, hi ${e.approver.split(' ')[0]},\n\n` +
        `Gentle reminder that the ${e.name} cash flow forecast for cycle ` +
        `${activeCycle?.id ?? '—'} (${weekLabel(week)}) is still ${statusOf(e)}.\n` +
        `The cycle closes ${activeCycle?.closes ?? 'soon'}.\n\n` +
        `Submit or approve it here: ${window.location.origin + window.location.pathname}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
  };

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
          <span className="tag">
            {activeCycle?.id ?? '—'} · Closes {activeCycle?.closes ?? '—'}
          </span>
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
                {entities.map((e) => {
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
                        {updatedLabel(e.name)}
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
                            title="Opens a prefilled reminder email in Outlook"
                            onClick={() => sendChaser(e)}
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
          <h2>4-Week Outlook</h2>
          <span className="tag">Consolidated · all entities · €k</span>
        </div>
        <div className="panel">
          <Chart labels={dayLabels.map((dl) => dl.dm)} series={outlookSeries} unit="k" />
        </div>
      </div>
    </div>
  );
}
