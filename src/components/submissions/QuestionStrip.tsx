import { requesterLabel, requesterSummary } from '../../data/submissionService';
import type { RequesterRole } from '../../types';

/** The bits of a question the strip needs — a cell, an author, a sentence. */
export interface StripQuestion {
  key: string;
  from: string;
  fromRole?: RequesterRole;
  message: string;
}

interface QuestionStripProps {
  /** Questions still waiting on an answer. */
  open: StripQuestion[];
  /** Questions that have come back with a reply. */
  answered: StripQuestion[];
  /**
   * Which side of the conversation is reading. The submitter OWES the
   * answers, so their strip ends in a way into them; everybody else is
   * waiting on someone, so theirs says who.
   */
  viewer: 'submitter' | 'reviewer';
  /** Who the reviewer is waiting on — reviewer wording only. */
  awaiting?: string;
  /** Answers already written, for the answered chip's tooltip. */
  answers?: Record<string, string>;
  /** "Receivables · Mon 4 Aug" for a cell key. */
  cellLabel: (key: string) => string;
  onOpen: (key: string) => void;
}

/**
 * Every question on a forecast, as one line above the grid.
 *
 * The submitter used to get a panel here instead: a heading, a paragraph
 * explaining that blue cells have questions on them, and a full-width row per
 * question. Three questions came to a third of the screen before a single
 * number was visible — on the one screen whose entire job is the numbers, and
 * for information the grid already carries in the cells themselves.
 *
 * The line says the same things in the order they are wanted: how many, from
 * whom, WHICH CELLS, and a way in. Naming the cells is what the paragraph
 * never did — "Payroll · Wed 12" is the question, far more than its prose is.
 */
export function QuestionStrip({
  open,
  answered,
  viewer,
  awaiting,
  answers,
  cellLabel,
  onOpen,
}: QuestionStripProps) {
  if (open.length === 0 && answered.length === 0) return null;
  const isSubmitter = viewer === 'submitter';
  const askers = requesterSummary(open.map((q) => q.fromRole));

  return (
    <div
      className={`review-question-strip${open.length === 0 ? ' strip-settled' : ''}${
        isSubmitter && open.length > 0 ? ' strip-mine' : ''
      }`}
    >
      <span className="strip-mark" aria-hidden="true">
        {open.length > 0 ? '?' : '✓'}
      </span>
      {open.length > 0 ? (
        <>
          <strong>
            {open.length} question{open.length === 1 ? '' : 's'}{' '}
            {isSubmitter ? `from ${askers}` : 'outstanding'}
          </strong>
          {!isSubmitter && (
            <span className="text-dim">
              awaiting {awaiting ?? 'the submitter'}’s reply · asked by {askers}
            </span>
          )}
          <span className="strip-cells">
            {open.map((q) => (
              <button
                key={q.key}
                className="strip-cell"
                title={`${q.from} (${requesterLabel(q.fromRole)}): ${q.message}`}
                onClick={() => onOpen(q.key)}
              >
                {cellLabel(q.key)}
              </button>
            ))}
            {/* The submitter's way in. Without it the chips read as labels
                rather than as the list of work still to do. */}
            {isSubmitter && (
              <button className="strip-answer" onClick={() => onOpen(open[0].key)}>
                {open.length === 1 ? 'Answer' : 'Answer all'} →
              </button>
            )}
          </span>
        </>
      ) : (
        <strong>
          {answered.length} question{answered.length === 1 ? '' : 's'} answered
        </strong>
      )}
      {/* The replies. Opening one shows the question and the answer over the
          number they are about. */}
      {answered.length > 0 && (
        <span className="strip-answered">
          <span className="text-dim">
            {open.length > 0
              ? `${answered.length} answered`
              : isSubmitter
                ? 'open one to read it back'
                : 'open one to read the reply'}
          </span>
          <span className="strip-cells">
            {answered.map((q) => (
              <button
                key={q.key}
                className="strip-cell answered"
                title={`${q.from} (${requesterLabel(q.fromRole)}) asked: ${q.message}${
                  answers?.[q.key]?.trim() ? ` — answered: ${answers[q.key]}` : ''
                }`}
                onClick={() => onOpen(q.key)}
              >
                {cellLabel(q.key)}
              </button>
            ))}
          </span>
        </span>
      )}
    </div>
  );
}
