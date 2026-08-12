import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { StatusPill } from '../common/StatusPill';
import { listCycles, setCycleStatus } from '../../data/cycleService';
import { cycleOverview } from '../../data/dashboardService';
import { weekLabel } from '../../data/periods';
import type { Cycle, SubmissionStatus } from '../../types';
import type { ModalId } from '../../types/nav';

interface CyclesProps {
  onOpenModal: (id: ModalId) => void;
}

/** "8h ago" / "2w ago" from an ISO timestamp. */
function since(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${Math.max(hours, 1)}h ago`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}

/** How an outstanding country reads in the close dialog. */
const OUTSTANDING_LABEL: Record<SubmissionStatus, string> = {
  draft: 'not submitted',
  rejected: 'returned for update',
  submitted: 'awaiting approval',
  approved: 'approved',
  consolidated: 'consolidated',
};

/**
 * Weekly forecast cycles.
 *
 * A cycle is a forecast week, so its id, dates and counts are all derived —
 * the list can no longer describe a different period from the data on every
 * other screen. Closing one is a decision with consequences, so it asks first
 * and shows exactly what is still outstanding.
 */
export function Cycles({ onOpenModal }: CyclesProps) {
  const [version, setVersion] = useState(0);
  const [closing, setClosing] = useState<Cycle | null>(null);

  const rows = useMemo(() => {
    void version;
    return listCycles().map((cycle) => ({ cycle, summary: cycleOverview(cycle) }));
  }, [version]);

  const closingSummary = useMemo(
    () => (closing ? cycleOverview(closing) : null),
    [closing],
  );

  const setStatus = (cycle: Cycle, status: Cycle['status']) => {
    setCycleStatus(cycle.id, status);
    setClosing(null);
    setVersion((n) => n + 1);
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Treasury"
        title="Forecast Cycles"
        actions={
          <button className="btn btn-primary" onClick={() => onOpenModal('newCycle')}>
            + New Cycle
          </button>
        }
      />
      <div className="content">
        <div className="panel" data-tour="cycles-table">
          <div className="panel-body no-pad">
            <table>
              <thead>
                <tr>
                  <th>Cycle ID</th>
                  <th>Forecast Week</th>
                  <th>Opened</th>
                  <th>Closes</th>
                  <th>Status</th>
                  <th>Submissions</th>
                  <th className="num">Total (€M)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ cycle, summary }) => {
                  const isOpen = cycle.status === 'submitted';
                  return (
                    <tr key={cycle.id}>
                      <td>
                        <strong>{cycle.id}</strong>
                      </td>
                      <td className="text-dim">{weekLabel(cycle.weekKey)}</td>
                      <td className="text-dim">{since(cycle.openedAt)}</td>
                      <td className="text-dim">{cycle.closes}</td>
                      <td>
                        <StatusPill status={cycle.status} label={isOpen ? 'open' : 'closed'} />
                      </td>
                      <td className="text-dim">
                        {summary.received} / {summary.expected}
                      </td>
                      <td className="num">€{summary.totalM.toFixed(1)}M</td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() =>
                            isOpen ? setClosing(cycle) : setStatus(cycle, 'submitted')
                          }
                        >
                          {isOpen ? 'Close' : 'Reopen'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={closing !== null}
        title={closing ? `Close ${closing.id}?` : 'Close cycle'}
        onClose={() => setClosing(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setClosing(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => closing && setStatus(closing, 'consolidated')}
            >
              Close Cycle
            </button>
          </>
        }
      >
        {closing && closingSummary && (
          <>
            <p className="text-dim" style={{ marginBottom: 12 }}>
              {weekLabel(closing.weekKey)} · {closingSummary.approved} of{' '}
              {closingSummary.expected} forecasts approved. Closing a cycle stops entry and
              makes its numbers final.
            </p>
            {closingSummary.outstanding.length === 0 ? (
              <p className="empty-note">
                Every country has submitted and been approved. Nothing is outstanding.
              </p>
            ) : (
              <>
                <div className="grid-info" style={{ marginBottom: 8 }}>
                  <strong>{closingSummary.outstanding.length} still outstanding</strong> — these
                  will be closed out as they are:
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Country</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closingSummary.outstanding.map((o) => (
                      <tr key={o.entity}>
                        <td>{o.entity}</td>
                        <td>
                          <StatusPill status={o.status} label={OUTSTANDING_LABEL[o.status]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
