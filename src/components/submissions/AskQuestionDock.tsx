import { useState } from 'react';
import { useDialog } from '../common/dialogContext';
import { QuestionThread } from '../review/QuestionThread';
import {
  askForCommentary,
  submitterFor,
  type CommentaryTarget,
} from '../../data/commentaryService';
import { pctChange, threadOf } from '../../data/submissionService';
import type { CommentRequest } from '../../types';

interface AskQuestionDockProps {
  /** The cell being asked about. Mount the dock only when there is one. */
  target: CommentaryTarget;
  /** Context line for the head, e.g. "Netherlands · CW 33". */
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
 * Treasury's (or an approver's) question about one cell, asked from a dock
 * beside the forecast rather than a dialog on top of it.
 *
 * This is the same panel the submitter answers in. Asking used to raise a
 * second dialog over the forecast dialog, so the numbers the question is about
 * were behind two layers by the time it was being written — and the two halves
 * of one conversation looked like different features. Docking it puts the
 * question next to the figure it is about, and makes asking and answering the
 * same shape on screen.
 *
 * The rules are unchanged: the line item decides who owes the answer, and a
 * question with nobody to send it to is refused rather than recorded.
 */
export function AskQuestionDock({
  target,
  context,
  existing,
  flagged = false,
  onClose,
  onSent,
}: AskQuestionDockProps) {
  const { notify } = useDialog();
  const [draft, setDraft] = useState('');

  const pct = target.prior === null ? null : pctChange(target.current, target.prior);
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
    <aside className="comment-dock dock-ask" aria-label="Ask the submitter about this cell">
      <div className="comment-dock-head">
        <h4>{existing ? 'Add a follow-up' : 'Ask about this cell'}</h4>
        <button className="close-btn" onClick={onClose} aria-label="Close without asking">
          ×
        </button>
      </div>
      <div className="comment-dock-cell">
        <strong>{target.label}</strong>
        <span className="text-dim">
          {target.periodLabel}
          {context ? ` · ${context}` : ''}
          {flagged ? ' · flagged' : ''}
        </span>
      </div>
      <div className="comment-dock-figures">
        <span>Prior {target.prior === null ? '—' : fmtK(target.prior)}</span>
        <span>Now {fmtK(target.current)}</span>
        <span className={`delta ${pct !== null && pct < 0 ? 'down' : 'up'}`}>
          {target.prior === null
            ? 'new period'
            : pct === null
              ? '—'
              : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
        </span>
      </div>
      {/* The conversation so far, so a second question adds to it rather than
          repeating it — and so the answers are read against the questions that
          produced them. */}
      {existing ? (
        <div className="comment-dock-thread">
          <QuestionThread
            messages={threadOf(existing, target.comment ?? '', submitter?.name ?? 'Submitter')}
          />
        </div>
      ) : (
        <div className="comment-dock-readback">
          <span className="form-label">Submitter’s commentary</span>
          <div className="readback">{target.comment?.trim() || 'No commentary provided yet.'}</div>
        </div>
      )}
      <textarea
        className="form-textarea"
        autoFocus
        placeholder="e.g. This is triple last week's payables — is a one-off settlement included?"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={existing ? 'Your follow-up' : 'Your question'}
      />
      <span className="comment-dock-note">
        {submitter
          ? `Sending marks the cell for ${submitter.name} and opens an Outlook draft. The forecast stays where it is — what changes is that they owe a reply.`
          : `${target.entity} has nobody assigned to submit its forecast — assign one under Legal Entity Setup before asking, or the question reaches no one.`}
      </span>
      <div className="comment-dock-actions">
        <button
          className="btn btn-primary"
          disabled={!draft.trim()}
          onClick={() => void send()}
          title="Ask the submitter to explain this cell and email them about it"
        >
          Send Question
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </aside>
  );
}
