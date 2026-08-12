// ============================================================================
// The analyst's cycle checklist: what a submitter, approver or viewer has in
// front of them this week, in the order it happens. The Dashboard renders
// this; it does not decide any of it, so the rules live here alongside the
// other submission logic and can move behind an API later untouched.
// ============================================================================
import type { Cycle, CommentRequest, RequesterRole, Submission, User } from '../types';
import { assignedEntitiesFor, permissionsFor } from './session';
import { templateDayLabels } from './periods';
import {
  activeReopen,
  openQuestionEntries,
  peekSubmission,
  requesterSummary,
  templateForEntity,
} from './submissionService';
import { loadSubmission, loadTemplates } from '../storage/localStorage';

/**
 * How a checklist step is doing.
 * - `done`     — finished (green)
 * - `blocked`  — needs attention before anything else moves (red)
 * - `active`   — actionable right now
 * - `waiting`  — not yet actionable, or someone else's move (grey)
 */
export type StepState = 'done' | 'blocked' | 'active' | 'waiting';

export interface TodoStep {
  key: 'submit' | 'review' | 'feedback';
  label: string;
  state: StepState;
  /** One line of why it is in that state. */
  detail: string;
}

export interface AnalystTodo {
  steps: TodoStep[];
  /**
   * Index into `steps` of the one the user is on right now — the step the
   * checklist raises above the others. -1 when there is nothing to be on
   * (no entities assigned).
   */
  currentStep: number;
  /** Whether the whole cycle is finished from this user's point of view. */
  allDone: boolean;
  /** Per-entity detail the screen lists underneath. */
  entities: EntityProgress[];
}

/**
 * Which step a user is standing on: whatever is blocking them, else whatever
 * they can act on, else the first thing not yet finished. With everything
 * done it is the last step, so the checklist still raises where they ended up
 * rather than pointing at nothing.
 */
function currentStepIndex(steps: TodoStep[]): number {
  if (steps.length === 0) return -1;
  const byState = (state: StepState) => steps.findIndex((s) => s.state === state);
  const blocked = byState('blocked');
  if (blocked >= 0) return blocked;
  const active = byState('active');
  if (active >= 0) return active;
  const waiting = byState('waiting');
  if (waiting >= 0) return waiting;
  return steps.length - 1;
}

export interface EntityProgress {
  entity: string;
  templateId: string;
  templateName: string;
  submission: Submission;
  /** Whether this week's forecast has actually been saved yet. */
  started: boolean;
  /** Flagged cells with no commentary — treasury cannot close on these. */
  needCommentary: number;
  /** Open questions (treasury's or the approver's) waiting on a reply. */
  openQuestions: number;
  flagged: number;
  returnedForUpdate: boolean;
  /**
   * This forecast has been submitted before and came back because someone
   * asked about a cell. Without it a reopened forecast is indistinguishable
   * from one never started — both are simply "draft".
   */
  reopenedByQuestion: boolean;
}

/**
 * One open question, ready to list: which cell it is on, who asked it and
 * what they asked. The checklist shows these so a reopened forecast arrives
 * with its questions in hand rather than as a grid to go hunting through.
 */
export interface OpenQuestion {
  entity: string;
  templateId: string;
  /** Cell key, `${catIdx}-${dayIdx}` — deep-links straight to the cell. */
  key: string;
  /** "Receivables · Mon 10/8" */
  cellLabel: string;
  from: string;
  role: RequesterRole;
  message: string;
  requestedAt: string;
}

