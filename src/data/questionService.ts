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
  ThreadMessage,
} from '../types';
import { listEntities } from './appData';
import { lineOwners } from './legalEntityService';
import { templateDayLabels } from './periods';
import {
  getPriorValues,
  pctChange,
  priorValueFor,
  reviewCandidates,
  threadOf,
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
  /** Who opened the thread, and in what capacity. */
  from: string;
  role: RequesterRole;
  /** The opening question. */
  message: string;
  requestedAt: string;
  answeredAt?: string;
  /** The submitter's latest reply — empty while nothing has come back. */
  answer: string;
  /** The whole conversation, oldest first: question, replies, answers. */
  thread: ThreadMessage[];
  /** When the thread was last added to — what "quiet since" is measured from. */
  lastAt: string;
  state: QuestionState;
  /** The forecast this cell belongs to, so a card can stand on its own. */
  templateName: string;
  forecastStatus: SubmissionStatus;
  /** Who answers for this LINE ITEM (its owner, else the entity submitter). */
  owner: string;
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

  const submitter = submitterOf.get(sub.entity) ?? '—';
  const items: QuestionItem[] = requests.map(([cellKey, request]) => {
    const [c, d] = cellKey.split('-').map(Number);
    const current = sub.values[cellKey] || 0;
    const prev = template ? priorValueFor(prior, c, d, template) : null;
    const category = template?.categories[c]?.label ?? `Line ${c + 1}`;
    const answer = sub.comments?.[cellKey]?.trim() ?? '';
    const thread = threadOf(request, answer, submitter);
    // Whoever owns this LINE is the person on the hook for the answer — not
    // necessarily the entity's first submitter.
    const owner = lineOwners(sub.entity, category)[0]?.name ?? submitter;
    const replies = thread.filter((m) => m.role === 'submitter');
    return {
      id: `${sub.period}:${sub.entity}:${sub.templateId}:${cellKey}`,
      entity: sub.entity,
      region: regionOf.get(sub.entity) ?? 'Unassigned',
      period: sub.period,
      templateId: sub.templateId,
      cellKey,
      category,
      dateLabel: labels[d] ? `${labels[d].dow} ${labels[d].dm}` : `Day ${d + 1}`,
      current,
      prior: prev,
      pct: prev === null ? null : pctChange(current, prev),
      from: request.from,
      role: request.fromRole ?? 'treasury',
      message: request.message,
      requestedAt: request.requestedAt,
      answeredAt: request.answeredAt,
      answer: replies[replies.length - 1]?.text ?? '',
      thread,
      lastAt: thread[thread.length - 1]?.at ?? request.requestedAt,
      state: stateOf(request, resolved.has(cellKey)),
      templateName: template?.name ?? sub.templateId,
      forecastStatus: sub.status,
      owner,
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
    submitter,
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

/**
 * Every question as a flat list — one card per conversation, which is what the
 * board is made of. Grouping by forecast is still how the queue is COLLECTED
 * (and how the totals are counted); it is not how it is worked through.
 */
export function flattenQuestions(groups: QuestionGroup[]): QuestionItem[] {
  return groups.flatMap((g) => g.items);
}

/**
 * A column's cards in the order that column is worked.
 *
 * Awaiting is a queue: the longest wait leads. Answered and closed are a log:
 * whatever happened last is what you have not read yet.
 */
export function sortForColumn(items: QuestionItem[], state: QuestionState): QuestionItem[] {
  const sorted = [...items];
  if (state === 'awaiting') {
    sorted.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  } else {
    sorted.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }
  return sorted;
}

/** Queue-wide counts for the headline figures. */
export interface QuestionTotals {
  awaiting: number;
  answered: number;
  closed: number;
  forecasts: number;
}

/**
 * The headline counts for a set of cards.
 *
 * Deliberately over the ITEMS rather than the groups they were collected in:
 * the board filters cards (by period, region, who asked, a search), and totals
 * read off the unfiltered groups described a different board from the one
 * underneath them — "4 awaiting a reply" over a column holding three, with no
 * way to reach the fourth. Whatever is counted here is what is on screen.
 */
export function questionTotals(items: QuestionItem[]): QuestionTotals {
  const forecasts = new Set<string>();
  let awaiting = 0;
  let answered = 0;
  let closed = 0;
  for (const item of items) {
    forecasts.add(`${item.period}:${item.entity}:${item.templateId}`);
    if (item.state === 'awaiting') awaiting += 1;
    else if (item.state === 'answered') answered += 1;
    else closed += 1;
  }
  return { awaiting, answered, closed, forecasts: forecasts.size };
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
