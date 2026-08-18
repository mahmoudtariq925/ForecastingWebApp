import { useState } from 'react';
import { waitedLabel } from '../../data/questionService';
import { threadRoleLabel } from '../../data/submissionService';
import type { ThreadMessage, ThreadRole } from '../../types';

interface QuestionThreadProps {
  messages: ThreadMessage[];
  /**
   * The side the reader is on. Their own messages sit on the right, the other
   * side's on the left — the shape of the conversation then says who is
   * waiting on whom before a word of it is read.
   */
  viewerRole?: ThreadRole | null;
  /** Compact rendering for a board card: the last exchange, no timestamps. */
  compact?: boolean;
}

/**
 * The last exchange in a thread: the most recent QUESTION and the answer that
 * came back to it, if one has.
 *
 * A card showing simply "the last two messages" could show two answers in a
 * row and no question at all, which is the one thing that makes an answer
 * readable. This always leads with what was asked.
 */
function lastExchange(messages: ThreadMessage[]): ThreadMessage[] {
  let askIdx = -1;
  messages.forEach((m, i) => {
    if (m.role !== 'submitter') askIdx = i;
  });
  if (askIdx < 0) return messages.slice(-1);
  const ask = messages[askIdx];
  // The latest answer to THAT question — earlier answers belong to earlier
  // questions and are read by opening the thread.
  const answer = [...messages.slice(askIdx + 1)].reverse().find((m) => m.role === 'submitter');
  return answer ? [ask, answer] : [ask];
}

/**
 * A question and everything said after it, as a conversation.
 *
 * A question about a forecast cell is rarely settled in one exchange — the
 * answer raises another question, a figure gets corrected, treasury comes back
 * for the detail. Showing only "asked / answered" hid all of that: the second
 * question overwrote the first and the thread of reasoning behind a number was
 * gone.
 */
export function QuestionThread({ messages, viewerRole, compact = false }: QuestionThreadProps) {
  const shown = compact ? lastExchange(messages) : messages;
  const hidden = messages.length - shown.length;
  return (
    <div className={`thread${compact ? ' thread-compact' : ''}`}>
      {compact && hidden > 0 && (
        <div className="thread-more">
          + {hidden} earlier message{hidden === 1 ? '' : 's'} — open to read the whole thread
        </div>
      )}
      {shown.map((m, i) => (
        <div
          key={`${m.at}-${i}`}
          className={`bubble-row role-${m.role}${
            viewerRole && m.role === viewerRole ? ' is-mine' : ''
          }`}
        >
          <div className="bubble">
            <div className="bubble-head">
              <strong>{m.from}</strong>
              <span className={`role-tag ${m.role}`}>{threadRoleLabel(m.role)}</span>
              {/* "just now" already reads as a time; "just now ago" does not. */}
              {!compact && (
                <span className="bubble-time">
                  {waitedLabel(m.at) === 'just now' ? 'just now' : `${waitedLabel(m.at)} ago`}
                </span>
              )}
            </div>
            <p className="bubble-text">{m.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ThreadComposerProps {
  /** The side the reader writes from — it decides the wording and the label. */
  role: ThreadRole;
  /** Extra hint under the box, e.g. that a figure can be corrected too. */
  hint?: string;
  /**
   * Wording for a conversation that is not a question about a cell. An
   * intercompany mismatch is between two entities on the same side of the
   * workflow, so "answer the question" describes neither of them.
   */
  placeholder?: string;
  sendLabel?: string;
  onSend: (text: string) => void;
}

/** The reply box under a thread. Empty replies are simply not sendable. */
export function ThreadComposer({
  role,
  hint,
  placeholder,
  sendLabel,
  onSend,
}: ThreadComposerProps) {
  const [draft, setDraft] = useState('');
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };
  return (
    <div className="thread-composer">
      <textarea
        className="form-textarea"
        rows={3}
        placeholder={
          placeholder ??
          (role === 'submitter'
            ? 'Answer the question — what drives this number?'
            : 'Ask a follow-up…')
        }
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // Enter sends, Shift+Enter breaks the line: this is a chat box, and
        // reaching for the mouse to send a one-line reply is the slow path.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        aria-label={
          sendLabel ?? (role === 'submitter' ? 'Your answer' : 'Your follow-up question')
        }
      />
      <div className="thread-composer-actions">
        <span className="text-muted" style={{ fontSize: 12 }}>
          {hint ?? 'Enter sends · Shift+Enter for a new line'}
        </span>
        <button className="btn btn-primary" disabled={!draft.trim()} onClick={send}>
          {sendLabel ?? (role === 'submitter' ? 'Send Answer' : 'Send Question')}
        </button>
      </div>
    </div>
  );
}
