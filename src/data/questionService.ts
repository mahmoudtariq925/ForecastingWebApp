// ============================================================================
// The questions queue.
//
// Treasury's review is not "every comment written on every forecast" — that is
// the submitters' own commentary, and reading all of it was never the job.
// What treasury (and an approver) has to keep on top of is the QUESTIONS: what
// was asked, of whom, how long it has been waiting, and what came back.
//
// This module answers exactly that, across every forecast, so the screen can
// stay a thin layer of filtering and presentation over it.
// ============================================================================
import type {
  CommentRequest,
  ForecastTemplate,
  RequesterRole,
  Submission,
  SubmissionStatus,
} from '../types';
import { listEntities } from './appData';
import { templateDayLabels } from './periods';
import {
  getPriorValues,
  pctChange,
  priorValueFor,
  reviewCandidates,
} from './submissionService';

/**
 * Where a question stands.
 * - `awaiting`  — asked, no reply yet: someone is blocked on it.
 * - `answered`  — the submitter replied; the asker has not closed it.
 * - `closed`    — the asker marked the cell reviewed, so it is done.
 */
export type QuestionState = 'awaiting' | 'answered' | 'closed';

/** One question on one cell, with everything the queue shows about it. */
export interface QuestionItem {
  /** Stable across reloads: forecast plus cell. */
  id: string;
  entity: string;
  region: string;
  /** Forecast week key. */
  period: string;
  templateId: string;
  /** Cell key, `${catIdx}-${dayIdx}` — deep-links straight to it. */
  cellKey: string;
  /** Line item, e.g. "Receivables". */
  category: string;
  /** "Mon 10/8" */
  dateLabel: string;
  current: number;
  prior: number | null;
  /** Null when a percentage would mislead — see `pctChange`. */
  pct: number | null;
  /** Who asked, and in what capacity. */
  from: string;
  role: RequesterRole;
  message: string;
  requestedAt: string;
  answeredAt?: string;
  /** The submitter's commentary on that cell — the reply, when there is one. */
  answer: string;
  state: QuestionState;
}

/** Every question on one forecast, with the counts the header shows. */
export interface QuestionGroup {
  /** `period:entity:templateId` */
  id: string;
  entity: string;
  region: string;
  period: string;
  templateId: string;
  templateName: string;
  submitter: string;
  forecastStatus: SubmissionStatus;
  items: QuestionItem[];
  awaiting: number;
  answered: number;
  closed: number;
  /** When the longest-waiting unanswered question was asked; null if none. */
  oldestAwaiting: string | null;
}

function stateOf(request: CommentRequest, resolved: boolean): QuestionState {
  if (resolved) return 'closed';
  return request.answeredAt ? 'answered' : 'awaiting';
}

