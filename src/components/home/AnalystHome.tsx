import { Fragment, useMemo, useState } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ForecastPreviewModal } from '../submissions/ForecastPreviewModal';
import { TreasuryOverview } from '../dashboard/TreasuryOverview';
import { listEntities } from '../../data/appData';
import { activeCycle } from '../../data/cycleService';
import { useDataVersion } from '../../data/useDataVersion';
import { assignedEntitiesFor, permissionsFor } from '../../data/session';
import { weekLabel, weekLabelShort } from '../../data/periods';
import {
  applyApprovalDecision,
  entityStatus,
  isHandedOver,
  peekSubmission,
  pendingApprovalCount,
  requesterLabel,
  requesterSummary,
  submissionGaps,
  submitStoredForecast,
  templateForEntity,
} from '../../data/submissionService';
import {
  analystTodo,
  openQuestionsFor,
  type EntityProgress,
  type StepState,
  type TodoStep,
} from '../../data/todoService';
import { loadApprovals, loadTemplates } from '../../storage/localStorage';
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

/** Steps the guided tour points at, by key (see tourSteps.ts). */
const STEP_TOUR_ID: Partial<Record<TodoStep['key'], string>> = {
  feedback: 'todo-feedback',
};

/**
 * One numbered step of the cycle checklist. The whole row is the button when
 * the step has somewhere to go — its countries, its comments — so the list
 * reads as a set of doors rather than a status report with a button on it.
 *
 * The step the user is ON is raised: a border, a lift off the page, and the
 * others held back behind it (see `.todo-current` in the CSS). A checklist
 * whose steps all look alike makes you read all of them to find your place.
 */
function ChecklistStep({
  index,
  step,
  action,
  dataTour,
  current,
  onOpen,
}: {
  index: number;
  step: TodoStep;
  action?: React.ReactNode;
  dataTour?: string;
  /** The step the user is standing on right now. */
  current?: boolean;
  onOpen?: () => void;
}) {
  return (
    <div
      className={`todo-step todo-${step.state}${onOpen ? ' todo-clickable' : ''}${
        current ? ' todo-current' : ''
      }`}
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
  /** `revise` opens an already-submitted forecast unlocked for editing. */
  onOpenForecast: (row: EntityProgress, revise?: boolean) => void;
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
          <div className="ic">?</div>
          <p>
            No entities are assigned to you yet. Treasury assigns responsibilities under Legal
            Entity Setup.
          </p>
        </div>
      ) : (
        <div className="entity-list">
          {rows.map((w) => {
            // A forecast that is already in reads as done — greyed, ticked —
            // but it is not out of reach: figures can still be corrected while
            // the cycle is open, and the row is where that starts.
            const submitted = isHandedOver(w.submission.status);
            return (
            <div
              className={`entity-list-row${submitted ? ' row-submitted' : ''}`}
              key={w.entity}
            >
              <div className="entity-list-info">
                <strong>{w.entity}</strong>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {w.templateName}
                </span>
                <StatusPill
                  status={w.submission.status}
                  label={
                    w.returnedForUpdate
                      ? 'returned for update'
                      : w.revised
                        ? 'changed — resubmit'
                        : w.submission.status
                  }
                />
                <span className="text-dim" style={{ fontSize: 12 }}>
                  {/* A revised forecast has been sent once already — saying
                      "not started" or only "last saved" hid that entirely. */}
                  {w.revised
                    ? 'Submitted once · figures changed, send it back for approval'
                    : w.started
                      ? `Last saved ${agoLabel(w.submission.updatedAt)}`
                      : 'Not started yet'}
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
                {onReview &&
                  (submitted ? (
                    <>
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        Submitted ✓
                      </span>
                      {canEdit && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '5px 12px', fontSize: 12 }}
                          title="Open this forecast unlocked — changing a figure sends it round for approval again"
                          onClick={() => onOpenForecast(w, true)}
                        >
                          Edit &amp; Resubmit
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '5px 12px', fontSize: 12 }}
                      onClick={() => onReview(w)}
                    >
                      Review &amp; Submit
                    </button>
                  ))}
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
            );
          })}
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
 *
 * An APPROVER gets two steps (deciding is the only thing that is theirs) and,
 * beneath them, the same treasury overview the dashboard shows, scoped to
 * their own countries: they are judging forecasts, and the group position is
 * what a forecast is judged against.
 */
