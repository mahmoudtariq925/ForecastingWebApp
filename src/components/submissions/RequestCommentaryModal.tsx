import { useState } from 'react';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { QuestionThread } from '../review/QuestionThread';
import {
  askForCommentary,
  submitterFor,
  type CommentaryTarget,
} from '../../data/commentaryService';
import { pctChange, threadOf } from '../../data/submissionService';
import type { CommentRequest } from '../../types';

interface RequestCommentaryModalProps {
  /** The cell being asked about. Mount the dialog only when there is one. */
  target: CommentaryTarget;
  /** Context line for the panel head, e.g. "Netherlands · CW 33". */
  context?: string;
  /** A conversation already running on this cell — asking again continues it. */
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

  /** Nobody to ask: the question would be recorded and reach no one. The line
   *  item decides who that is — see Legal Entity Setup. */
  const submitter = submitterFor(target.entity, target.label);

  const send = async () => {
    const message = draft.trim();
    if (!message) {
      await notify({ tone: 'error', message: 'Write the question you want answered first.' });
      return;
    }
    if (!submitter) {
      await notify({
        tone: 'error',
        title: 'No submitter for this entity',
        message: `${target.entity} has nobody assigned to submit its forecast, so this question would reach no one. Assign a submitter under Legal Entity Setup first.`,
      });
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
      {/* The conversation so far, so a second question adds to it rather than
          repeating it — and so the answers that came back are read against the
          questions that produced them. */}
      {existing ? (
        <QuestionThread
          messages={threadOf(existing, target.comment ?? '', submitter?.name ?? 'Submitter')}
        />
      ) : (
        <div className="form-group">
          <label className="form-label">Submitter’s commentary</label>
          <div className="readback">
            {target.comment?.trim() || 'No commentary provided yet.'}
          </div>
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">
          {existing ? 'Your follow-up' : 'What do you want explained?'}
        </label>
        <textarea
          className="form-textarea"
          placeholder="e.g. This is triple last week's payables — is a one-off settlement included?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Request message"
        />
        <span className="text-muted" style={{ fontSize: 11 }}>
          {submitter
            ? `Sending marks the cell for ${submitter.name} and opens an Outlook draft to them. The forecast stays where it is — what changes is that they owe a reply.`
            : `${target.entity} has nobody assigned to submit its forecast — assign a submitter under Legal Entity Setup before asking, or the question reaches no one.`}
        </span>
      </div>
    </Modal>
  );
}
