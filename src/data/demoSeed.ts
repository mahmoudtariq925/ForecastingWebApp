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
import type {
  CommentRequest,
  CustomRow,
  ForecastTemplate,
  Submission,
  SubmissionStatus,
  ThreadMessage,
} from '../types';
import { DEMO_DATA } from './dataSource';
import { demoCountries } from './mockData';
import { listEntities, seedUsers } from './appData';
import { activeCycle, listCycles } from './cycleService';
import { getOrCreateSubmission, templateForEntity } from './submissionService';
import { customCatIndex, customRowsOf } from './customRows';
import { intercompanySections, syncMirrors } from './intercompanyService';
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
interface DemoReply {
  /** `asker` is whoever opened the thread — treasury or the approver. */
  by: 'asker' | 'submitter';
  /** How long ago it was written, in hours. */
  hoursAgo: number;
  text: string;
}

interface DemoQuestion {
  /** Line item the question is about; skipped when the template lacks it. */
  category: string;
  /** Treasury asks anywhere; an approver only about their own country. */
  from: 'treasury' | 'approver';
  /** How long ago it was asked, in hours. */
  hoursAgo: number;
  message: string;
  /** Everything said after the opening question, oldest first. */
  replies?: DemoReply[];
  /** The asker has read the answer and closed the question. */
  closed?: boolean;
}

const DEMO_QUESTIONS: Record<string, DemoQuestion[]> = {
  Germany: [
    {
      category: 'Payables',
      from: 'treasury',
      hoursAgo: 30,
      message:
        'Payables step up sharply here against last week — is a supplier settlement being pulled forward?',
      replies: [
        {
          by: 'submitter',
          hoursAgo: 22,
          text: 'Yes — the Hamburg supplier run moved forward a week to catch the early-payment discount. It reverses next cycle.',
        },
      ],
    },
  ],
  'United Kingdom': [
    {
      category: 'Receivables',
      from: 'approver',
      hoursAgo: 96,
      message:
        'Receivables look light against the order book — has the Q3 rebate already been netted off here?',
      replies: [
        {
          by: 'submitter',
          hoursAgo: 88,
          text: 'Netted, yes. The rebate lands with the September invoice run rather than this one.',
        },
      ],
      closed: true,
    },
    {
      category: 'CAPEX',
      from: 'treasury',
      hoursAgo: 70,
      message: 'CAPEX is roughly triple its usual weekly run rate on this day. What is in it?',
      // A thread rather than a single exchange — which is how most questions
      // about a number actually go.
      replies: [
        {
          by: 'submitter',
          hoursAgo: 62,
          text: 'Fleet renewal instalment — second of three, per the approved capital plan.',
        },
        {
          by: 'asker',
          hoursAgo: 40,
          text: 'Thanks. Is the third instalment inside this horizon, or does it fall into next cycle?',
        },
        {
          by: 'submitter',
          hoursAgo: 30,
          text: 'Next cycle — it is due on the 9th, so it lands in the following week’s forecast.',
        },
      ],
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
      replies: [
        {
          by: 'submitter',
          hoursAgo: 110,
          text: 'It is: the quarterly IC settlement with Milan. One-off, back to normal next week.',
        },
      ],
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
      replies: [
        {
          by: 'submitter',
          hoursAgo: 44,
          text: 'Different ones: the receipt is the Antwerp distributor, the payment is the annual insurance premium.',
        },
      ],
    },
  ],
  Portugal: [
    {
      category: 'Other',
      from: 'approver',
      hoursAgo: 130,
      message: 'The Other line carries most of the week’s inflow — what sits in it?',
      replies: [
        {
          by: 'submitter',
          hoursAgo: 120,
          text: 'A reclassified grant receipt. It moves to Corporate Income from next cycle, once the coding is fixed.',
        },
      ],
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
    const submitter = entities.find((e) => e.name === country.name)?.submitter ?? 'Submitter';
    const requests: Record<string, CommentRequest> = {};
    const comments = { ...stored.comments };
    const flags = new Set(stored.flags);
    const resolved = new Set(stored.resolvedFlags ?? []);
    let questionedBy = stored.questionedBy;

    asks.forEach((ask, qi) => {
      const cell = biggestCellOf(stored, template, ask.category);
      if (!cell || requests[cell]) return;
      // Treasury asks are spread across the treasury team; an approver only
      // ever asks about their own country, and skips if nobody is assigned.
      const from =
        ask.from === 'approver' ? approver : treasury[(ci + qi) % treasury.length].name;
      if (!from || from === '—') return;
      const at = (hoursAgo: number) =>
        new Date(Date.now() - Math.max(hoursAgo, 0) * 3_600_000).toISOString();
      const requestedAt = at(ask.hoursAgo);
      const replies: ThreadMessage[] = (ask.replies ?? []).map((r) => ({
        from: r.by === 'submitter' ? submitter : from,
        role: r.by === 'submitter' ? 'submitter' : ask.from,
        text: r.text,
        at: at(r.hoursAgo),
      }));
      const lastReply = replies[replies.length - 1];
      requests[cell] = {
        from,
        fromRole: ask.from,
        message: ask.message,
        requestedAt,
        replies,
        // The ball is with the asker only while the LAST word was the
        // submitter's — a follow-up puts the question back to them.
        ...(lastReply?.role === 'submitter' ? { answeredAt: lastReply.at } : {}),
      };
      // Asking flags the cell, exactly as `requestComment` does.
      flags.add(cell);
      // The submitter's latest reply is the cell's commentary, which is what
      // the grid and the variance checks read.
      const lastAnswer = [...replies].reverse().find((r) => r.role === 'submitter');
      if (lastAnswer && !comments[cell]?.trim()) comments[cell] = lastAnswer.text;
      if (ask.closed) resolved.add(cell);
      // Somebody asked, so the forecast is in review whatever its status.
      questionedBy = { by: from, role: ask.from, at: requestedAt };
    });

    if (Object.keys(requests).length === 0) return;
    saveSubmission({
      ...stored,
      flags: [...flags],
      resolvedFlags: [...resolved],
      comments,
      commentRequests: requests,
      questionedBy,
    });
  });

  saveData(questionsSeededKey(week), true);
}

