import { useState } from 'react';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { askForCommentary, type CommentaryTarget } from '../../data/commentaryService';
import { pctChange, requesterLabel } from '../../data/submissionService';
import type { CommentRequest } from '../../types';

interface RequestCommentaryModalProps {
  /** The cell being asked about. Mount the dialog only when there is one. */
  target: CommentaryTarget;
  /** Context line for the panel head, e.g. "Netherlands · CW 33". */
  context?: string;
  /** A question already open on this cell — asking again replaces it. */
  existing?: CommentRequest | null;
  /** Whether the variance threshold flagged this cell (heading wording). */
  flagged?: boolean;
  onClose: () => void;
  /** The question was recorded and the mail draft opened. */
  onSent?: (request: CommentRequest) => void;
}

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

/**
 * Treasury's (or an approver's) question about one cell.
 *
 * The only place a question is asked from: the forecast grid, the forecast
 * preview dialog and Comments Review all raise this same dialog, so the
 * submitter gets the same thing whichever screen it was asked on — and the
 * asker's role is recorded rather than assumed to be treasury.
 */
export function RequestCommentaryModal({
  target,
  context,
  existing,
  flagged = false,
  onClose,
  onSent,
}: RequestCommentaryModalProps) {
  const { notify } = useDialog();
  const [draft, setDraft] = useState('');

  const pct = target.prior === null ? null : pctChange(target.current, target.prior);

  const send = async () => {
    const message = draft.trim();
    if (!message) {
      await notify({ tone: 'error', message: 'Write the question you want answered first.' });
      return;
    }
    const request = askForCommentary(target, message);
    onSent?.(request);
    onClose();
  };

  return (
    <Modal
      open
      title="Request Commentary"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void send()}
            title="Ask the submitter to explain this cell and email them about it"
          >
            Send Request
          </button>
        </>
      }
    >
      <div className="variance-panel" style={{ marginBottom: 18 }}>
        <h4>
          {flagged ? 'Flagged Cell' : 'Cell'}
          {context ? ` · ${context}` : ''}
        </h4>
        <div className="row">
          <span>
            {target.label} · {target.periodLabel}
          </span>
          <span>
            {target.prior === null
              ? 'new period'
              : pct === null
                ? '—'
                : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
          </span>
        </div>
        <div className="row">
          <span>Prior: {target.prior === null ? '—' : fmtK(target.prior)}</span>
          <span>Current: {fmtK(target.current)}</span>
        </div>
      </div>
      {/* A question already waiting on this cell — so a second one adds to it
          rather than repeating it. */}
      {existing && (
        <div className="comment-request-note">
          <strong>
            {existing.from} ({requesterLabel(existing.fromRole)}) already asked:
          </strong>{' '}
          {existing.message}
        </div>
      )}
      {/* What the submitter has said so far, as context — read-only, because
          writing their commentary for them is not the job. */}
      <div className="form-group">
        <label className="form-label">Submitter’s commentary</label>
        <div className="readback">{target.comment?.trim() || 'No commentary provided yet.'}</div>
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">What do you want explained?</label>
        <textarea
          className="form-textarea"
          placeholder="e.g. This is triple last week's payables — is a one-off settlement included?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Request message"
        />
        <span className="text-muted" style={{ fontSize: 11 }}>
          Sending marks the cell for the submitter and opens an Outlook draft to them. A
          submitted forecast comes back to them to answer and resubmit.
        </span>
      </div>
    </Modal>
  );
}
