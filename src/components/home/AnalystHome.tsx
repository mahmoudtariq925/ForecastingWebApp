import { useMemo } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { listCycles } from '../../data/appData';
import { assignedEntitiesFor, permissionsFor } from '../../data/session';
import { currentWeekKey, prevWeekKey, weekLabel, weekLabelShort } from '../../data/periods';
import { pendingApprovalCount } from '../../data/submissionService';
import { analystTodo, type StepState, type TodoStep } from '../../data/todoService';
import { loadApprovals, loadCycles } from '../../storage/localStorage';
import type { User } from '../../types';
import type { ViewId } from '../../types/nav';
import type { SubmissionTarget } from '../submissions/Submission';

interface AnalystHomeProps {
  user: User;
  onOpenSubmission: (target: SubmissionTarget) => void;
  onNavigate: (view: ViewId) => void;
}

function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const STEP_MARK: Record<StepState, string> = {
  done: '✓',
  blocked: '!',
  active: '→',
  waiting: '·',
};

/** One numbered step of the cycle checklist. */
function ChecklistStep({
  index,
  step,
  action,
}: {
  index: number;
  step: TodoStep;
  action?: React.ReactNode;
}) {
  return (
    <div className={`todo-step todo-${step.state}`}>
      <span className="todo-mark" aria-hidden="true">
        {STEP_MARK[step.state]}
      </span>
      <span className="todo-index">{index}</span>
      <span className="todo-body">
        <strong>{step.label}</strong>
        <span className="todo-detail">{step.detail}</span>
      </span>
      {action}
    </div>
  );
}

/**
 * The submitter / approver landing page: an ordered checklist of what this
 * cycle needs from them — get the numbers in, clear whatever review is
 * theirs, then hand over to treasury — rather than a wall of numbers they
 * have to interpret before knowing what to do.
 */
