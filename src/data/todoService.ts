// ============================================================================
// The analyst's cycle checklist: what a submitter, approver or viewer has in
// front of them this week, in the order it happens. The Dashboard renders
// this; it does not decide any of it, so the rules live here alongside the
// other submission logic and can move behind an API later untouched.
// ============================================================================
import type { Cycle, Submission, User } from '../types';
import { assignedEntitiesFor, permissionsFor } from './session';
import { peekSubmission, templateForEntity } from './submissionService';
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
  /** Open treasury questions waiting on a reply. */
  openQuestions: number;
  flagged: number;
  returnedForUpdate: boolean;
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
        openQuestions: Object.keys(submission.commentRequests ?? {}).length,
        flagged: submission.flags.length,
        returnedForUpdate: submission.status === 'rejected',
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

  const openQuestions = entities.reduce((s, e) => s + e.openQuestions, 0);
  const needCommentary = entities.reduce((s, e) => s + e.needCommentary, 0);
  const returned = entities.filter((e) => e.returnedForUpdate).length;
  const unsubmitted = entities.filter((e) => e.submission.status === 'draft').length;
  // "Consolidated" is treasury's terminal state for a cycle; until then the
  // numbers can still come back.
  const cycleClosed = cycle?.status === 'consolidated' || cycle?.status === 'approved';

  // ---- Step 1: the numbers arrive ---------------------------------------
  const submitDone = unsubmitted === 0 && entities.length > 0;
  let submit: TodoStep;
  if (isSubmitter) {
    // Only a RETURNED forecast puts this step back in play. A question from
    // treasury does not: submitting is a handover, the numbers are locked
    // behind it, and answering the question is step 2's work — reopening
    // step 1 for it invited a pointless resubmission of unchanged figures.
    submit = {
      key: 'submit',
      label: 'Submit forecast',
      state: returned > 0 ? 'blocked' : submitDone ? 'done' : 'active',
      detail:
        returned > 0
          ? `${returned} forecast${returned === 1 ? ' was' : 's were'} returned for update`
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
        : `${unsubmitted} of ${entities.length} still with the submitter${returned > 0 ? ` · ${returned} returned for update` : ''}`,
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
            ? `${openQuestions} open question${openQuestions === 1 ? '' : 's'} from Treasury`
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
