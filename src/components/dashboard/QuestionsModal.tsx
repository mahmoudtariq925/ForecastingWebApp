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
  /**
   * Open questions only. An answered one is a thread somebody has already
   * dealt with: it belongs to the Questions page, where the conversation is,
   * and listing it here padded a box about what is still owed with rows that
   * owe nothing — five of the eight in the report.
   */
  const ordered = rows
    .filter((r) => r.state === 'awaiting')
    .sort((a, b) => new Date(a.lastAt).getTime() - new Date(b.lastAt).getTime());

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
          {ordered.length} waiting on a reply
        </span>
      </div>
      {ordered.length === 0 ? (
        <div className="empty-state">
          <div className="ic">✓</div>
          <p>
            {rows.length === 0
              ? 'Nobody has asked a question on this cycle yet.'
              : 'Every question on this cycle has been answered.'}
          </p>
        </div>
      ) : (
        <div className="panel-body no-pad">
          {/* Columns with no widths let every row set its own: a country name
              wrapped onto two lines here, a date onto two lines there, and
              "24h ago" broke under its own pill. The columns are sized now,
              and what a cell holds is stacked in it rather than strung across
              the table — one shape per row, whatever the content. */}
          <table className="questions-table">
            <colgroup>
              <col className="q-col-cell" />
              <col className="q-col-who" />
              <col className="q-col-question" />
              <col className="q-col-state" />
              <col className="q-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Country · cell</th>
                <th>Asked by</th>
                <th>Question</th>
                <th>Waiting</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.id} className="is-awaiting">
                  <td>
                    <span className="q-primary">{r.entity}</span>
                    <span className="q-secondary" title={`${r.category} · ${r.dateLabel}`}>
                      {r.category} · {r.dateLabel}
                    </span>
                  </td>
                  <td>
                    <span className="q-primary q-plain" title={r.from}>
                      {r.from}
                    </span>
                    <span className="q-secondary">{requesterLabel(r.role)}</span>
                  </td>
                  {/* Two lines of the question rather than sixty characters of
                      it: the old cut landed mid-word ("is a suppl…") and told
                      the reader nothing they could act on. */}
                  <td>
                    <span className="q-question" title={r.message}>
                      {r.message}
                    </span>
                  </td>
                  {/* How long, and nothing else. Every row here is waiting —
                      the header says so, and the amber edge down the left says
                      so again — so a pill reading "waiting" on each of them
                      was the same word three times and the one figure that
                      differs between rows in the small print underneath. */}
                  <td>
                    <span className="badge-num warn" title="Still waiting on a reply">
                      {agoLabel(r.lastAt)}
                    </span>
                  </td>
                  <td className="q-action">
                    <button className="btn btn-ghost btn-small" onClick={() => onOpen(r)}>
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