export function AnalystHome({ user, onOpenSubmission, onNavigate }: AnalystHomeProps) {
  const week = currentWeekKey();
  const cycles = loadCycles(listCycles());
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];
  const permissions = permissionsFor(user);
  const isApprover = permissions.canApproveForecasts;

  const todo = useMemo(() => {
    // An approver's queue is scoped to their own entities, same as the
    // Approvals screen — the checklist must not count someone else's work.
    const pending = isApprover
      ? pendingApprovalCount(
          week,
          loadApprovals(activeCycle?.id ?? ''),
          assignedEntitiesFor(user),
        )
      : 0;
    return analystTodo(user, week, activeCycle, pending);
  }, [user, week, activeCycle, isApprover]);

  const work = todo.entities;
  const canEditForecasts = permissions.canSubmitForecasts;
  const firstName = user.name.split(' ')[0];
  const first = work[0];

  return (
    <div className="view active">
      <TopBar
        crumb={`My Workspace · ${work.map((w) => w.entity).join(' · ')}`}
        title={`Welcome, ${firstName}`}
        actions={
          first && (
            <button
              className="btn btn-primary"
              onClick={() =>
                onOpenSubmission({ entity: first.entity, week, templateId: first.templateId })
              }
            >
              {!canEditForecasts
                ? 'View Current Forecast'
                : first.started && first.submission.status === 'draft'
                  ? 'Continue Forecast'
                  : 'Open Current Forecast'}
            </button>
          )
        }
      />
      <div className="content">
        {/* Same cycle banner treasury sees, so both sides quote the same
            deadline when they talk about "this cycle". */}
        <div className="cycle-banner" data-tour="analyst-cycle">
          <div>
            <span className="nav-label" style={{ padding: 0 }}>
              Active cycle
            </span>
            <div className="cycle-banner-id">{activeCycle?.id ?? '—'}</div>
          </div>
          <div className="cycle-banner-meta">
            <span>
              <strong>{weekLabelShort(week)}</strong> · {weekLabel(week)}
            </span>
            <span className="text-muted">Closes {activeCycle?.closes ?? '—'}</span>
          </div>
          <div className={`up-next up-${todo.allDone ? 'done' : 'open'}`} data-tour="up-next">
            {todo.upNext}
          </div>
        </div>

        <div className="section-header">
          <h2>Your Cycle Checklist</h2>
          <span className="tag">in order · {work.length} entit{work.length === 1 ? 'y' : 'ies'}</span>
        </div>
        <div className="panel">
          <div className="todo-list" data-tour="analyst-todo">
            <ChecklistStep
              index={1}
              step={todo.steps[0]}
              action={
                first &&
                todo.steps[0].state !== 'done' && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() =>
                      onOpenSubmission({
                        entity: first.entity,
                        week,
                        templateId: first.templateId,
                      })
                    }
                  >
                    {todo.steps[0].state === 'blocked' ? 'Open Forecast' : 'Enter Forecast'}
                  </button>
                )
              }
            />
            <ChecklistStep
              index={2}
              step={todo.steps[1]}
              action={
                todo.steps[1].state === 'active' && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => onNavigate(isApprover ? 'approvals' : 'review')}
                  >
                    {isApprover ? 'Open Approvals' : 'Open Comments'}
                  </button>
                )
              }
            />
            <ChecklistStep
              index={3}
              step={todo.steps[2]}
              action={
                todo.steps[2].state !== 'waiting' && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => onNavigate('review')}
                  >
                    View Comments
                  </button>
                )
              }
            />
          </div>
        </div>

        <div className="section-header">
          <h2>My Forecasts</h2>
          <span className="tag">
            {weekLabelShort(week)} · {activeCycle?.id ?? '—'}
          </span>
        </div>
        {work.length === 0 ? (
          <div className="panel">
            <div className="empty-state">
              <div className="ic">✎</div>
              <p>
                No entities are assigned to you yet. Treasury assigns responsibilities under Legal
                Entity Setup.
              </p>
            </div>
          </div>
        ) : (
          work.map((w) => (
            <div className="panel" key={w.entity}>
              <div className="analyst-forecast-row">
                <div className="analyst-forecast-info">
                  <strong>{w.entity}</strong>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {w.templateName}
                  </span>
                  <StatusPill
                    status={w.submission.status}
                    label={w.returnedForUpdate ? 'returned for update' : w.submission.status}
                  />
                  <span className="text-dim" style={{ fontSize: 12 }}>
                    {w.started ? `Last saved ${agoLabel(w.submission.updatedAt)}` : 'Not started yet'}
                  </span>
                </div>
                <div className="row-flex" data-tour="analyst-forecast-actions">
                  {w.openQuestions > 0 && (
                    <span className="badge-num warn">
                      {w.openQuestions} question{w.openQuestions === 1 ? '' : 's'} to answer
                    </span>
                  )}
                  {w.needCommentary > 0 && (
                    <span className="badge-num">
                      {w.needCommentary} variance{w.needCommentary === 1 ? '' : 's'} to explain
                    </span>
                  )}
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() =>
                      onOpenSubmission({ entity: w.entity, week, templateId: w.templateId })
                    }
                  >
                    {!canEditForecasts
                      ? 'View Forecast'
                      : !w.started
                        ? 'Open Current Forecast'
                        : w.submission.status === 'draft'
                          ? 'Continue Forecast'
                          : 'Open Forecast'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() =>
                      onOpenSubmission({
                        entity: w.entity,
                        week: prevWeekKey(week),
                        templateId: w.templateId,
                      })
                    }
                  >
                    View Previous
                  </button>
                </div>
              </div>
              {(w.openQuestions > 0 || w.needCommentary > 0 || w.returnedForUpdate) && (
                <div
                  className={`variance-panel${w.openQuestions > 0 ? ' comment-request-panel' : ''}`}
                  style={{ margin: '0 20px 16px', borderRadius: 4 }}
                >
                  <h4>Feedback from Treasury</h4>
                  <div className="row">
                    <span>
                      {w.openQuestions > 0
                        ? `Treasury asked about ${w.openQuestions} cell${w.openQuestions === 1 ? '' : 's'} — open the forecast and reply on each one.`
                        : w.returnedForUpdate
                          ? 'This forecast was returned — update the figures and resubmit.'
                          : `${w.needCommentary} flagged cell${w.needCommentary === 1 ? '' : 's'} still need${w.needCommentary === 1 ? 's' : ''} commentary before Treasury can close the cycle.`}
                    </span>
                    <span>
                      {w.flagged} flagged · {w.needCommentary} unexplained
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
