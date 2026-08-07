import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { useDialog } from '../common/dialogContext';
import { ForecastPreviewModal } from '../submissions/ForecastPreviewModal';
import { listCycles, listEntities } from '../../data/appData';
import { assignedEntitiesFor, permissionsFor } from '../../data/session';
import { currentWeekKey, prevWeekKey, weekLabel, weekLabelShort } from '../../data/periods';
import {
  applyApprovalDecision,
  mergedEntityStatus,
  peekSubmission,
  pendingApprovalCount,
  submissionGaps,
  submitStoredForecast,
  templateForEntity,
} from '../../data/submissionService';
import { analystTodo, type StepState, type TodoStep } from '../../data/todoService';
import { loadApprovals, loadCycles, loadTemplates } from '../../storage/localStorage';
import type { SubmissionStatus, User } from '../../types';
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
  dataTour,
}: {
  index: number;
  step: TodoStep;
  action?: React.ReactNode;
  dataTour?: string;
}) {
  return (
    <div className={`todo-step todo-${step.state}`} data-tour={dataTour}>
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

/** What the forecast preview modal was opened for. */
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
  const cycles = loadCycles(listCycles());
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];
  const permissions = permissionsFor(user);
  const isApprover = permissions.canApproveForecasts;
  const { notify } = useDialog();
  // Bumped after a submit / approval from this screen so everything re-reads.
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [countriesOpen, setCountriesOpen] = useState(true);

  const todo = useMemo(() => {
    void version;
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
  }, [user, week, activeCycle, isApprover, version]);

  // The approver's decision list: every country they cover, with Review /
  // Approve in place — this replaces the separate Approvals screen.
  const approverRows = useMemo(() => {
    if (!isApprover) return [];
    void version;
    const scoped = assignedEntitiesFor(user);
    const templates = loadTemplates();
    const overrides = loadApprovals(activeCycle?.id ?? '');
    return listEntities()
      .filter((e) => scoped.includes(e.name))
      .map((e) => {
        const templateId = templateForEntity(templates, e.name)?.id ?? '';
        return { entity: e.name, templateId, status: mergedEntityStatus(e, week, templateId, overrides) };
      });
  }, [isApprover, user, week, activeCycle, version]);
  const awaitingDecision = (s: SubmissionStatus) => s === 'submitted' || s === 'pending';
  const waitingCount = approverRows.filter((r) => awaitingDecision(r.status)).length;

  const work = todo.entities;
  const canEditForecasts = permissions.canSubmitForecasts;
  const firstName = user.name.split(' ')[0];
  const first = work[0];

  /** Approve straight from the preview modal. */
  const approveNow = async (entity: string) => {
    const templateId = templateForEntity(loadTemplates(), entity)?.id ?? '';
    applyApprovalDecision(week, entity, templateId, 'approved');
    setPreview(null);
    setVersion((n) => n + 1);
    await notify({ tone: 'success', message: `${entity} forecast approved for ${weekLabel(week)}.` });
  };

  /** Submit from the preview modal — or, when the forecast still has gaps,
   * hand over to the Submission screen where the guided fixes live. */
  const submitNow = async (entity: string) => {
    const template = templateForEntity(loadTemplates(), entity);
    if (!template) return;
    const gaps = submissionGaps(peekSubmission(entity, week, template), template);
    if (gaps.emptyCells.length > 0 || gaps.uncommented.length > 0) {
      setPreview(null);
      onOpenSubmission({ entity, week, templateId: template.id, autoSubmit: true });
      return;
    }
    submitStoredForecast(week, entity, template.id);
    setPreview(null);
    setVersion((n) => n + 1);
    await notify({ tone: 'success', message: `${entity} forecast submitted for approval.` });
  };

  const previewTemplateId = preview
    ? templateForEntity(loadTemplates(), preview.entity)?.id
    : undefined;

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
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    data-tour="todo-submit"
                    title="Review the saved forecast and submit it from here"
                    onClick={() => setPreview({ entity: first.entity, mode: 'submit' })}
                  >
                    Submit Forecast
                  </button>
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
            />
            {/* The approver decides right here: review opens the forecast,
                approve confirms it over a read-only preview. */}
            {isApprover && approverRows.length > 0 && (
              <div className="todo-countries" data-tour="todo-approvals">
                <button
                  className="todo-countries-head"
                  aria-expanded={countriesOpen}
                  onClick={() => setCountriesOpen((v) => !v)}
                >
                  <span className="section-caret" aria-hidden="true">
                    {countriesOpen ? '▾' : '▸'}
                  </span>
                  Your countries · {approverRows.length}
                  {waitingCount > 0 && (
                    <span className="badge-num warn">{waitingCount} waiting on you</span>
                  )}
                </button>
                {countriesOpen &&
                  approverRows.map((r) => (
                    <div className="todo-country-row" key={r.entity}>
                      <strong>{r.entity}</strong>
                      <StatusPill status={r.status} />
                      <span className="row-flex" style={{ marginLeft: 'auto' }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          title="Open the full forecast read-only"
                          onClick={() =>
                            onOpenSubmission({ entity: r.entity, week, templateId: r.templateId })
                          }
                        >
                          Review
                        </button>
                        {awaitingDecision(r.status) ? (
                          <button
                            className="btn btn-success"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => setPreview({ entity: r.entity, mode: 'approve' })}
                          >
                            Approve
                          </button>
                        ) : r.status === 'approved' ? (
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            Approved ✓
                          </span>
                        ) : (
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            with submitter
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <ChecklistStep
              index={3}
              step={todo.steps[2]}
              dataTour="todo-feedback"
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
                  data-tour="analyst-feedback"
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

      {/* Mounted fresh per open so the sections start collapsed every time. */}
      {preview && (
        <ForecastPreviewModal
          open
          entity={preview.entity}
          week={week}
          title={
            preview.mode === 'approve'
              ? `Approve · ${preview.entity} · ${weekLabelShort(week)}`
              : `Review & Submit · ${preview.entity} · ${weekLabelShort(week)}`
          }
          onClose={() => setPreview(null)}
          actions={
            preview.mode === 'approve' ? (
              <button className="btn btn-success" onClick={() => void approveNow(preview.entity)}>
                Approve Forecast
              </button>
            ) : (
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
                {canEditForecasts && (
                  <button
                    className="btn btn-primary"
                    onClick={() => void submitNow(preview.entity)}
                  >
                    Submit for Approval
                  </button>
                )}
              </>
            )
          }
        />
      )}
    </div>
  );
}
