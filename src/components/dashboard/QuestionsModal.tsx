import { Modal } from '../common/Modal';
import { requesterLabel } from '../../data/submissionService';
import type { QuestionItem } from '../../data/questionService';

interface QuestionsModalProps {
  open: boolean;
  rows: QuestionItem[];
  subtitle: string;
  onClose: () => void;
  /** Open the forecast this question is on, focused on its cell. */
  onOpen: (row: QuestionItem) => void;
  /** Go to the Questions queue, where the threads are actually worked. */
  onOpenQueue?: () => void;
}

/** "3h ago" / "2d ago" — how long a thread has been sitting. */
function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Every question treasury or an approver has put to a submitter this cycle.
 *
 * Only questions. This box used to rank countries by their largest unexplained
 * variance, which is a different job with a different owner — nobody has asked
 * about those yet, and the forecast screen's variance badge is where they are
 * worked. Mixing the two under one number was what made "commentary" ambiguous.
 *
 * It is a summary, not the workspace: the whole conversation, replying and
 * closing threads, live on the Questions page, so the way out of here is a door
 * to it rather than a copy of it.
 */
export function QuestionsModal({
  open,
  rows,
  subtitle,
  onClose,
  onOpen,
  onOpenQueue,
}: QuestionsModalProps) {
  const awaiting = rows.filter((r) => r.state === 'awaiting');
  const answered = rows.length - awaiting.length;
  // Waiting first, longest wait at the top: the ones somebody is held up by.
  const ordered = [...rows].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'awaiting' ? -1 : 1;
    return new Date(a.lastAt).getTime() - new Date(b.lastAt).getTime();
  });

  return (
    <Modal
      open={open}
      title="Questions asked"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          {onOpenQueue && (
            <button
              className="btn btn-primary"
              onClick={onOpenQueue}
              title="Open the Questions page, where threads are answered and closed"
            >
              Open Questions Page →
            </button>
          )}
        </>
      }
    >
      <div className="preview-meta">
        <span className="text-dim">{subtitle}</span>
        <span className="progress-summary">
          {awaiting.length} waiting on a reply
          {answered > 0 ? ` · ${answered} answered` : ''}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="ic">✓</div>
          <p>Nobody has asked a question on this cycle yet.</p>
        </div>
      ) : (
        <div className="panel-body no-pad">
          <table>
            <thead>
              <tr>
                <th>Country</th>
                <th>Line item</th>
                <th>Asked by</th>
                <th>Question</th>
                <th>Last activity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.entity}</strong>
                  </td>
                  <td className="text-dim">
                    {r.category} · {r.dateLabel}
                  </td>
                  <td className="text-dim">
                    {r.from} ({requesterLabel(r.role)})
                  </td>
                  <td className="text-dim" title={r.message}>
                    {r.message.length > 60 ? `${r.message.slice(0, 60)}…` : r.message}
                  </td>
                  <td className="text-dim">
                    <span
                      className={`badge-num${r.state === 'awaiting' ? ' warn' : ''}`}
                      title={
                        r.state === 'awaiting'
                          ? 'Still waiting on a reply'
                          : 'The submitter has replied'
                      }
                    >
                      {r.state === 'awaiting' ? 'waiting' : 'answered'}
                    </span>{' '}
                    {agoLabel(r.lastAt)}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => onOpen(r)}
                    >
                      Open Forecast
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