/** Build the queue for one submission; empty when nothing was ever asked. */
function questionsOf(
  sub: Submission,
  templates: ForecastTemplate[],
  regionOf: Map<string, string>,
  submitterOf: Map<string, string>,
): QuestionGroup | null {
  const requests = Object.entries(sub.commentRequests ?? {});
  if (requests.length === 0) return null;

  const template = templates.find((t) => t.id === sub.templateId);
  const labels = templateDayLabels(template, sub.period);
  const prior = template ? getPriorValues(sub.entity, sub.period, template) : {};
  const resolved = new Set(sub.resolvedFlags ?? []);

  const items: QuestionItem[] = requests.map(([cellKey, request]) => {
    const [c, d] = cellKey.split('-').map(Number);
    const current = sub.values[cellKey] || 0;
    const prev = template ? priorValueFor(prior, c, d, template) : null;
    return {
      id: `${sub.period}:${sub.entity}:${sub.templateId}:${cellKey}`,
      entity: sub.entity,
      region: regionOf.get(sub.entity) ?? 'Unassigned',
      period: sub.period,
      templateId: sub.templateId,
      cellKey,
      category: template?.categories[c]?.label ?? `Line ${c + 1}`,
      dateLabel: labels[d] ? `${labels[d].dow} ${labels[d].dm}` : `Day ${d + 1}`,
      current,
      prior: prev,
      pct: prev === null ? null : pctChange(current, prev),
      from: request.from,
      role: request.fromRole ?? 'treasury',
      message: request.message,
      requestedAt: request.requestedAt,
      answeredAt: request.answeredAt,
      answer: sub.comments?.[cellKey]?.trim() ?? '',
      state: stateOf(request, resolved.has(cellKey)),
    };
  });

  // Unanswered first, then oldest — the queue's whole ordering principle is
  // "who has been waiting longest on you".
  const rank: Record<QuestionState, number> = { awaiting: 0, answered: 1, closed: 2 };
  items.sort(
    (a, b) => rank[a.state] - rank[b.state] || a.requestedAt.localeCompare(b.requestedAt),
  );

  const awaitingItems = items.filter((i) => i.state === 'awaiting');
  return {
    id: `${sub.period}:${sub.entity}:${sub.templateId}`,
    entity: sub.entity,
    region: regionOf.get(sub.entity) ?? 'Unassigned',
    period: sub.period,
    templateId: sub.templateId,
    templateName: template?.name ?? sub.templateId,
    submitter: submitterOf.get(sub.entity) ?? '—',
    forecastStatus: sub.status,
    items,
    awaiting: awaitingItems.length,
    answered: items.filter((i) => i.state === 'answered').length,
    closed: items.filter((i) => i.state === 'closed').length,
    oldestAwaiting: awaitingItems[0]?.requestedAt ?? null,
  };
}

/**
 * Every forecast that has ever been asked a question, most urgent first:
 * forecasts with someone waiting come before forecasts where the ball is back
 * with the asker, and within that the longest wait leads.
 */
export function collectQuestionGroups(templates: ForecastTemplate[]): QuestionGroup[] {
  const entities = listEntities();
  const regionOf = new Map(entities.map((e) => [e.name, e.region]));
  const submitterOf = new Map(entities.map((e) => [e.name, e.submitter]));

  const groups: QuestionGroup[] = [];
  for (const sub of reviewCandidates(templates)) {
    try {
      const group = questionsOf(sub, templates, regionOf, submitterOf);
      if (group) groups.push(group);
    } catch (err) {
      console.warn(`[questions] skipped malformed submission "${sub.entity}"`, err);
    }
  }

  groups.sort((a, b) => {
    if ((a.awaiting > 0) !== (b.awaiting > 0)) return a.awaiting > 0 ? -1 : 1;
    if (a.oldestAwaiting && b.oldestAwaiting) {
      return a.oldestAwaiting.localeCompare(b.oldestAwaiting);
    }
    // Neither is waiting on anyone: the newest conversation first.
    return b.period.localeCompare(a.period) || a.entity.localeCompare(b.entity);
  });
  return groups;
}

/** Queue-wide counts for the headline figures. */
export interface QuestionTotals {
  awaiting: number;
  answered: number;
  closed: number;
  forecasts: number;
  /** The longest-waiting unanswered question in the queue, if any. */
  oldestAwaiting: string | null;
}

export function questionTotals(groups: QuestionGroup[]): QuestionTotals {
  const oldest = groups
    .map((g) => g.oldestAwaiting)
    .filter((v): v is string => v !== null)
    .sort()[0];
  return {
    awaiting: groups.reduce((s, g) => s + g.awaiting, 0),
    answered: groups.reduce((s, g) => s + g.answered, 0),
    closed: groups.reduce((s, g) => s + g.closed, 0),
    forecasts: groups.length,
    oldestAwaiting: oldest ?? null,
  };
}

/** "2h" / "3d" / "just now" — how long a question has been sitting. */
export function waitedLabel(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes < 1 ? 'just now' : `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
