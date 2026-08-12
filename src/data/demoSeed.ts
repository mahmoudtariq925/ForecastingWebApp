// ============================================================================
// Demo workflow seeding.
//
// The demo used to describe its starting state twice: a `status` field frozen
// onto each entity, AND whatever the stored submissions said. The two drifted
// immediately — a forecast could read "approved" on the treasury dashboard and
// "still in draft" to the submitter who owned it, because those two screens
// were reading different copies.
//
// There is now one copy. This module materialises the demo's opening position
// as REAL stored submissions with real statuses (plus the matching approval
// map), once per forecast week. After it runs, every screen in the app answers
// "what is the status of this forecast?" from the same place, and the demo is
// indistinguishable from a week of genuine use.
//
// The live instance seeds nothing: its numbers come from imported workbooks.
// ============================================================================
import type { CommentRequest, ForecastTemplate, Submission, SubmissionStatus } from '../types';
import { DEMO_DATA } from './dataSource';
import { demoCountries } from './mockData';
import { listEntities, seedUsers } from './appData';
import { activeCycle, listCycles } from './cycleService';
import { getOrCreateSubmission, templateForEntity } from './submissionService';
import {
  loadApprovals,
  loadData,
  loadSubmission,
  loadTemplates,
  loadUsers,
  saveApprovals,
  saveData,
  saveSubmission,
} from '../storage/localStorage';

/**
 * The demo's opening position, one status per country.
 *
 * Chosen so every role has something real to do on a fresh browser: the
 * submitter demo account has a draft to submit, the approver demo account has
 * a decision waiting, and treasury has three countries to chase.
 */
const DEMO_STATUS: Record<string, SubmissionStatus> = {
  Netherlands: 'draft',
  Germany: 'submitted',
  France: 'draft',
  'United Kingdom': 'approved',
  Spain: 'submitted',
  Italy: 'approved',
  Poland: 'draft',
  Belgium: 'submitted',
  Switzerland: 'submitted',
  Austria: 'approved',
  Portugal: 'approved',
};

const seededKey = (week: string) => `demoSeeded:${week}`;
const questionsSeededKey = (week: string) => `demoQuestionsSeeded:${week}`;

// ---------------------------------------------------------------------------
// The week's conversation.
//
// A questions queue with nothing in it says nothing about how the screen
// works, so the demo week opens mid-conversation: questions from treasury AND
// from the countries' own approvers, some still waiting on a reply, some
// answered and not yet closed, some closed off.
//
// Each one is anchored to a LINE ITEM rather than a cell coordinate, and lands
// on that line's largest day in the generated grid — so the figures behind the
// question are the ones worth asking about, and a template without that line
// simply skips it instead of asking about a cell that isn't there.
// ---------------------------------------------------------------------------
interface DemoQuestion {
  /** Line item the question is about; skipped when the template lacks it. */
  category: string;
  /** Treasury asks anywhere; an approver only about their own country. */
  from: 'treasury' | 'approver';
  /** How long ago it was asked, in hours. */
  hoursAgo: number;
  message: string;
  /** The submitter's reply. Omitted = still waiting on them. */
  answer?: string;
  /** The asker has read the answer and closed the question. */
  closed?: boolean;
  /**
   * The question came in after the forecast had been submitted, so it went
   * back to its submitter — the state a reopened forecast is actually in.
   */
  reopened?: boolean;
}

