import { CyclePill, TopBar } from '../layout/TopBar';
import { TreasuryOverview } from './TreasuryOverview';
import { listCycles } from '../../data/appData';
import { currentWeekKey } from '../../data/periods';
import { loadCycles } from '../../storage/localStorage';
import type { SubmissionTarget } from '../submissions/Submission';
import type { ModalId } from '../../types/nav';

interface DashboardProps {
  onOpenModal: (id: ModalId) => void;
  onOpenSubmission?: (target: SubmissionTarget) => void;
}

/**
 * The treasury workspace, on one page.
 *
 * Cycle progress, the consolidated forecast and forecast-vs-forecast used to
 * be three screens; each answered a question you could only ask after leaving
 * the one before it. The page itself is now `TreasuryOverview` — stat boxes,
 * the group outlook with its country matrix, and the consolidated forecast —
 * which an approver gets under their checklist too, scoped to their own
 * countries. What is left here is the cycle chrome around it.
 */
export function Dashboard({ onOpenModal, onOpenSubmission }: DashboardProps) {
  const week = currentWeekKey();
  const cycles = loadCycles(listCycles());
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];

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
      <div className="content content-compact">
        <TreasuryOverview
          week={week}
          cycleId={activeCycle?.id ?? 'CW-2026-21'}
          cycleCloses={activeCycle?.closes}
          onOpenSubmission={onOpenSubmission}
        />
      </div>
    </div>
  );
}
