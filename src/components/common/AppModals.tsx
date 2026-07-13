import { Modal } from './Modal';
import type { ModalId } from '../../types/nav';

export interface VarianceDetail {
  category: string;
  delta: string;
  prior: string;
  current: string;
}

interface AppModalsProps {
  modal: ModalId;
  onClose: () => void;
  varianceDetail?: VarianceDetail;
  onOpenCycle: () => void;
}

/**
 * The four dialogs from the prototype. Each keeps the original fields and the
 * "action → toast" behaviour; wiring these to real submits is a Phase 2 task.
 */
export function AppModals({ modal, onClose, varianceDetail, onOpenCycle }: AppModalsProps) {
  const vd = varianceDetail ?? {
    category: 'Customer Receipts · Day 14',
    delta: '+34.1%',
    prior: '€2,150k',
    current: '€2,883k',
  };

  return (
    <>
      <Modal
        open={modal === 'newCycle'}
        title="Open New Forecast Cycle"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={onOpenCycle}>
              Open Cycle
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Cycle ID</label>
          <input className="form-input" defaultValue="CW-2026-22" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input className="form-input" type="date" defaultValue="2026-05-25" />
          </div>
          <div className="form-group">
            <label className="form-label">Submission Deadline</label>
            <input className="form-input" type="datetime-local" defaultValue="2026-05-29T18:00" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notify</label>
          <select className="form-select" multiple style={{ height: 80 }} defaultValue={['All submitters', 'All approvers']}>
            <option>All submitters</option>
            <option>All approvers</option>
            <option>Treasury team only</option>
          </select>
        </div>
      </Modal>

      <Modal
        open={modal === 'export'}
        title="Export Data"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onClose();
                alert('Export started — file will be emailed.');
              }}
            >
              Export
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Format</label>
          <select className="form-select">
            <option>Excel (.xlsx)</option>
            <option>CSV</option>
            <option>JSON</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Scope</label>
          <select className="form-select">
            <option>Current cycle — consolidated</option>
            <option>Current cycle — all submissions</option>
            <option>Last 4 cycles</option>
            <option>Year-to-date</option>
          </select>
        </div>
      </Modal>

      <Modal
        open={modal === 'variance'}
        title="Explain Variance"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onClose();
                alert('Commentary saved.');
              }}
            >
              Save
            </button>
          </>
        }
      >
        <div className="variance-panel" style={{ marginBottom: 18 }}>
          <h4>Flagged Cell</h4>
          <div className="row">
            <span>{vd.category}</span>
            <span>{vd.delta}</span>
          </div>
          <div className="row">
            <span>Prior: {vd.prior}</span>
            <span>Current: {vd.current}</span>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Commentary (required)</label>
          <textarea className="form-textarea" placeholder="Explain the driver behind this variance..." />
        </div>
      </Modal>

      <Modal
        open={modal === 'newUser'}
        title="Add User"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onClose();
                alert('User invited via Azure AD.');
              }}
            >
              Send Invite
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input className="form-input" />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" placeholder="user@contoso.com" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Entity / Team</label>
            <select className="form-select">
              <option>NL Operations</option>
              <option>DE Sales</option>
              <option>FR Manufacturing</option>
              <option>UK Services</option>
              <option>US Corporate</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select">
              <option>Submitter</option>
              <option>Approver</option>
              <option>Treasury</option>
              <option>Admin</option>
            </select>
          </div>
        </div>
      </Modal>
    </>
  );
}