const DEMO_QUESTIONS: Record<string, DemoQuestion[]> = {
  Germany: [
    {
      category: 'Payables',
      from: 'treasury',
      hoursAgo: 30,
      message:
        'Payables step up sharply here against last week — is a supplier settlement being pulled forward?',
      answer:
        'Yes — the Hamburg supplier run moved forward a week to catch the early-payment discount. It reverses next cycle.',
    },
  ],
  'United Kingdom': [
    {
      category: 'Receivables',
      from: 'approver',
      hoursAgo: 96,
      message:
        'Receivables look light against the order book — has the Q3 rebate already been netted off here?',
      answer: 'Netted, yes. The rebate lands with the September invoice run rather than this one.',
      closed: true,
    },
    {
      category: 'CAPEX',
      from: 'treasury',
      hoursAgo: 70,
      message: 'CAPEX is roughly triple its usual weekly run rate on this day. What is in it?',
      answer:
        'Fleet renewal instalment — second of three, per the approved capital plan. Nothing unexpected.',
    },
  ],
  Spain: [
    {
      category: 'Salaries',
      from: 'approver',
      hoursAgo: 20,
      message:
        'Salaries land earlier in the month than usual here — is that a payroll calendar change or a timing error?',
    },
  ],
  Italy: [
    {
      category: 'IC Outflows',
      from: 'treasury',
      hoursAgo: 120,
      message: 'IC outflows are double the usual weekly run rate — is this the quarterly settlement?',
      answer: 'It is: the quarterly IC settlement with Milan. One-off, back to normal next week.',
      closed: true,
    },
  ],
  Poland: [
    {
      category: 'Other Taxes',
      from: 'treasury',
      hoursAgo: 6,
      message:
        'Other taxes are an order of magnitude above last week — is the VAT payment sitting in the right week?',
      reopened: true,
    },
  ],
  Switzerland: [
    {
      category: 'Corporate Income',
      from: 'approver',
      hoursAgo: 44,
      message: 'Corporate income is empty for most of the horizon — is nothing genuinely due?',
    },
  ],
  Belgium: [
    {
      category: 'Receivables',
      from: 'treasury',
      hoursAgo: 52,
      message:
        'Receivables and payables both step up on the same day — is that the same counterparty on both sides?',
      answer:
        'Different ones: the receipt is the Antwerp distributor, the payment is the annual insurance premium.',
    },
  ],
  Portugal: [
    {
      category: 'Other',
      from: 'approver',
      hoursAgo: 130,
      message: 'The Other line carries most of the week’s inflow — what sits in it?',
      answer:
        'A reclassified grant receipt. It moves to Corporate Income from next cycle, once the coding is fixed.',
      closed: true,
    },
  ],
};

/** The day of a line item with the most in it — the cell worth asking about. */
function biggestCellOf(sub: Submission, template: ForecastTemplate, category: string): string | null {
  const catIdx = template.categories.findIndex(
    (c) => !c.subtotal && c.label.trim().toLowerCase() === category.trim().toLowerCase(),
  );
  if (catIdx < 0) return null;
  let best: string | null = null;
  let bestSize = -1;
  for (const [key, value] of Object.entries(sub.values)) {
    if (Number(key.split('-')[0]) !== catIdx) continue;
    const size = Math.abs(value);
    if (size > bestSize) {
      bestSize = size;
      best = key;
    }
  }
  // A line item with nothing in it is still a fair thing to ask about — take
  // its first day so the question has somewhere to live.
  return best ?? `${catIdx}-0`;
}

/**
 * Open the demo week mid-conversation: real questions on real cells, with the
 * replies that came back, written exactly as the app writes them.
 *
 * Non-destructive. A forecast that already carries a question — anyone's — is
 * left alone, and an answer is only written where the cell has no commentary
 * of its own, so nothing a user typed is ever overwritten.
 */
