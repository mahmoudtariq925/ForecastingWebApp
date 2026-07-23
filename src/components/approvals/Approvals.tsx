import { useMemo, useState } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { cycles as seedCycles, entities, seedFor, STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { currentWeekKey } from '../../data/periods';
import { peekSubmission } from '../../data/submissionService';
import {
  loadApprovals,
  loadCycles,
  loadSubmission,
  loadTemplates,
  saveApprovals,
  saveSubmission,
  type ApprovalMap,
} from '../../storage/localStorage';
import type { SubmissionStatus } from '../../types';
import type { SubmissionTarget } from '../submissions/Submission';

interface ApprovalsProps {
  onOpenSubmission?: (target: SubmissionTarget) => void;
}

/**
 * Approval queue for the active cycle. Flag counts, submission times and
 * statuses come from the stored submissions where they exist (deterministic
 * demo values otherwise); a decision persists to the approval map AND onto
 * the stored submission so the submitter sees it on the Submission screen.
 */
export function Approvals({ onOpenSubmission }: ApprovalsProps) {
  const week = currentWeekKey();
  const activeCycleId = useMemo(() => {
    const cycles = loadCycles(seedCycles);
    return (cycles.find((c) => c.status === 'submitted') ?? cycles[0])?.id ?? 'CW-2026-21';
  }, []);
  const [overrides, setOverrides] = useState<ApprovalMap>(() => loadApprovals(activeCycleId));

  // In the queue: entities whose seed status needs a decision, plus any
  // entity whose stored submission was submitted this week.
  const queue = entities.filter((e) => {
    const stored = loadSubmission(week, e.name, STANDARD_TEMPLATE_ID);
    return (
      e.status === 'submitted' ||
      e.status === 'pending' ||
      (stored !== null && stored.status === 'submitted')
    );
  });

  const decide = (entity: string, status: SubmissionStatus) => {
    const next = { ...overrides, [entity]: status };
    setOverrides(next);
    saveApprovals(activeCycleId, next);
    // Reflect the decision on the stored submission, if there is one.
    const stored = loadSubmission(week, entity, STANDARD_TEMPLATE_ID);
    if (stored) saveSubmission({ ...stored, status, updatedAt: new Date().toISOString() });
  };

  const template = useMemo(() => {
    const templates = loadTemplates();
    return templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0] ?? null;
  }, []);

  const rowData = (name: string) => {
    const stored = loadSubmission(week, name, STANDARD_TEMPLATE_ID);
    // Flag counts match the Dashboard KPI and Comments Review screen:
    // stored submission or the same deterministic demo data.
    const flags = template ? peekSubmission(name, week, template).flags.length : 0;
    if (stored) {
      const hours = Math.max(
        1,
        Math.round((Date.now() - new Date(stored.updatedAt).getTime()) / 3_600_000),
      );
      return { flags, hours: Math.min(Number.isFinite(hours) ? hours : 1, 99) };
    }
    // Stable demo submission time for entities that have not started yet.
    return { flags, hours: (seedFor(`${name}:hrs`) % 18) + 1 };
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Workflow"
        title="Pending Approvals"
        actions={<CyclePill label="Active" value={activeCycleId} />}
      />
      <div className="content">
        <div className="panel">
          <div className="panel-body no-pad">
            {queue.length === 0 ? (
              <div className="empty-state">
                <div className="ic">✓</div>
                <p>Nothing awaiting approval.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Entity / Team</th>
                    <th>Submitted by</th>
                    <th>Variance Flags</th>
                    <th className="num">Total (€)</th>
                    <th className="num">Δ vs Prior</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((e) => {
                    const { flags, hours } = rowData(e.name);
                    const status = overrides[e.name] ?? e.status;
                    const deltaClass = e.delta > 0 ? 'up' : 'down';
                    const deltaSign = e.delta > 0 ? '↑' : '↓';
                    const decided = status === 'approved' || status === 'rejected';
                    return (
                      <tr key={e.name}>
                        <td>
                          <strong>{e.name}</strong>
                        </td>
                        <td className="text-dim">{e.submitter}</td>
                        <td>
                          {flags ? (
                            <StatusPill
                              status="pending"
                              label={`${flags} flag${flags > 1 ? 's' : ''}`}
                            />
                          ) : (
                            <span className="text-muted" style={{ fontSize: 11 }}>
                              —
                            </span>
                          )}
                        </td>
                        <td className="num">€{e.total.toLocaleString()}k</td>
                        <td className="num">
                          <span className={`delta ${deltaClass}`}>
                            {deltaSign} {Math.abs(e.delta).toFixed(1)}%
                          </span>
                        </td>
                        <td>
                          <StatusPill status={status} />
                        </td>
                        <td className="text-muted" style={{ fontSize: 12 }}>
                          {hours}h ago
                        </td>
                        <td>
                          <div className="row-flex">
                            {onOpenSubmission && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() =>
                                  onOpenSubmission({
                                    entity: e.name,
                                    week,
                                    templateId: STANDARD_TEMPLATE_ID,
                                  })
                                }
                              >
                                Review
                              </button>
                            )}
                            {decided ? (
                              <span className="text-muted" style={{ fontSize: 11 }}>
                                {status === 'approved' ? 'Approved' : 'Rejected'}
                              </span>
                            ) : (
                              <>
                                <button
                                  className="btn btn-success"
                                  style={{ padding: '4px 10px', fontSize: 11 }}
                                  onClick={() => decide(e.name, 'approved')}
                                >
                                  Approve
                                </button>
                                <button
                                  className="btn btn-danger"
                                  style={{ padding: '4px 10px', fontSize: 11 }}
                                  onClick={() => decide(e.name, 'rejected')}
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