/** Every open question across an analyst's forecasts, oldest first. */
export function openQuestionsFor(entities: EntityProgress[]): OpenQuestion[] {
  const templates = loadTemplates();
  return entities
    .flatMap((e) => {
      const template = templates.find((t) => t.id === e.templateId);
      const labels = templateDayLabels(template, e.submission.period);
      return openQuestionEntries(e.submission.commentRequests).map(([key, request]) => {
        const [c, d] = key.split('-').map(Number);
        const line = template?.categories[c]?.label ?? `Line ${c + 1}`;
        const when = labels[d] ? `${labels[d].dow} ${labels[d].dm}` : `Day ${d + 1}`;
        return {
          entity: e.entity,
          templateId: e.templateId,
          key,
          cellLabel: `${line} · ${when}`,
          from: request.from,
          role: request.fromRole ?? 'treasury',
          message: request.message,
          requestedAt: request.requestedAt,
        };
      });
    })
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** Everything one analyst has in flight for a forecast week. */
export function entityProgressFor(user: User, week: string): EntityProgress[] {
  const templates = loadTemplates();
  return assignedEntitiesFor(user).flatMap((entity) => {
    const template = templateForEntity(templates, entity);
    if (!template) return [];
    const submission = peekSubmission(entity, week, template);
    const needCommentary = submission.flags.filter(
      (k) => !submission.comments?.[k]?.trim(),
    ).length;
    return [
      {
        entity,
        templateId: template.id,
        templateName: template.name,
        submission,
        started: loadSubmission(week, entity, template.id) !== null,
        needCommentary,
        openQuestions: openQuestionEntries(submission.commentRequests).length,
        flagged: submission.flags.length,
        returnedForUpdate: submission.status === 'rejected',
        reopenedByQuestion: activeReopen(submission) !== null,
      },
    ];
  });
}

/**
 * The ordered checklist for one analyst — get the numbers in, clear the
 * review, hand over — with the wording, the states and the STEPS THEMSELVES
 * following the role:
 *
 * - A SUBMITTER submits, explains variances and answers questions: all three.
 * - An APPROVER never submits, so that step is not theirs to stand on. Their
 *   checklist is two steps: review & approve, then await feedback.
 * - A VIEWER acts on nothing; every step is a status report.
 *
 * `pendingApprovals` is passed in rather than recomputed because the
 * Approvals screen already owns that queue's definition, and two versions of
 * "what is waiting for me" would drift apart.
 */
export function analystTodo(
  user: User,
  week: string,
  cycle: Cycle | undefined,
  pendingApprovals: number,
): AnalystTodo {
  const entities = entityProgressFor(user, week);
  const p = permissionsFor(user);
  const isApprover = p.canApproveForecasts;
  const isSubmitter = p.canSubmitForecasts;

  const questions: CommentRequest[] = entities.flatMap((e) =>
    openQuestionEntries(e.submission.commentRequests).map(([, request]) => request),
  );
  const openQuestions = questions.length;
  const askedBy = requesterSummary(questions.map((q) => q.fromRole));
  const needCommentary = entities.reduce((s, e) => s + e.needCommentary, 0);
  const returned = entities.filter((e) => e.returnedForUpdate).length;
  const unsubmitted = entities.filter((e) => e.submission.status === 'draft').length;
  // Drafts that have been submitted before and came back because of a
  // question. Counting them as plain drafts told a submitter they had not
  // started a forecast they had in fact already sent.
  const reopens = entities.flatMap((e) => activeReopen(e.submission) ?? []);
  const reopened = reopens.length;
  const neverSubmitted = unsubmitted - reopened;
  // Who sent it back — read off the reopening itself, because the questions
  // that caused it are gone from the open list the moment they are answered.
  const reopenedBy = requesterSummary(reopens.map((r) => r.role));
  // "Consolidated" is treasury's terminal state for a cycle; until then the
  // numbers can still come back.
  const cycleClosed = cycle?.status === 'consolidated';

  // ---- Step 1: the numbers arrive ---------------------------------------
  const submitDone = unsubmitted === 0 && entities.length > 0;
  let submit: TodoStep;
  if (isSubmitter) {
    // A RETURNED forecast puts this step back in play, and so does a question
    // asked after the handover: that question sends the whole forecast back
    // (the number itself may have to change), so the step has to say the
    // forecast is coming round again rather than starting for the first time.
    const resubmitting = reopened > 0 && neverSubmitted === 0;
    // Once the questions are answered the step is no longer about answering:
    // what is left is sending the forecast back, and saying "answer it" over
    // an empty question list is how a finished job reads as an outstanding one.
    const answeredAndWaiting = reopened > 0 && openQuestions === 0;
    const wasWere = reopened === 1 ? ' was' : 's were';
    submit = {
      key: 'submit',
      label: resubmitting
        ? answeredAndWaiting
          ? 'Resubmit forecast'
          : 'Answer & resubmit forecast'
        : 'Submit forecast',
      state: returned > 0 || reopened > 0 ? 'blocked' : submitDone ? 'done' : 'active',
      detail:
        returned > 0
          ? `${returned} forecast${returned === 1 ? ' was' : 's were'} returned for update`
          : reopened > 0
            ? `${reopened} already-submitted forecast${wasWere} reopened by a question from ${reopenedBy}` +
              (answeredAndWaiting
                ? ' — answered, now send it back'
                : ' — answer it and submit again') +
              (neverSubmitted > 0 ? ` · ${neverSubmitted} still in draft` : '')
            : submitDone
              ? `All ${entities.length} forecast${entities.length === 1 ? '' : 's'} submitted`
              : `${unsubmitted} of ${entities.length} still in draft`,
    };
  } else {
    // Approvers and viewers never submit — this step tracks the submitters.
    submit = {
      key: 'submit',
      label: 'Forecasts submitted',
      state: submitDone ? 'done' : 'waiting',
      detail: submitDone
        ? `All ${entities.length} of your entit${entities.length === 1 ? 'y’s' : 'ies’'} forecasts are in`
        : `${unsubmitted} of ${entities.length} still with the submitter${returned > 0 ? ` · ${returned} returned for update` : ''}${
            reopened > 0 ? ` · ${reopened} reopened by a question` : ''
          }`,
    };
  }

  // ---- Step 2: clear whatever review is yours ---------------------------
  let review: TodoStep;
  if (isApprover) {
    // An approver can decide each forecast as it arrives — their review is
    // never gated on the stragglers.
    review = {
      key: 'review',
      label: 'Review & approve',
      state: pendingApprovals > 0 ? 'active' : submitDone ? 'done' : 'waiting',
      detail:
        pendingApprovals > 0
          ? `${pendingApprovals} forecast${pendingApprovals === 1 ? '' : 's'} waiting for your decision`
          : submitDone
            ? 'Every submitted forecast is decided'
            : 'Nothing waiting — forecasts appear here as they are submitted',
    };
  } else if (isSubmitter) {
    // Treasury's questions land here, not on step 1: they are answered with
    // commentary, which stays open to the submitter after the handover.
    review = {
      key: 'review',
      label: 'Complete any review',
      state:
        submit.state === 'active'
          ? 'waiting'
          : openQuestions > 0
            ? 'blocked'
            : needCommentary > 0
              ? 'active'
              : 'done',
      detail:
        submit.state === 'active'
          ? 'Opens once your forecasts are in'
          : openQuestions > 0
            ? `${openQuestions} open question${openQuestions === 1 ? '' : 's'} from ${askedBy}`
            : needCommentary === 0
              ? 'Nothing waiting on you'
              : `${needCommentary} variance${needCommentary === 1 ? '' : 's'} to explain`,
    };
  } else {
    // Viewer: purely informational.
    review = {
      key: 'review',
      label: 'Review in progress',
      state: needCommentary > 0 || pendingApprovals > 0 ? 'waiting' : submitDone ? 'done' : 'waiting',
      detail:
        needCommentary > 0
          ? `${needCommentary} variance${needCommentary === 1 ? '' : 's'} still being explained`
          : submitDone
            ? 'Review complete'
            : 'Starts once the forecasts are in',
    };
  }

  // ---- Step 3: hand over to treasury ------------------------------------
  const earlierDone = submit.state === 'done' && review.state === 'done';
  const feedback: TodoStep = {
    key: 'feedback',
    label: 'Await treasury feedback',
    state: !earlierDone ? 'waiting' : cycleClosed ? 'done' : 'active',
    detail: !earlierDone
      ? 'Opens once the steps above are clear'
      : cycleClosed
        ? `Cycle ${cycle?.id ?? ''} closed`.trim()
        : 'Treasury is reviewing — nothing to do',
  };

  // An approver never submits, so "forecasts submitted" was a status line on
  // someone else's work sitting at the top of their own to-do list. Their
  // checklist is the two steps that are actually theirs: decide, then wait.
  const steps = isApprover ? [review, feedback] : [submit, review, feedback];

  return {
    steps,
    currentStep: entities.length === 0 ? -1 : currentStepIndex(steps),
    allDone: steps.every((s) => s.state === 'done'),
    entities,
  };
}
