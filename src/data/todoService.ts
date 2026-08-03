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
  /** The single sentence at the top telling them what to do now. */
  upNext: string;
  /** Whether the whole cycle is finished from this user's point of view. */
  allDone: boolean;
  /** Per-entity detail the screen lists underneath. */
  entities: EntityProgress[];
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
 * The ordered checklist for one analyst. The three steps are the same shape
 * for every role — get the numbers in, clear the review, hand over — but WHO
 * acts differs, and the wording and states follow the role:
 *
 * - A SUBMITTER submits, explains variances and answers questions.
 * - An APPROVER waits for forecasts to arrive, then approves or returns
 *   them. Submitting is never their step, so it can be waiting on others
 *   but never red or actionable for them.
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
    const submitBlocked = openQuestions > 0 || returned > 0;
    submit = {
      key: 'submit',
      label: 'Submit forecast',
      state: submitBlocked ? 'blocked' : submitDone ? 'done' : 'active',
      detail: submitBlocked
        ? returned > 0
          ? `${returned} forecast${returned === 1 ? ' was' : 's were'} returned for update`
          : `${openQuestions} open question${openQuestions === 1 ? '' : 's'} from Treasury`
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
    review = {
      key: 'review',
      label: 'Complete any review',
      state:
        submit.state === 'active'
          ? 'waiting'
          : needCommentary > 0
            ? 'active'
            : 'done',
      detail:
        submit.state === 'active'
          ? 'Opens once your forecasts are in'
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

  const upNext = (): string => {
    if (entities.length === 0) return 'No entities are assigned to you yet.';
    if (!isSubmitter && !isApprover) {
      return cycleClosed
        ? 'Cycle closed — you have read-only access'
        : 'You have read-only access — nothing needs your action';
    }
    if (isApprover) {
      if (pendingApprovals > 0) return 'Up next: approve the forecasts waiting on you';
      if (!submitDone) return 'Up next: await your submitters’ forecasts';
      if (cycleClosed) return 'You are fully done, cycle closed';
      return 'Up next: await comments';
    }
    if (submit.state === 'blocked')
      return returned > 0
        ? 'Up next: update the forecast Treasury returned'
        : 'Up next: answer Treasury’s open questions';
    if (submit.state === 'active') return 'Up next: submit your forecast';
    if (review.state === 'active') return 'Up next: explain your flagged variances';
    if (cycleClosed) return 'You are fully done, cycle closed';
    return 'Up next: await comments';
  };

  return {
    steps: [submit, review, feedback],
    upNext: upNext(),
    allDone: submit.state === 'done' && review.state === 'done' && feedback.state === 'done',
    entities,
  };
}
