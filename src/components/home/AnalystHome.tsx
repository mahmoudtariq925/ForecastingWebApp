import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ForecastPreviewModal } from '../submissions/ForecastPreviewModal';
import { listCycles, listEntities } from '../../data/appData';
import { assignedEntitiesFor, permissionsFor } from '../../data/session';
import { currentWeekKey, weekLabel, weekLabelShort } from '../../data/periods';
import {
  applyApprovalDecision,
  mergedEntityStatus,
  peekSubmission,
  pendingApprovalCount,
  submissionGaps,
  submitStoredForecast,
  templateForEntity,
} from '../../data/submissionService';
import {
  analystTodo,
  type EntityProgress,
  type StepState,
  type TodoStep,
} from '../../data/todoService';
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

/**
 * One numbered step of the cycle checklist. The whole row is the button when
 * the step has somewhere to go — its countries, its comments — so the list
 * reads as a set of doors rather than a status report with a button on it.
 */
function ChecklistStep({
  index,
  step,
  action,
  dataTour,
  onOpen,
}: {
  index: number;
  step: TodoStep;
  action?: React.ReactNode;
  dataTour?: string;
  onOpen?: () => void;
}) {
  return (
    <div
      className={`todo-step todo-${step.state}${onOpen ? ' todo-clickable' : ''}`}
      data-tour={dataTour}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
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
 * The countries behind a checklist step, listed in a modal.
 *
 * The dashboard used to repeat every entity as a panel below the checklist,
 * which meant the same list twice for anyone with more than one country.
 * Now the step itself opens the list.
 */
function EntityListModal({
  open,
  title,
  subtitle,
  rows,
  canEdit,
  onClose,
  onOpenForecast,
  onReview,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  rows: EntityProgress[];
  canEdit: boolean;
  onClose: () => void;
  onOpenForecast: (row: EntityProgress) => void;
  onReview?: (row: EntityProgress) => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      size="wide"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="preview-meta">
        <span className="text-dim">{subtitle}</span>
        <span className="progress-summary">
          {rows.length} forecast{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="ic">✎</div>
          <p>
            No entities are assigned to you yet. Treasury assigns responsibilities under Legal
            Entity Setup.
          </p>
        </div>
      ) : (
        <div className="entity-list">
          {rows.map((w) => (
            <div className="entity-list-row" key={w.entity}>
              <div className="entity-list-info">
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
              <div className="row-flex">
                {canEdit && w.openQuestions > 0 && (
                  <span className="badge-num warn">
                    {w.openQuestions} question{w.openQuestions === 1 ? '' : 's'}
                  </span>
                )}
                {canEdit && w.needCommentary > 0 && (
                  <span className="badge-num">{w.needCommentary} to explain</span>
                )}
                {onReview && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '5px 12px', fontSize: 12 }}
                    onClick={() => onReview(w)}
                  >
                    Review &amp; Submit
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  style={{ padding: '5px 12px', fontSize: 12 }}
                  data-tour="open-forecast"
                  onClick={() => onOpenForecast(w)}
                >
                  Open Forecast
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
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
  const { notify } = useDialog();
  // Bumped after a submit / approval from this screen so everything re-reads.
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [countriesOpen, setCountriesOpen] = useState(true);
  /** The checklist's country list — what "My Forecasts" used to be. */
  const [entityList, setEntityList] = useState(false);

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
      {/* Opening a forecast belongs to the checklist step that asks for it,
          so the top bar carries no action of its own. */}
      <TopBar
        crumb={`My Workspace · ${work.map((w) => w.entity).join(' · ')}`}
        title={`Welcome, ${firstName}`}
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
              onOpen={work.length > 0 ? () => setEntityList(true) : undefined}
              action={
                work.length > 0 && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    data-tour="todo-submit"
                    title="See the countries this step covers"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEntityList(true);
                    }}
                  >
                    {canEditForecasts ? 'Submit Forecast' : 'View Forecasts'}
                  </button>
                )
              }
            />
            <ChecklistStep
              index={2}
              step={todo.steps[1]}
              onOpen={
                isApprover
                  ? () => setCountriesOpen((v) => !v)
                  : canEditForecasts
                    ? () => onNavigate('review')
                    : undefined
              }
              action={
                !isApprover &&
                canEditForecasts &&
                todo.steps[1].state === 'active' && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate('review');
                    }}
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
              onOpen={() => onNavigate('review')}
              action={
                todo.steps[2].state !== 'waiting' && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate('review');
                    }}
                  >
                    View Comments
                  </button>
                )
              }
            />
          </div>
        </div>

      </div>

      {/* The checklist's countries: what the removed "My Forecasts" section
          listed, now opened from the step it belongs to. */}
      <EntityListModal
        open={entityList}
        title={canEditForecasts ? 'Forecasts to submit' : 'Your forecasts'}
        subtitle={`${weekLabel(week)} · ${activeCycle?.id ?? '—'}`}
        rows={work}
        canEdit={canEditForecasts}
        onClose={() => setEntityList(false)}
        onOpenForecast={(w) => {
          setEntityList(false);
          onOpenSubmission({ entity: w.entity, week, templateId: w.templateId });
        }}
        onReview={
          canEditForecasts
            ? (w) => {
                setEntityList(false);
                setPreview({ entity: w.entity, mode: 'submit' });
              }
            : undefined
        }
      />

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
