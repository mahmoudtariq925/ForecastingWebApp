// ============================================================================
// The analyst's cycle checklist: what a submitter or approver has to do this
// week, in the order they have to do it. The Dashboard renders this; it does
// not decide any of it, so the rules live here alongside the other submission
// logic and can move behind an API later untouched.
// ============================================================================
import type { Cycle, Submission, User } from '../types';
import { assignedEntitiesFor, permissionsFor } from './session';
import { peekSubmission, templateForEntity } from './submissionService';
import { loadSubmission, loadTemplates } from '../storage/localStorage';

/**
 * How a checklist step is doing.
 * - `done`     — finished (green)
 * - `blocked`  — finished but something came back and needs attention (red)
 * - `active`   — actionable right now
 * - `waiting`  — not yet actionable, an earlier step is outstanding (grey)
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
  /** Whether anything at all is actionable, for the "all clear" case. */
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
 * The ordered checklist for a submitter or approver.
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

  const openQuestions = entities.reduce((s, e) => s + e.openQuestions, 0);
  const needCommentary = entities.reduce((s, e) => s + e.needCommentary, 0);
  const returned = entities.filter((e) => e.returnedForUpdate).length;
  const unsubmitted = entities.filter((e) => e.submission.status === 'draft').length;
  // "Consolidated" is treasury's terminal state for a cycle; until then the
  // numbers can still come back.
  const cycleClosed = cycle?.status === 'consolidated' || cycle?.status === 'approved';

  // ---- Step 1: get the numbers in --------------------------------------
  const submitBlocked = openQuestions > 0 || returned > 0;
  const submitDone = unsubmitted === 0 && entities.length > 0;
  const submit: TodoStep = {
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

  // ---- Step 2: clear whatever review is yours ---------------------------
  const reviewOutstanding = isApprover ? pendingApprovals : needCommentary;
  const review: TodoStep = {
    key: 'review',
    label: 'Complete any review',
    state:
      submit.state === 'active'
        ? 'waiting'
        : reviewOutstanding > 0
          ? 'active'
          : 'done',
    detail:
      submit.state === 'active'
        ? 'Opens once your forecasts are in'
        : reviewOutstanding === 0
          ? 'Nothing waiting on you'
          : isApprover
            ? `${pendingApprovals} forecast${pendingApprovals === 1 ? '' : 's'} to approve`
            : `${needCommentary} variance${needCommentary === 1 ? '' : 's'} to explain`,
  };

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
    if (submit.state === 'blocked')
      return returned > 0
        ? 'Up next: update the forecast Treasury returned'
        : 'Up next: answer Treasury’s open questions';
    if (submit.state === 'active') return 'Up next: submit your forecast';
    if (review.state === 'active')
      return isApprover
        ? 'Up next: approve the forecasts waiting on you'
        : 'Up next: explain your flagged variances';
    if (feedback.state === 'done') return 'You are fully done, cycle closed';
    return 'Up next: await comments';
  };

  return {
    steps: [submit, review, feedback],
    upNext: upNext(),
    allDone: submit.state === 'done' && review.state === 'done' && feedback.state === 'done',
    entities,
  };
}
