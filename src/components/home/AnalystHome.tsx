import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { ForecastPreview } from '../submissions/ForecastPreview';
import { useDialog } from '../common/dialogContext';
import { listCycles, listEntities } from '../../data/appData';
import { assignedEntitiesFor, permissionsFor } from '../../data/session';
import { currentWeekKey, prevWeekKey, weekLabel, weekLabelShort } from '../../data/periods';
import {
  applyApprovalDecision,
  mergedEntityStatus,
  peekSubmission,
  pendingApprovalCount,
  submitForecast,
  templateForEntity,
} from '../../data/submissionService';
import { analystTodo, type StepState, type TodoStep } from '../../data/todoService';
import { loadApprovals, loadCycles, loadTemplates } from '../../storage/localStorage';
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
  children,
}: {
  index: number;
  step: TodoStep;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
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
      {children}
    </>
  );
}

/** What the review-and-confirm dialog is being used for. */
interface PreviewTarget {
  entity: string;
  mode: 'submit' | 'approve';
}

/**
 * The submitter / approver landing page: an ordered checklist of what this
 * cycle needs from them — get the numbers in, clear whatever review is
 * theirs, then hand over to treasury — rather than a wall of numbers they
 * have to interpret before knowing what to do.
 */
export function AnalystHome({ user, onOpenSubmission, onNavigate }: AnalystHomeProps) {
  const week = currentWeekKey();
  const { notify } = useDialog();
  const cycles = loadCycles(listCycles());
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];
  const permissions = permissionsFor(user);
  const isApprover = permissions.canApproveForecasts;
  // Bumped after submitting/approving from here so the checklist recomputes.
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const templates = useMemo(() => loadTemplates(), []);
  const [overrides, setOverrides] = useState(() => loadApprovals(activeCycle?.id ?? ''));

  const todo = useMemo(() => {
    void version;
    // An approver's queue is scoped to their own entities, same as the
    // Approvals screen — the checklist must not count someone else's work.
    const pending = isApprover
      ? pendingApprovalCount(week, overrides, assignedEntitiesFor(user))
      : 0;
    return analystTodo(user, week, activeCycle, pending);
  }, [user, week, activeCycle, isApprover, overrides, version]);

  const work = todo.entities;
  const canEditForecasts = permissions.canSubmitForecasts;
  const firstName = user.name.split(' ')[0];
  const first = work[0];

  // ---- The approver's per-country queue (replaces the Approvals screen) ---
  const approverRows = useMemo(() => {
    if (!isApprover) return [];
    void version;
    const all = listEntities();
    return assignedEntitiesFor(user).flatMap((name) => {
      const entity = all.find((e) => e.name === name);
      const template = templateForEntity(templates, name);
      if (!entity || !template) return [];
      const sub = peekSubmission(name, week, template);
      return [
        {
          name,
          templateId: template.id,
          status: mergedEntityStatus(entity, week, template.id, overrides),
          flags: sub.flags.length,
        },
      ];
    });
  }, [isApprover, user, week, templates, overrides, version]);
  const [queueOpen, setQueueOpen] = useState(true);

  const approve = async (entity: string, templateId: string) => {
    setOverrides(applyApprovalDecision(week, entity, templateId, 'approved'));
    setPreview(null);
    setVersion((n) => n + 1);
    await notify({ tone: 'success', message: `${entity} approved for ${weekLabelShort(week)}.` });
  };

  const submitFromChecklist = async (entity: string) => {
    const templateId = templateForEntity(templates, entity)?.id;
    if (!templateId) return;
    submitForecast(week, entity, templateId);
    setPreview(null);
    setVersion((n) => n + 1);
    await notify({ tone: 'success', message: 'Forecast submitted for approval.' });
  };

  const previewTemplateId = preview
    ? templateForEntity(templates, preview.entity)?.id ?? ''
    : '';

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
                canEditForecasts &&
                first &&
                todo.steps[0].state !== 'done' && (
                  <span className="row-flex">
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() =>
                        onOpenSubmission({
                          entity: first.entity,
                          week,
                          templateId: first.templateId,
                        })
                      }
                    >
                      Open Forecast
                    </button>
                    {todo.steps[0].state === 'active' && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        data-tour="checklist-submit"
                        title="Review the saved forecast and submit it from here"
                        onClick={() => setPreview({ entity: first.entity, mode: 'submit' })}
                      >
                        Submit Forecast
                      </button>
                    )}
                  </span>
                )
              }
            />
            <ChecklistStep
              index={2}
              step={todo.steps[1]}
              action={
                !isApprover &&
                canEditForecasts &&
                todo.steps[1].state === 'active' && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => onNavigate('review')}
                  >
                    Open Comments
                  </button>
                )
              }
            >
              {/* The approver's decisions happen RIGHT HERE: their countries,
                  each with Approve (confirm dialog with the forecast) or
                  Review (read the full grid first). */}
              {isApprover && approverRows.length > 0 && (
                <div className="approver-queue" data-tour="approver-queue">
                  <button
                    className="approver-queue-toggle"
                    aria-expanded={queueOpen}
                    onClick={() => setQueueOpen((v) => !v)}
                  >
                    <span className="section-caret" aria-hidden="true">
                      {queueOpen ? '▾' : '▸'}
                    </span>
                    Your countries ({approverRows.length})
                  </button>
                  {queueOpen &&
                    approverRows.map((row) => (
                      <div className="approver-queue-row" key={row.name}>
                        <strong>{row.name}</strong>
                        <StatusPill status={row.status} />
                        {row.flags > 0 && (
                          <span className="badge-num">{row.flags} flagged</span>
                        )}
                        <span className="row-flex" style={{ marginLeft: 'auto' }}>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            title="Open the full forecast, read-only"
                            onClick={() =>
                              onOpenSubmission({
                                entity: row.name,
                                week,
                                templateId: row.templateId,
                              })
                            }
                          >
                            Review
                          </button>
                          {row.status === 'approved' ? (
                            <span className="text-muted" style={{ fontSize: 11 }}>
                              Approved ✓
                            </span>
                          ) : (
                            <button
                              className="btn btn-success"
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              data-tour="queue-approve"
                              title="See the forecast and confirm the approval"
                              onClick={() => setPreview({ entity: row.name, mode: 'approve' })}
                            >
                              Approve
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </ChecklistStep>
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
                  {canEditForecasts && w.openQuestions > 0 && (
                    <span className="badge-num warn">
                      {w.openQuestions} question{w.openQuestions === 1 ? '' : 's'} to answer
                    </span>
                  )}
                  {canEditForecasts && w.needCommentary > 0 && (
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
              {canEditForecasts &&
                (w.openQuestions > 0 || w.needCommentary > 0 || w.returnedForUpdate) && (
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

      {/* Review-and-confirm dialog: the saved forecast, read-only, with the
          chart underneath — submitting or approving happens from here. */}
      {preview && (
        <ForecastPreview
          open
          title={preview.mode === 'submit' ? 'Review & Submit Forecast' : 'Approve Forecast'}
          entity={preview.entity}
          week={week}
          onClose={() => setPreview(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                Cancel
              </button>
              {preview.mode === 'submit' ? (
                <>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setPreview(null);
                      onOpenSubmission({
                        entity: preview.entity,
                        week,
                        templateId: previewTemplateId,
                      });
                    }}
                  >
                    Open Full Forecast
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => void submitFromChecklist(preview.entity)}
                  >
                    Submit for Approval
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-success"
                  onClick={() => void approve(preview.entity, previewTemplateId)}
                >
                  ✓ Approve
                </button>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
