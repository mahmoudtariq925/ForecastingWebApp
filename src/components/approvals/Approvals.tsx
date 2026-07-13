import { useState } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { entities } from '../../data/mockData';
import { loadApprovals, saveApprovals, type ApprovalMap } from '../../storage/localStorage';
import type { SubmissionStatus } from '../../types';

const CYCLE_ID = 'CW-2026-21';

// Deterministic variance-flag counts per pending entity (prototype used random).
const flagCounts: Record<string, number> = {
  Germany: 2,
  France: 3,
  Spain: 1,
  Poland: 0,
  Switzerland: 2,
  Portugal: 1,
};
const submittedHours: Record<string, number> = {
  Germany: 4,
  France: 9,
  Spain: 2,
  Poland: 13,
  Switzerland: 6,
  Portugal: 18,
};

/** Approval queue for the active cycle; approve/reject persists per entity. */
export function Approvals() {
  const queue = entities.filter((e) => e.status === 'submitted' || e.status === 'pending');
  const [overrides, setOverrides] = useState<ApprovalMap>(() => loadApprovals(CYCLE_ID));

  const decide = (entity: string, status: SubmissionStatus) => {
    const next = { ...overrides, [entity]: status };
    setOverrides(next);
    saveApprovals(CYCLE_ID, next);
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Workflow"
        title="Pending Approvals"
        actions={<CyclePill label="Active" value={CYCLE_ID} />}
      />
      <div className="content">
        <div className="panel">
          <div className="panel-body no-pad">
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
                  const flags = flagCounts[e.name] ?? 0;
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
                          <StatusPill status="pending" label={`${flags} flag${flags > 1 ? 's' : ''}`} />
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
                        {submittedHours[e.name] ?? 0}h ago
                      </td>
                      <td>
                        {decided ? (
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            {status === 'approved' ? 'Approved' : 'Rejected'}
                          </span>
                        ) : (
                          <div className="row-flex">
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
                          </div>
                        )}
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