export function AnalystHome({ user, onOpenSubmission, onNavigate }: AnalystHomeProps) {
  // The cycle decides the week, so the checklist can never be counting a
  // different period from the one named in the header above it.
  const cycle = activeCycle();
  const week = cycle.weekKey;
  const permissions = permissionsFor(user);
  const isApprover = permissions.canApproveForecasts;
  const { notify } = useDialog();
  // Every write to storage re-reads this screen, so the checklist and the
  // overview panel beneath it can never disagree about what has been decided.
  const version = useDataVersion();
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
          loadApprovals(cycle.id),
          assignedEntitiesFor(user),
        )
      : 0;
    return analystTodo(user, week, cycle, pending);
  }, [user, week, cycle, isApprover, version]);

  const scopedEntities = useMemo(() => assignedEntitiesFor(user), [user]);

  /**
   * The questions waiting on this submitter, listed under the step they
   * belong to. A forecast that came back because someone asked about a cell
   * has to READ differently from one being sent for the first time, and the
   * difference is the questions themselves — not a change of wording.
   */
  const questions = useMemo(() => openQuestionsFor(todo.entities), [todo]);
  const [questionsOpen, setQuestionsOpen] = useState(true);
  /**
   * Which step the questions belong under: always the review one. A question
   * no longer sends a forecast back — the figures stand and somebody owes a
   * reply — so answering is review work whether or not the forecast has gone.
   */
  const questionsStep: TodoStep['key'] = 'review';

  // The approver's decision list: every country they cover, with Review /
  // Approve in place — this replaces the separate Approvals screen.
  const approverRows = useMemo(() => {
    if (!isApprover) return [];
    void version;
    const templates = loadTemplates();
    const overrides = loadApprovals(cycle.id);
    return listEntities()
      .filter((e) => scopedEntities.includes(e.name))
      .map((e) => {
        const templateId = templateForEntity(templates, e.name)?.id ?? '';
        return {
          entity: e.name,
          templateId,
          status: entityStatus(e.name, week, templateId, overrides),
        };
      });
  }, [isApprover, scopedEntities, week, cycle, version]);
  const awaitingDecision = (s: SubmissionStatus) => s === 'submitted';
  const waitingCount = approverRows.filter((r) => awaitingDecision(r.status)).length;

  const work = todo.entities;
  const canEditForecasts = permissions.canSubmitForecasts;
  const firstName = user.name.split(' ')[0];
  /**
   * Once every forecast has been handed over, submitting is done: the step is
   * shown as finished and its action recedes to a quiet "Edit & Resubmit"
   * rather than a primary Submit button inviting work that has already moved
   * on. It stays PRESSABLE, because a figure can still be corrected while the
   * cycle is open and a dead button said the week was sealed.
   *
   * Read off the submissions themselves rather than the step's state, so it
   * agrees exactly with the forecast page: a returned forecast reopens this
   * step, and so does a revision — a question on its own does not, because it
   * asks for a reply rather than for the forecast back.
   */
  const submitClosed =
    canEditForecasts &&
    work.length > 0 &&
    work.every((w) => isHandedOver(w.submission.status));

  /** Approve straight from the preview modal. */
  const approveNow = async (entity: string) => {
    const templateId = templateForEntity(loadTemplates(), entity)?.id ?? '';
    applyApprovalDecision(week, entity, templateId, 'approved');
    setPreview(null);
    // storage writes refresh this screen on their own — see useDataVersion.
    await notify({ tone: 'success', message: `${entity} forecast approved for ${weekLabel(week)}.` });
  };

  /**
   * Hand a forecast back to its submitter so they can change it — the other
   * half of the approver's decision, and the way back in after a sign-off.
   */
  const returnForUpdate = async (entity: string) => {
    const templateId = templateForEntity(loadTemplates(), entity)?.id ?? '';
    applyApprovalDecision(week, entity, templateId, 'rejected');
    setPreview(null);
    // storage writes refresh this screen on their own — see useDataVersion.
    await notify({
      message: `${entity} forecast returned to its submitter for update.`,
    });
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
    // storage writes refresh this screen on their own — see useDataVersion.
    await notify({ tone: 'success', message: `${entity} forecast submitted for approval.` });
  };

  const previewTemplateId = preview
    ? templateForEntity(loadTemplates(), preview.entity)?.id
    : undefined;
  /** The forecast the preview is showing is still the submitter's to send. */
  const previewSubmittable =
    preview?.mode === 'submit' &&
    !isHandedOver(
      work.find((w) => w.entity === preview.entity)?.submission.status ?? 'draft',
    );
  /** The approver may still decide on the forecast the preview is showing. */
  const previewDecidable =
    preview?.mode === 'approve' &&
    awaitingDecision(
      approverRows.find((r) => r.entity === preview.entity)?.status ?? 'submitted',
    );

  /**
   * The action button that belongs to a checklist step. Like the row, it is
   * offered only on the step the user is standing on — except the finished
   * Submit step, which keeps its button so the step still reads as a step
   * rather than a bare line of text.
   */
  const actionFor = (step: TodoStep, isCurrent: boolean): React.ReactNode => {
    if (step.key === 'submit' && work.length > 0 && (isCurrent || submitClosed)) {
      // A forecast whose figures changed after the handover is being SENT
      // AGAIN; a button reading "Submit Forecast" made that look like
      // first-time work.
      const resubmitting = work.some((w) => w.revised);
      // Everything is in. The step is done and looks done — but a figure can
      // still be corrected while the cycle is open, and a DISABLED button said
      // the opposite: that the week was sealed and nothing could be fixed. It
      // stays pressable, quietly, and leads to the countries it covers.
      const done = submitClosed;
      return (
        <button
          className={`btn ${done ? 'btn-ghost' : 'btn-primary'}`}
          style={{ padding: '6px 12px', fontSize: 12 }}
          data-tour="todo-submit"
          title={
            done
              ? 'Already submitted — open a forecast to correct a figure and send it again'
              : 'See the countries this step covers'
          }
          onClick={(e) => {
            e.stopPropagation();
            setEntityList(true);
          }}
        >
          {!canEditForecasts
            ? 'View Forecasts'
            : done
              ? 'Edit & Resubmit'
              : resubmitting
                ? 'Resubmit Forecast'
                : 'Submit Forecast'}
        </button>
      );
    }
    if (
      step.key === 'review' &&
      isCurrent &&
      !isApprover &&
      canEditForecasts &&
      (step.state === 'active' || step.state === 'blocked')
    ) {
      return (
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
      );
    }
    if (step.key === 'feedback' && isCurrent && step.state !== 'waiting') {
      return (
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
      );
    }
    return null;
  };

  /**
   * Where a checklist step goes when the row itself is clicked — and only
   * the step the user is ON is a door. The others are a record of what has
   * happened and what is still to come; making them clickable invited people
   * to jump ahead into work that is not theirs yet, or back into work that
   * has already moved on.
   */
  const openFor = (step: TodoStep, isCurrent: boolean): (() => void) | undefined => {
    if (!isCurrent) return undefined;
    if (step.key === 'submit') {
      // A closed submit step is deliberately a dead end — the list it opens
      // is the one that submits.
      if (submitClosed || work.length === 0) return undefined;
      return () => setEntityList(true);
    }
    if (step.key === 'review') {
      if (isApprover) return () => setCountriesOpen((v) => !v);
      return canEditForecasts ? () => onNavigate('review') : undefined;
    }
    return () => onNavigate('review');
  };

  return (
    <div className="view active">
      {/* The cycle is a fact, not an instruction: it belongs in the corner of
          the top bar like treasury's, not in a banner across the page. What
          to do next is said by the checklist, which raises the step you are
          on rather than restating it in prose above. */}
      <TopBar
        crumb={`My Workspace · ${weekLabelShort(week)}`}
        title={`Welcome, ${firstName}`}
        actions={
          <span data-tour="analyst-cycle">
            <CyclePill label="Active cycle" value={cycle.id} />
          </span>
        }
      />
      <div className="content content-compact">
        <div className="section-header">
          <h2>Your Cycle Checklist</h2>
          <span className="tag">
            {work.length} entit{work.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="panel">
          <div
            className={`todo-list${todo.currentStep >= 0 ? ' has-current' : ''}`}
            data-tour="analyst-todo"
          >
            {todo.steps.map((step, i) => (
              <Fragment key={step.key}>
                <ChecklistStep
                  index={i + 1}
                  step={step}
                  current={i === todo.currentStep}
                  dataTour={STEP_TOUR_ID[step.key]}
                  onOpen={openFor(step, i === todo.currentStep)}
                  action={actionFor(step, i === todo.currentStep)}
                />
                {/* The questions themselves, under the step that is blocked on
                    them: what came back, who asked it, and one click to the
                    cell it is about. */}
                {step.key === questionsStep && canEditForecasts && questions.length > 0 && (
                  <div className="todo-countries" data-tour="todo-questions">
                    <button
                      className="todo-countries-head"
                      aria-expanded={questionsOpen}
                      onClick={() => setQuestionsOpen((v) => !v)}
                    >
                      <span className="section-caret" aria-hidden="true">
                        {questionsOpen ? '▾' : '▸'}
                      </span>
                      Questions to answer · {questions.length}
                      <span className="badge-num warn">
                        from {requesterSummary(questions.map((q) => q.role))}
                      </span>
                    </button>
                    {questionsOpen &&
                      questions.map((q) => (
                        <div className="todo-country-row todo-question-row" key={`${q.entity}:${q.key}`}>
                          <strong>{q.entity}</strong>
                          <span className="text-dim">{q.cellLabel}</span>
                          <span className="todo-question-text" title={q.message}>
                            {q.from} ({requesterLabel(q.role)}): {q.message}
                          </span>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '4px 10px', fontSize: 12, marginLeft: 'auto' }}
                            title="Open the forecast on this cell with the answer box"
                            onClick={() =>
                              onOpenSubmission({
                                entity: q.entity,
                                week,
                                templateId: q.templateId,
                                focusCell: q.key,
                              })
                            }
                          >
                            Answer
                          </button>
                        </div>
                      ))}
                  </div>
                )}
                {/* The approver decides right here: the row opens the
                    forecast in a dialog and signs it off from inside it. */}
                {step.key === 'review' && isApprover && approverRows.length > 0 && (
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
                            {r.status === 'approved' ? (
                              <span className="text-muted" style={{ fontSize: 12 }}>
                                Approved ✓
                              </span>
                            ) : (
                              !awaitingDecision(r.status) && (
                                <span className="text-muted" style={{ fontSize: 12 }}>
                                  with submitter
                                </span>
                              )
                            )}
                            <button
                              className={`btn ${
                                awaitingDecision(r.status) ? 'btn-success' : 'btn-ghost'
                              }`}
                              style={{ padding: '4px 10px', fontSize: 12 }}
                              title="Open the forecast in a dialog and decide on it there"
                              onClick={() => setPreview({ entity: r.entity, mode: 'approve' })}
                            >
                              {awaitingDecision(r.status) ? 'Review & Approve' : 'View Forecast'}
                            </button>
                            {/* The submitter's grid locks once they hand over,
                                so this is their way back in when a figure has
                                to change — whether you have signed it off or
                                are looking at it for the first time. Offering
                                it only after approval meant an approver who
                                thought a forecast was wrong had to APPROVE it
                                before they could send it back. */}
                            {(r.status === 'approved' || awaitingDecision(r.status)) && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 12 }}
                                title={
                                  awaitingDecision(r.status)
                                    ? 'Send this forecast back to its submitter instead of approving it'
                                    : 'Send this forecast back to its submitter to change'
                                }
                                onClick={() => void returnForUpdate(r.entity)}
                              >
                                Return for Update
                              </button>
                            )}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>

        {/* An approver is judging forecasts, so they get what treasury judges
            them against: the group position for their own countries. */}
        {isApprover && (
          <>
            <div className="section-header">
              <h2>Your Countries at a Glance</h2>
            </div>
            <TreasuryOverview
              week={week}
              cycleId={cycle.id}
              cycleCloses={cycle.closes}
              scopeEntities={scopedEntities}
              onOpenSubmission={onOpenSubmission}
            />
          </>
        )}
      </div>

      {/* The checklist's countries: what the removed "My Forecasts" section
          listed, now opened from the step it belongs to. */}
      <EntityListModal
        open={entityList}
        title={canEditForecasts ? 'Forecasts to submit' : 'Your forecasts'}
        subtitle={`${weekLabel(week)} · ${cycle.id}`}
        rows={work}
        canEdit={canEditForecasts}
        onClose={() => setEntityList(false)}
        onOpenForecast={(w, revise) => {
          setEntityList(false);
          onOpenSubmission({ entity: w.entity, week, templateId: w.templateId, revise });
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
          // An approver reading a forecast is exactly the person with a
          // question about a number in it, so it is asked from here rather
          // than by leaving for the full forecast page.
          canRequestComments={preview.mode === 'approve' && permissions.canRequestCommentary}
          actions={
            preview.mode === 'approve' ? (
              previewDecidable && (
                <>
                  {/* Both halves of the decision, where the forecast is
                      actually read. Offering only "Approve" meant the answer
                      to "these numbers are wrong" was to approve them. */}
                  <button
                    className="btn btn-ghost"
                    title="Send this forecast back to its submitter instead of approving it"
                    onClick={() => void returnForUpdate(preview.entity)}
                  >
                    Return for Update
                  </button>
                  <button className="btn btn-success" onClick={() => void approveNow(preview.entity)}>
                    Approve Forecast
                  </button>
                </>
              )
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
                {canEditForecasts && previewSubmittable && (
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