// ---------------------------------------------------------------------------
// The week's intercompany position.
//
// A demo with an empty IC Settlements section says nothing about what the
// section is FOR, and every screen built on it — the mirroring table beside
// the outlook, the dashboard's settlement filters — opens with nothing in it
// and reads as broken rather than as empty. So the week opens with real
// settlements between real group companies.
//
// Only the ORIGINATING side is written here. The other half of each is
// produced by `syncMirrors`, the same code that runs when a submitter types
// one in, so the seeded state is exactly what a week of genuine use produces
// rather than an imitation of it that can drift from it.
// ---------------------------------------------------------------------------

/** Who settles with whom, and roughly how much, on which working day. */
const DEMO_INTERCOMPANY: { entity: string; counterparty: string; day: number; amount: number }[] = [
  // The Dutch entity funds two subsidiaries and is paid by a third.
  { entity: 'Netherlands', counterparty: 'Belgium', day: 2, amount: -1_450 },
  { entity: 'Netherlands', counterparty: 'Poland', day: 7, amount: -880 },
  { entity: 'Netherlands', counterparty: 'Germany', day: 12, amount: 2_100 },
  // Germany settles the quarterly royalty with Italy and pays Austria.
  { entity: 'Germany', counterparty: 'Italy', day: 3, amount: -3_250 },
  { entity: 'Germany', counterparty: 'Austria', day: 9, amount: -640 },
  // The UK is a net receiver this week.
  { entity: 'United Kingdom', counterparty: 'France', day: 5, amount: 1_780 },
  { entity: 'United Kingdom', counterparty: 'Spain', day: 14, amount: 920 },
  // Switzerland runs the treasury pool: in from two, out to one.
  { entity: 'Switzerland', counterparty: 'Portugal', day: 6, amount: 1_120 },
  { entity: 'Switzerland', counterparty: 'Italy', day: 11, amount: 1_460 },
  { entity: 'Switzerland', counterparty: 'France', day: 16, amount: -2_040 },
];

const intercompanySeededKey = (week: string) => `demoIntercompanySeeded:${week}`;

/**
 * Write the week's intercompany rows onto the entities that entered them, then
 * let the app mirror each into its counterparty.
 *
 * Non-destructive: an entity that already carries intercompany rows — seeded
 * before, or added by a user — is skipped entirely, so nothing anyone typed is
 * overwritten and re-running costs nothing.
 */
function seedDemoIntercompany(week: string): void {
  if (loadData<boolean>(intercompanySeededKey(week), false)) return;
  const templates = loadTemplates();

  const byEntity = new Map<string, typeof DEMO_INTERCOMPANY>();
  for (const entry of DEMO_INTERCOMPANY) {
    const list = byEntity.get(entry.entity);
    if (list) list.push(entry);
    else byEntity.set(entry.entity, [entry]);
  }

  for (const [entity, entries] of byEntity) {
    const template = templateForEntity(templates, entity);
    if (!template) continue;
    const section = intercompanySections(template)[0];
    if (!section) continue;
    const stored = loadSubmission(week, entity, template.id);
    if (!stored) continue;
    // Somebody's settlements are already here — leave them be.
    if (customRowsOf(stored).length > 0) continue;

    const rows: CustomRow[] = [];
    const values = { ...stored.values };
    entries.forEach((entry, i) => {
      // The line the row breaks down: money out sits under the outflow line,
      // money in under the inflow one, which is what makes the sign and the
      // section agree.
      const parent = template.categories.find(
        (c) =>
          c.group === section &&
          c.intercompany === true &&
          !c.subtotal &&
          /out/i.test(c.label) === entry.amount < 0,
      )?.label;
      const row: CustomRow = {
        id: `demo-ic-${entity}-${i}`.toLowerCase().replace(/\s+/g, '-'),
        section,
        ...(parent ? { parent } : {}),
        label: entry.counterparty,
        entity: entry.counterparty,
      };
      rows.push(row);
      values[`${customCatIndex(template, i)}-${entry.day}`] = entry.amount;
    });

    saveSubmission({ ...stored, customRows: rows, values });
    // The other half of every one of them, written by the app's own mirroring.
    syncMirrors({ period: week, entity, template, rows, values });
  }

  saveData(intercompanySeededKey(week), true);
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
    // The forecasts were seeded by an earlier version that had neither a
    // conversation nor a settlement on them; give this week both on the way
    // past. Each has its own marker, so neither re-runs once written.
    seedDemoQuestions(week);
    seedDemoIntercompany(week);
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
  // …and the week's conversation and settlements, on the forecasts just
  // created. Intercompany goes first: mirroring writes into counterparties'
  // forecasts, and every one of them now exists.
  seedDemoIntercompany(week);
  seedDemoQuestions(week);
}
