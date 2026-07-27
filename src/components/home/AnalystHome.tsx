import { useMemo } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { cycles as seedCycles } from '../../data/mockData';
import { assignedEntitiesFor, permissionsFor } from '../../data/session';
import {
  currentWeekKey,
  prevWeekKey,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import { peekSubmission, templatesForEntity } from '../../data/submissionService';
import {
  listSubmissions,
  loadCycles,
  loadSubmission,
  loadTemplates,
} from '../../storage/localStorage';
import type { Submission, User } from '../../types';
import type { ViewId } from '../../types/nav';
import type { SubmissionTarget } from '../submissions/Submission';

interface AnalystHomeProps {
  user: User;
  onOpenSubmission: (target: SubmissionTarget) => void;
  onNavigate: (view: ViewId) => void;
}

interface EntityWork {
  entity: string;
  templateId: string;
  templateName: string;
  submission: Submission;
  /** Whether the user has actually saved this week's forecast yet. */
  started: boolean;
  /** Flagged cells still missing commentary — blocks submission. */
  needCommentary: number;
  flagged: number;
  returnedForUpdate: boolean;
  lastSubmitted: Submission | null;
}

function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The focused landing page for submitters/approvers: "what do I need to
 * update, explain and submit" — only their assigned entities, never the
 * treasury-wide picture.
 */
export function AnalystHome({ user, onOpenSubmission, onNavigate }: AnalystHomeProps) {
  const week = currentWeekKey();
  const templates = useMemo(() => loadTemplates(), []);
  const myEntities = useMemo(() => assignedEntitiesFor(user), [user]);
  const cycles = loadCycles(seedCycles);
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];

  const work: EntityWork[] = useMemo(
    () =>
      myEntities.flatMap((entity) => {
        const template = templatesForEntity(templates, entity)[0];
        if (!template) return [];
        const submission = peekSubmission(entity, week, template);
        const needCommentary = submission.flags.filter(
          (k) => !submission.comments?.[k]?.trim(),
        ).length;
        const history = listSubmissions()
          .filter((s) => s.entity === entity && s.status !== 'draft')
          .sort((a, b) => b.period.localeCompare(a.period));
        return [
          {
            entity,
            templateId: template.id,
            templateName: template.name,
            submission,
            started: loadSubmission(week, entity, template.id) !== null,
            needCommentary,
            flagged: submission.flags.length,
            returnedForUpdate: submission.status === 'rejected',
            lastSubmitted: history[0] ?? null,
          },
        ];
      }),
    [myEntities, templates, week],
  );

  // Viewers have read-only access, so nothing is ever "theirs to action".
  const canEditForecasts = permissionsFor(user).canSubmitForecasts;
  const actionCount = canEditForecasts
    ? work.reduce(
        (s, w) =>
          s +
          w.needCommentary +
          (w.returnedForUpdate ? 1 : 0) +
          (w.submission.status === 'draft' ? 1 : 0),
        0,
      )
    : 0;

  const recentActivity = useMemo(
    () =>
      listSubmissions()
        .filter((s) => myEntities.includes(s.entity))
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, 6),
    [myEntities],
  );

  const firstName = user.name.split(' ')[0];

  return (
    <div className="view active">
      <TopBar
        crumb={`My Workspace · ${myEntities.join(' · ')}`}
        title={`Welcome, ${firstName}`}
        actions={
          work[0] && (
            <button
              className="btn btn-primary"
              onClick={() =>
                onOpenSubmission({ entity: work[0].entity, week, templateId: work[0].templateId })
              }
            >
              {!canEditForecasts
                ? 'View Current Forecast'
                : work[0].started && work[0].submission.status === 'draft'
                  ? 'Continue Forecast'
                  : 'Open Current Forecast'}
            </button>
          )
        }
      />
      <div className="content">
        <div className="kpi-grid" data-tour="analyst-kpis">
          <div className="kpi-card">
            <div className="kpi-label">Current Cycle</div>
            <div className="kpi-value">{activeCycle?.id ?? '—'}</div>
            <div className="kpi-sub text-dim">Deadline: {activeCycle?.closes ?? '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Forecast Week</div>
            <div className="kpi-value">{weekLabelShort(week)}</div>
            <div className="kpi-sub text-dim">{weekLabel(week)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">My Entities</div>
            <div className="kpi-value">{myEntities.length}</div>
            <div className="kpi-sub text-dim">{myEntities.join(', ')}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">{canEditForecasts ? 'Needs My Action' : 'Access'}</div>
            <div className="kpi-value">{canEditForecasts ? actionCount : 'View'}</div>
            <div className="kpi-sub text-dim">
              {!canEditForecasts
                ? 'read-only forecast access'
                : actionCount === 0
                  ? 'all caught up'
                  : 'items to update, explain or submit'}
            </div>
          </div>
        </div>

        <div className="section-header">
          <h2>My Forecasts</h2>
          <span className="tag">{weekLabelShort(week)} · {activeCycle?.id ?? '—'}</span>
        </div>
        {work.map((w) => (
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
                {w.lastSubmitted && (
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Last submitted: {weekLabelShort(w.lastSubmitted.period)} (
                    {w.lastSubmitted.status})
                  </span>
                )}
              </div>
              <div className="row-flex" data-tour="analyst-forecast-actions">
                {w.needCommentary > 0 && (
                  <span className="badge-num warn">
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
                <button
                  className="btn btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={() => onNavigate('review')}
                >
                  View Comments
                </button>
              </div>
            </div>
            {(w.needCommentary > 0 || w.returnedForUpdate) && (
              <div className="variance-panel" style={{ margin: '0 20px 16px', borderRadius: 4 }}>
                <h4>Feedback from Treasury</h4>
                <div className="row">
                  <span>
                    {w.returnedForUpdate
                      ? 'This forecast was rejected — update the figures and resubmit.'
                      : `${w.needCommentary} flagged cell${w.needCommentary === 1 ? '' : 's'} still need${w.needCommentary === 1 ? 's' : ''} commentary before Treasury can close the cycle.`}
                  </span>
                  <span>
                    {w.flagged} flagged · {w.needCommentary} open
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="section-header">
          <h2>Recent Activity</h2>
          <span className="tag">my entities only</span>
        </div>
        <div className="panel">
          {recentActivity.length === 0 ? (
            <div className="empty-state">
              <div className="ic">✎</div>
              <p>No saved forecasts yet — open your current forecast to get started.</p>
            </div>
          ) : (
            <div className="panel-body no-pad">
              <table>
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Forecast Week</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((s) => (
                    <tr key={`${s.period}:${s.entity}:${s.templateId}`}>
                      <td>
                        <strong>{s.entity}</strong>
                      </td>
                      <td className="text-dim">{weekLabel(s.period)}</td>
                      <td>
                        <StatusPill status={s.status} />
                      </td>
                      <td className="text-muted" style={{ fontSize: 12 }}>
                        {agoLabel(s.updatedAt)}
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() =>
                            onOpenSubmission({
                              entity: s.entity,
                              week: s.period,
                              templateId: s.templateId,
                            })
                          }
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
