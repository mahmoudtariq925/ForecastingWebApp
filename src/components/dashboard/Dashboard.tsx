import { CyclePill, TopBar } from '../layout/TopBar';
import { TreasuryOverview } from './TreasuryOverview';
import { activeCycle } from '../../data/cycleService';
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
  // One definition of "the cycle we are in", and the week it collects comes
  // from the cycle itself rather than being picked independently.
  const cycle = activeCycle();

  return (
    <div className="view active">
      <TopBar
        crumb="Overview"
        title="Treasury Dashboard"
        actions={
          <>
            <CyclePill label="Active Cycle" value={cycle.id} />
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
          week={cycle.weekKey}
          cycleId={cycle.id}
          cycleCloses={cycle.closes}
          onOpenSubmission={onOpenSubmission}
        />
      </div>
    </div>
  );
}
