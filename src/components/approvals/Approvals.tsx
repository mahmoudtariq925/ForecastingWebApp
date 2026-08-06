import { useMemo, useState } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { seedFor } from '../../data/mockData';
import { listCycles, listEntities } from '../../data/appData';
import { currentWeekKey } from '../../data/periods';
import {
  applyApprovalDecision,
  approvalQueue,
  mergedEntityStatus,
  peekSubmission,
  templateForEntity,
} from '../../data/submissionService';
import {
  loadApprovals,
  loadCycles,
  loadSubmission,
  loadTemplates,
  type ApprovalMap,
} from '../../storage/localStorage';
import type { SubmissionStatus } from '../../types';
import type { SubmissionTarget } from '../submissions/Submission';

interface ApprovalsProps {
  onOpenSubmission?: (target: SubmissionTarget) => void;
  /** Restrict the queue to these entities (approver scoping); undefined = all. */
  scopeEntities?: string[];
}

/**
 * Approval queue for the active cycle. Flag counts, submission times and
 * statuses come from the stored submissions where they exist (deterministic
 * demo values otherwise); a decision persists to the approval map AND onto
 * the stored submission so the submitter sees it on the Submission screen.
 */
export function Approvals({ onOpenSubmission, scopeEntities }: ApprovalsProps) {
  const week = currentWeekKey();
  const activeCycleId = useMemo(() => {
    const cycles = loadCycles(listCycles());
    return (cycles.find((c) => c.status === 'submitted') ?? cycles[0])?.id ?? 'CW-2026-21';
  }, []);
  const [overrides, setOverrides] = useState<ApprovalMap>(() => loadApprovals(activeCycleId));

  // In the queue: entities whose seed status needs a decision, plus any
  // entity whose stored submission was submitted this week — limited to the
  // approver's scoped entities when set.
  const entities = listEntities();
  // An entity submits on the template Legal Entity Setup gives it, which is
  // not necessarily the standard one — reading the standard template here is
  // what used to hide a submitted forecast from its own approver.
  const allTemplates = useMemo(() => loadTemplates(), []);
  const entityTemplate = (name: string) => templateForEntity(allTemplates, name);
  const storedFor = (name: string) => {
    const t = entityTemplate(name);
    return t ? loadSubmission(week, name, t.id) : null;
  };

  // Everything this approver is responsible for, decided or not — used to
  // explain an empty queue rather than leaving them guessing.
  const covered = scopeEntities
    ? entities.filter((e) => scopeEntities.includes(e.name))
    : entities;

  // Shared with the analyst checklist, so "waiting on me" means one thing.
  const queue = approvalQueue(week, scopeEntities);

  const decide = (entity: string, status: SubmissionStatus) => {
    // The service writes both stores — the cycle's approval map and the
    // stored submission (materializing it if need be) — so the submitter
    // always sees the decision, not just the queue.
    setOverrides(applyApprovalDecision(week, entity, entityTemplate(entity)?.id ?? '', status));
  };

  /** Effective status: decision, else the stored submission, else the seed. */
  const statusOf = (e: (typeof entities)[number]) =>
    mergedEntityStatus(e, week, entityTemplate(e.name)?.id ?? '', overrides);

  const rowData = (name: string) => {
    const stored = storedFor(name);
    // Flag counts match the Dashboard KPI and Comments Review screen:
    // stored submission or the same deterministic demo data.
    const template = entityTemplate(name);
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
              // A bare "nothing to do" reads as a broken screen to an approver
              // whose entities happen to be settled, so account for every
              // entity they cover and where it currently stands.
              <div className="empty-state">
                <div className="ic">✓</div>
                <p>Nothing awaiting approval.</p>
                {covered.length > 0 ? (
                  <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {covered.length === 1 ? 'Your entity is' : `All ${covered.length} of your entities are`}{' '}
                    already decided —{' '}
                    {covered.map((e) => `${e.name} (${statusOf(e)})`).join(', ')}
                    . New forecasts appear here as soon as they are submitted.
                  </p>
                ) : (
                  <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    No entities are assigned to you yet. Treasury assigns approvers under
                    Legal Entity Setup.
                  </p>
                )}
              </div>
            ) : (
              <table data-tour="approvals-table">
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
                    const status = statusOf(e);
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
                                data-tour="approvals-review"
                                onClick={() =>
                                  onOpenSubmission({
                                    entity: e.name,
                                    week,
                                    templateId: entityTemplate(e.name)?.id,
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
                                  data-tour="approvals-decide"
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
