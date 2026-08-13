import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { StatusPill } from '../common/StatusPill';
import { MultiSelect } from '../common/MultiSelect';
import { useDialog } from '../common/dialogContext';
import { listEntities, seedUsers } from '../../data/appData';
import { listCycles, openCycleForWeek, setCycleStatus } from '../../data/cycleService';
import { cycleOverview } from '../../data/dashboardService';
import { weekLabel } from '../../data/periods';
import { loadSettings, loadUsers } from '../../storage/localStorage';
import { emailForName, mailDomain, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { Cycle, SubmissionStatus } from '../../types';

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

/** How a cycle's state reads, and which pill colour carries it. */
const CYCLE_PILL: Record<Cycle['status'], { status: SubmissionStatus; label: string }> = {
  scheduled: { status: 'draft', label: 'scheduled' },
  submitted: { status: 'submitted', label: 'open' },
  consolidated: { status: 'approved', label: 'closed' },
};

/**
 * Weekly forecast cycles.
 *
 * A cycle is a forecast week, so its id, dates and counts are all derived —
 * the list can no longer describe a different period from the data on every
 * other screen, and the weeks AHEAD are known too: they are listed, greyed and
 * unopened, rather than typed into a "new cycle" form when their turn comes.
 *
 * Opening one is a decision about who it collects from and who hears about it;
 * closing one is a decision with consequences. Both ask first.
 */
export function Cycles() {
  const [version, setVersion] = useState(0);
  const [closing, setClosing] = useState<Cycle | null>(null);
  /** The cycle being opened, if any — the dialog decides who it covers. */
  const [opening, setOpening] = useState<Cycle | null>(null);
  const [forEntities, setForEntities] = useState<string[]>([]);
  const { notify } = useDialog();

  const entities = useMemo(() => listEntities(), []);
  const rows = useMemo(() => {
    void version;
    return listCycles().map((cycle) => ({ cycle, summary: cycleOverview(cycle) }));
  }, [version]);

  const closingSummary = useMemo(() => (closing ? cycleOverview(closing) : null), [closing]);

  const setStatus = (cycle: Cycle, status: Cycle['status']) => {
    setCycleStatus(cycle.id, status);
    setClosing(null);
    setVersion((n) => n + 1);
  };

  const startOpening = (cycle: Cycle) => {
    setForEntities(cycle.entities ?? []);
    setOpening(cycle);
  };

  const confirmOpen = async () => {
    if (!opening) return;
    openCycleForWeek(opening.weekKey, forEntities);
    const covered = forEntities.length === 0 ? entities.length : forEntities.length;
    setOpening(null);
    setVersion((n) => n + 1);
    await notify({
      tone: 'success',
      title: 'Cycle opened',
      message: `${opening.id} is open for ${covered} ${covered === 1 ? 'entity' : 'entities'} · ${weekLabel(opening.weekKey)}.`,
    });
  };

  /** The entities a cycle covers, resolved for the notification drafts. */
  const covered = useMemo(
    () =>
      forEntities.length === 0 ? entities : entities.filter((e) => forEntities.includes(e.name)),
    [entities, forEntities],
  );

  /**
   * Tell one side of the cycle it is open. Two buttons rather than a
   * multi-select of "who to notify": the choice is which group, the action is
   * sending, and a list that only looked like it sent anything was worse than
   * no list at all.
   */
  const notifyGroup = (group: 'submitter' | 'approver') => {
    if (!opening) return;
    const users = loadUsers(seedUsers());
    const domain = mailDomain(loadSettings(DEFAULT_SETTINGS));
    const to = [
      ...new Set(
        covered
          .map((e) => (group === 'submitter' ? e.submitter : e.approver))
          .filter((name) => name && name !== '—')
          .map((name) => emailForName(name, users, domain)),
      ),
    ];
    openEmail({
      to,
      subject: `${opening.id} is open — ${weekLabel(opening.weekKey)} cash flow forecast`,
      body:
        `Hi all,\n\n` +
        `Forecast cycle ${opening.id} for ${weekLabel(opening.weekKey)} is now open` +
        `${forEntities.length > 0 ? ` for ${covered.map((e) => e.name).join(', ')}` : ''}.\n` +
        `It closes ${opening.closes}.\n\n` +
        (group === 'submitter'
          ? 'Please enter and submit your forecast in Liquid.\n\n'
          : 'Please approve the forecasts as they arrive in Liquid.\n\n') +
        `${window.location.origin + window.location.pathname}\n\nBest regards,\nTreasury`,
    });
  };

  return (
    <div className="view active">
      <TopBar crumb="Treasury" title="Forecast Cycles" />
      <div className="content">
        <div className="panel" data-tour="cycles-table">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>{rows.filter((r) => r.cycle.status === 'submitted').length} open</strong>{' '}
              <span className="text-muted">
                · {rows.filter((r) => r.cycle.status === 'scheduled').length} scheduled ahead ·{' '}
                {rows.filter((r) => r.cycle.status === 'consolidated').length} closed
              </span>
            </div>
            <span className="text-muted" style={{ fontSize: 11 }}>
              Upcoming weeks are already scheduled — open the one you want, for whichever entities
              it covers.
            </span>
          </div>
          <div className="panel-body no-pad">
            <table>
              <thead>
                <tr>
                  <th>Cycle ID</th>
                  <th>Forecast Week</th>
                  <th>Opened</th>
                  <th>Closes</th>
                  <th>Status</th>
                  <th>Entities</th>
                  <th>Submissions</th>
                  <th className="num">Total (€M)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ cycle, summary }) => {
                  const isOpen = cycle.status === 'submitted';
                  const scheduled = cycle.status === 'scheduled';
                  const pill = CYCLE_PILL[cycle.status];
                  return (
                    <tr key={cycle.id} className={scheduled ? 'row-inactive' : ''}>
                      <td>
                        <strong>{cycle.id}</strong>
                      </td>
                      <td className="text-dim">{weekLabel(cycle.weekKey)}</td>
                      <td className="text-dim">{scheduled ? '—' : since(cycle.openedAt)}</td>
                      <td className="text-dim">{cycle.closes}</td>
                      <td>
                        <StatusPill status={pill.status} label={pill.label} />
                      </td>
                      <td className="text-dim">
                        {cycle.entities ? `${cycle.entities.length} of ${entities.length}` : 'All'}
                      </td>
                      <td className="text-dim">
                        {scheduled ? '—' : `${summary.received} / ${summary.expected}`}
                      </td>
                      <td className="num">{scheduled ? '—' : `€${summary.totalM.toFixed(1)}M`}</td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() =>
                            isOpen ? setClosing(cycle) : startOpening(cycle)
                          }
                        >
                          {isOpen ? 'Close' : scheduled ? 'Open' : 'Reopen'}
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

      {/* ---------- Open a cycle ---------- */}
      <Modal
        open={opening !== null}
        title={opening ? `Open ${opening.id}?` : 'Open cycle'}
        onClose={() => setOpening(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setOpening(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={confirmOpen}>
              Open Cycle
            </button>
          </>
        }
      >
        {opening && (
          <>
            <p className="text-dim" style={{ marginBottom: 14 }}>
              {weekLabel(opening.weekKey)} · closes {opening.closes}. Only the entities this cycle
              covers can enter or change figures for that week.
            </p>
            <div className="form-group">
              <label className="form-label">Open For</label>
              <MultiSelect
                ariaLabel="Entities this cycle collects from"
                options={entities.map((e) => e.name)}
                selected={forEntities}
                onChange={setForEntities}
                emptyLabel="All entities"
                noun="entities"
                placeholder="Search entities…"
              />
              <p className="form-hint">
                {forEntities.length === 0
                  ? `Every active entity (${entities.length}).`
                  : `${forEntities.length} of ${entities.length} entities.`}
              </p>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Notify</label>
              <div className="row-flex">
                <button className="btn btn-ghost" onClick={() => notifyGroup('submitter')}>
                  Notify Submitters
                </button>
                <button className="btn btn-ghost" onClick={() => notifyGroup('approver')}>
                  Notify Approvers
                </button>
              </div>
              <p className="form-hint">
                Opens a mail draft to the {covered.length}{' '}
                {covered.length === 1 ? 'entity' : 'entities'} above.
              </p>
            </div>
          </>
        )}
      </Modal>

      {/* ---------- Close a cycle ---------- */}
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