function seedDemoQuestions(week: string): void {
  if (loadData<boolean>(questionsSeededKey(week), false)) return;
  const templates = loadTemplates();
  const entities = listEntities();
  const users = loadUsers(seedUsers());
  const treasury = users.filter((u) => u.role === 'treasury' && u.status === 'active');
  if (treasury.length === 0) return;

  demoCountries.forEach((country, ci) => {
    const asks = DEMO_QUESTIONS[country.name];
    if (!asks || asks.length === 0) return;
    const template = templateForEntity(templates, country.name);
    if (!template) return;
    const stored = loadSubmission(week, country.name, template.id);
    if (!stored) return;
    // Somebody is already having this conversation — do not talk over it.
    if (Object.keys(stored.commentRequests ?? {}).length > 0) return;

    const approver = entities.find((e) => e.name === country.name)?.approver;
    const requests: Record<string, CommentRequest> = {};
    const comments = { ...stored.comments };
    const flags = new Set(stored.flags);
    const resolved = new Set(stored.resolvedFlags ?? []);
    let reopenedBy = stored.reopenedBy;
    let status = stored.status;

    asks.forEach((ask, qi) => {
      const cell = biggestCellOf(stored, template, ask.category);
      if (!cell || requests[cell]) return;
      // Treasury asks are spread across the treasury team; an approver only
      // ever asks about their own country, and skips if nobody is assigned.
      const from =
        ask.from === 'approver' ? approver : treasury[(ci + qi) % treasury.length].name;
      if (!from || from === '—') return;
      const requestedAt = new Date(Date.now() - ask.hoursAgo * 3_600_000).toISOString();
      requests[cell] = {
        from,
        fromRole: ask.from,
        message: ask.message,
        requestedAt,
        ...(ask.answer
          ? {
              answeredAt: new Date(
                Date.now() - Math.max(ask.hoursAgo - 8, 1) * 3_600_000,
              ).toISOString(),
            }
          : {}),
      };
      // Asking flags the cell, exactly as `requestComment` does.
      flags.add(cell);
      if (ask.answer && !comments[cell]?.trim()) comments[cell] = ask.answer;
      if (ask.closed) resolved.add(cell);
      if (ask.reopened) {
        status = 'draft';
        reopenedBy = { by: from, role: ask.from, at: requestedAt };
      }
    });

    if (Object.keys(requests).length === 0) return;
    saveSubmission({
      ...stored,
      status,
      flags: [...flags],
      resolvedFlags: [...resolved],
      comments,
      commentRequests: requests,
      reopenedBy,
    });
  });

  saveData(questionsSeededKey(week), true);
}

/**
 * Give every closed cycle behind the active one a complete, approved set of
 * forecasts.
 *
 * A closed cycle showing "0 / 11 · €0.0M" reads as a bug rather than as
 * history, and the forecast-vs-forecast overlays had nothing real to draw.
 * Past weeks are always fully approved: that is what "closed" means.
 */
function seedClosedHistory(): void {
  for (const cycle of listCycles()) {
    if (cycle.status !== 'consolidated') continue;
    if (loadData<boolean>(seededKey(cycle.weekKey), false)) continue;
    const templates = loadTemplates();
    const approvals: Record<string, SubmissionStatus> = {};
    for (const country of demoCountries) {
      const template = templateForEntity(templates, country.name);
      if (!template) continue;
      if (!loadSubmission(cycle.weekKey, country.name, template.id)) {
        const sub = getOrCreateSubmission(country.name, cycle.weekKey, template);
        saveSubmission({ ...sub, status: 'approved' });
      }
      approvals[country.name] = 'approved';
    }
    saveApprovals(cycle.id, { ...loadApprovals(cycle.id), ...approvals });
    saveData(seededKey(cycle.weekKey), true);
  }
}

/**
 * Give a forecast week its demo opening position, once.
 *
 * Idempotent and non-destructive: the marker stops it re-running, and an
 * entity that already has a stored submission is left exactly as the user
 * left it. Safe to call on every boot.
 */
export function seedDemoWorkflow(week: string): void {
  if (!DEMO_DATA) return;
  seedClosedHistory();
  if (loadData<boolean>(seededKey(week), false)) {
    // The forecasts were seeded by an earlier version that had no
    // conversation on them; give this week its questions on the way past.
    seedDemoQuestions(week);
    return;
  }

  const templates = loadTemplates();
  const approvals: Record<string, SubmissionStatus> = {};

  for (const country of demoCountries) {
    const template = templateForEntity(templates, country.name);
    if (!template) continue;
    const status = DEMO_STATUS[country.name] ?? 'draft';
    // getOrCreateSubmission generates the deterministic demo grid the rest of
    // the app already shows, so seeding changes the status, never the numbers.
    const existing = loadSubmission(week, country.name, template.id);
    const sub = existing ?? getOrCreateSubmission(country.name, week, template);
    if (!existing) saveSubmission({ ...sub, status });
    if (status === 'approved') approvals[country.name] = status;
  }

  const cycleId = activeCycle().id;
  saveApprovals(cycleId, { ...loadApprovals(cycleId), ...approvals });
  saveData(seededKey(week), true);
  // …and the week's conversation, on top of the forecasts just created.
  seedDemoQuestions(week);
}
