// ============================================================================
// Intercompany netting.
//
// An intercompany cell is not a number, it is a set of (amount, counterparty)
// rows: "€500k of intercompany payments" is €300k to France and €200k to
// Germany, and which is which is the whole point — it is what lets the group
// position net to zero. The cell's value stays the SUM of its rows, so every
// screen that reads `Submission.values` keeps working unchanged.
//
// The other half of the job is MIRRORING. When the Netherlands says it pays
// France €300k, that figure belongs in France's forecast too — with the sign
// flipped, marked as system-generated, and saying it came from the
// Netherlands. Several entities naming France in the same period is the
// normal case, so France's cell is the sum of everything mirrored into it,
// and opening it shows one row per originating entity.
//
// France may then disagree with one of those figures. That is a DISPUTE: the
// changed amount stays on the row, the deviation is never stored on the cell
// value, and the disagreement becomes a thread (`IntercompanyFlag`) shaped
// exactly like a question so the same components read it.
// ============================================================================
import type {
  ForecastTemplate,
  IntercompanyFlag,
  IntercompanyRow,
  Submission,
  ThreadMessage,
} from '../types';
import { listLegalEntities } from './legalEntityService';
import { periodsOf } from './periods';
import { loadSubmission, loadTemplates, saveSubmission } from '../storage/localStorage';
import { getOrCreateSubmission, isHandedOver, templateForEntity } from './submissionService';

/** Is this line item settled between group companies rather than outside? */
export function isIntercompanyCategory(
  template: Pick<ForecastTemplate, 'categories'>,
  catIdx: number,
): boolean {
  const cat = template.categories[catIdx];
  return cat?.intercompany === true && cat.subtotal !== true;
}

/** Cell keys of every intercompany cell on a template's horizon. */
export function intercompanyCells(template: ForecastTemplate): Set<string> {
  const out = new Set<string>();
  const periods = periodsOf(template).count;
  template.categories.forEach((_cat, catIdx) => {
    if (!isIntercompanyCategory(template, catIdx)) return;
    for (let d = 0; d < periods; d++) out.add(`${catIdx}-${d}`);
  });
  return out;
}

/** The rows behind one cell — always an array, never undefined. */
export function rowsOf(
  intercompany: Record<string, IntercompanyRow[]> | undefined,
  key: string,
): IntercompanyRow[] {
  return intercompany?.[key] ?? [];
}

/** What the cell displays: the sum of every row in it. */
export function rowsTotal(rows: IntercompanyRow[]): number {
  return rows.reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0);
}

/** A row this entity entered itself, as opposed to one mirrored into it. */
export const isOwnRow = (row: IntercompanyRow): boolean => !row.source;

/**
 * A mirrored row the receiving side has changed. The deviation is derived
 * from the row, never stored as a number of its own.
 */
export function isDisputed(row: IntercompanyRow): boolean {
  return row.source !== undefined && row.sourceAmount !== undefined && row.amount !== row.sourceAmount;
}

/** Where a mismatch is stored: the cell it sits in plus the row it is about. */
export const flagKey = (cellKey: string, rowId: string): string => `${cellKey}#${rowId}`;

/** Cells carrying an unsettled mismatch, for the grid's exclamation icon. */
export function flaggedCells(
  flags: Record<string, IntercompanyFlag> | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const flag of Object.values(flags ?? {})) {
    if (!flag.settledAt) out.add(flag.cellKey);
  }
  return out;
}

/** Every mismatch raised on one cell, oldest first. */
export function flagsForCell(
  flags: Record<string, IntercompanyFlag> | undefined,
  cellKey: string,
): IntercompanyFlag[] {
  return Object.values(flags ?? {})
    .filter((f) => f.cellKey === cellKey)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/**
 * The entities a counterparty can be, for one entity's own forecast.
 *
 * Read from the app's configured legal entities — never free text, because a
 * counterparty that does not resolve to a forecast is an amount that can
 * never be mirrored anywhere.
 */
export function counterpartyOptions(entity: string): string[] {
  return listLegalEntities()
    .filter((e) => e.status === 'active' && e.name !== entity)
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Mirroring
// ---------------------------------------------------------------------------

/** What happened to one counterparty when a cell's rows were saved. */
export interface MirrorOutcome {
  counterparty: string;
  status:
    | 'mirrored'
    | 'unknown-entity'
    | 'no-template'
    | 'no-line'
    | 'beyond-horizon'
    | 'consolidated';
  /**
   * The mirror landed on a forecast that had already been handed over, so the
   * figures somebody signed off no longer match what is in there.
   */
  late?: boolean;
}

/** Human wording for an outcome that is not a clean mirror. */
export function mirrorProblem(outcome: MirrorOutcome): string | null {
  switch (outcome.status) {
    case 'mirrored':
      return outcome.late
        ? `${outcome.counterparty} has already submitted — the entry is in their forecast and marked as arriving late.`
        : null;
    case 'unknown-entity':
      return `${outcome.counterparty} is not a configured legal entity, so nothing was mirrored.`;
    case 'no-template':
      return `${outcome.counterparty} has no forecast template assigned, so nothing was mirrored.`;
    case 'no-line':
      return `${outcome.counterparty}'s template has no matching intercompany line, so nothing was mirrored.`;
    case 'beyond-horizon':
      return `This period falls outside ${outcome.counterparty}'s forecast horizon, so nothing was mirrored.`;
    case 'consolidated':
      return `${outcome.counterparty}'s forecast is already consolidated, so it stays as reported.`;
  }
}

/** Deterministic id for the mirror of one row, so edits find it again. */
const mirrorId = (source: string, rowId: string): string => `mirror:${source}:${rowId}`;

interface MirrorTarget {
  submission: Submission;
  template: ForecastTemplate;
  /** The counterparty's own key for the corresponding cell. */
  cellKey: string;
}

/**
 * The counterparty's corresponding cell.
 *
 * Matched by line-item LABEL, not by index: entities can be on different
 * templates, and "Intercompany Payments" must land on "Intercompany Payments"
 * wherever it happens to sit in the other template. The period index is the
 * same on both sides — the cycle is what they share.
 */
function resolveTarget(
  counterparty: string,
  period: string,
  label: string,
  dayIdx: number,
  templates: ForecastTemplate[],
): { target: MirrorTarget } | { problem: MirrorOutcome['status'] } {
  const known = listLegalEntities().some(
    (e) => e.name === counterparty && e.status === 'active',
  );
  if (!known) return { problem: 'unknown-entity' };
  const template = templateForEntity(templates, counterparty);
  if (!template) return { problem: 'no-template' };
  if (dayIdx >= periodsOf(template).count) return { problem: 'beyond-horizon' };
  const catIdx = template.categories.findIndex(
    (cat, i) =>
      isIntercompanyCategory(template, i) &&
      cat.label.trim().toLowerCase() === label.trim().toLowerCase(),
  );
  if (catIdx < 0) return { problem: 'no-line' };
  const submission = getOrCreateSubmission(counterparty, period, template);
  return { target: { submission, template, cellKey: `${catIdx}-${dayIdx}` } };
}

/** Drop every mirror this cell previously wrote into a counterparty. */
function stripMirrors(
  intercompany: Record<string, IntercompanyRow[]>,
  source: string,
  sourceCellKey: string,
): { next: Record<string, IntercompanyRow[]>; removed: IntercompanyRow[] } {
  const next: Record<string, IntercompanyRow[]> = {};
  const removed: IntercompanyRow[] = [];
  for (const [key, rows] of Object.entries(intercompany)) {
    const kept = rows.filter((r) => {
      const mine = r.source === source && r.sourceCellKey === sourceCellKey;
      if (mine) removed.push(r);
      return !mine;
    });
    if (kept.length > 0) next[key] = kept;
  }
  return { next, removed };
}

/**
 * A mirrored row the receiving side has already argued with keeps THEIR
 * figure — the originator changing their mind does not silently overwrite a
 * dispute. What updates is what the originator now says, and the thread is
 * told so the disagreement stays about live numbers.
 */
function carryDispute(
  fresh: IntercompanyRow,
  previous: IntercompanyRow | undefined,
): IntercompanyRow {
  if (!previous || !isDisputed(previous)) return fresh;
  return { ...fresh, amount: previous.amount };
}

/** Recompute a cell's stored value from its rows (or clear it when empty). */
function applyCellValue(
  values: Record<string, number>,
  key: string,
  rows: IntercompanyRow[],
): Record<string, number> {
  const next = { ...values };
  if (rows.length === 0) delete next[key];
  else next[key] = rowsTotal(rows);
  return next;
}

export interface SyncMirrorsArgs {
  /** Forecast week the rows were entered for. */
  period: string;
  /** Entity whose submitter entered them. */
  entity: string;
  /** That entity's template — the cell key is addressed on it. */
  template: ForecastTemplate;
  /** Cell key on the entity's own template. */
  cellKey: string;
  /** The cell's rows AFTER the edit, the entity's own and mirrored alike. */
  rows: IntercompanyRow[];
}

/**
 * Push one intercompany cell's own rows into the counterparties' forecasts,
 * and withdraw anything this cell used to say and no longer does.
 *
 * Rebuilt rather than patched: every mirror this cell previously wrote is
 * stripped from every entity first, then the current rows are written. That
 * one rule covers editing an amount, repointing a row at a different
 * counterparty, deleting a row and clearing the cell — all of which used to
 * need a different code path each, and any of which would otherwise leave a
 * stale figure sitting in somebody else's forecast.
 *
 * Mirrored rows never mirror back: only rows this entity entered itself
 * travel, or two entities pointing at each other would bounce forever.
 */
export function syncIntercompanyMirrors(args: SyncMirrorsArgs): MirrorOutcome[] {
  const { period, entity, template, cellKey, rows } = args;
  const [catIdx, dayIdx] = cellKey.split('-').map(Number);
  const label = template.categories[catIdx]?.label;
  if (!label || !Number.isFinite(dayIdx)) return [];

  const templates = loadTemplates();
  const outcomes: MirrorOutcome[] = [];

  // What each counterparty should now hold from this cell. Several rows can
  // name the same entity only if the UI let them; summing them keeps the
  // mirror faithful either way.
  const wanted = new Map<string, IntercompanyRow[]>();
  for (const row of rows) {
    if (!isOwnRow(row) || !row.counterparty || !Number.isFinite(row.amount)) continue;
    const mirrored: IntercompanyRow = {
      id: mirrorId(entity, row.id),
      counterparty: entity,
      // The other side of the same movement: what one entity pays, the other
      // receives.
      amount: -row.amount,
      source: entity,
      sourceCellKey: cellKey,
      sourceAmount: -row.amount,
    };
    wanted.set(row.counterparty, [...(wanted.get(row.counterparty) ?? []), mirrored]);
  }

  // Everyone who should hold a mirror, plus everyone who currently holds one
  // and may no longer be a counterparty at all.
  const candidates = new Set<string>(wanted.keys());
  for (const legal of listLegalEntities()) {
    if (legal.name === entity || legal.status !== 'active') continue;
    if (candidates.has(legal.name)) continue;
    const other = templateForEntity(templates, legal.name);
    if (!other) continue;
    const stored = loadSubmission(period, legal.name, other.id);
    const holdsMirror = Object.values(stored?.intercompany ?? {}).some((cellRows) =>
      cellRows.some((r) => r.source === entity && r.sourceCellKey === cellKey),
    );
    if (holdsMirror) candidates.add(legal.name);
  }

  for (const counterparty of candidates) {
    const resolved = resolveTarget(counterparty, period, label, dayIdx, templates);
    if ('problem' in resolved) {
      outcomes.push({ counterparty, status: resolved.problem });
      continue;
    }
    const { submission, cellKey: targetKey } = resolved.target;
    // A consolidated forecast is history — the group position has been struck
    // on those figures and nothing may rewrite them behind it.
    if (submission.status === 'consolidated') {
      outcomes.push({ counterparty, status: 'consolidated' });
      continue;
    }

    const { next: strippedRows, removed } = stripMirrors(
      submission.intercompany ?? {},
      entity,
      cellKey,
    );
    const previousById = new Map(removed.map((r) => [r.id, r]));
    const late = isHandedOver(submission.status);
    const incoming = (wanted.get(counterparty) ?? []).map((row) => {
      const carried = carryDispute(row, previousById.get(row.id));
      return late ? { ...carried, late: true } : carried;
    });

    const nextIntercompany = { ...strippedRows };
    const merged = [...(nextIntercompany[targetKey] ?? []), ...incoming];
    if (merged.length > 0) nextIntercompany[targetKey] = merged;
    else delete nextIntercompany[targetKey];

    // Every cell the strip or the merge touched has to be re-totalled, not
    // just the target one: a row repointed at a different LINE would
    // otherwise leave the old cell showing a figure nothing backs.
    const touched = new Set<string>([targetKey, ...Object.keys(submission.intercompany ?? {})]);
    let values = submission.values;
    for (const key of touched) {
      values = applyCellValue(values, key, nextIntercompany[key] ?? []);
    }

    const liveRowIds = new Set(
      Object.values(nextIntercompany).flatMap((cellRows) => cellRows.map((r) => r.id)),
    );
    const nextFlags = Object.fromEntries(
      Object.entries(submission.intercompanyFlags ?? {}).map(([key, flag]) => {
        if (!liveRowIds.has(flag.rowId)) return [key, null];
        const fresh = incoming.find((r) => r.id === flag.rowId);
        const restated = fresh?.sourceAmount;
        // The originator moved their figure while a dispute was open: the
        // thread is about the NEW number now, and it says so.
        if (restated === undefined || restated === flag.sourceAmount) return [key, flag];
        const note: ThreadMessage = {
          from: entity,
          role: 'submitter',
          text: `${entity} changed their figure to ${restated.toLocaleString()}k.`,
          at: new Date().toISOString(),
        };
        return [
          key,
          {
            ...flag,
            sourceAmount: restated,
            replies: [...(flag.replies ?? []), note],
          } satisfies IntercompanyFlag,
        ];
      }),
    );

    saveSubmission({
      ...submission,
      values,
      intercompany: nextIntercompany,
      intercompanyFlags: Object.fromEntries(
        Object.entries(nextFlags).filter(([, flag]) => flag !== null),
      ) as Record<string, IntercompanyFlag>,
      updatedAt: new Date().toISOString(),
    });
    outcomes.push({
      counterparty,
      status: 'mirrored',
      ...(late && incoming.length > 0 ? { late: true } : {}),
    });
  }

  return outcomes;
}

/**
 * Keep only well-formed rows — storage can hold anything, and a row with no
 * counterparty is an amount that can never be netted against anything.
 */
export function normalizeIntercompany(raw: unknown): Record<string, IntercompanyRow[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, IntercompanyRow[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const rows = value
      .filter((v): v is Partial<IntercompanyRow> => typeof v === 'object' && v !== null)
      .filter((r) => typeof r.counterparty === 'string' && r.counterparty.trim())
      .map((r, i) => ({
        id: typeof r.id === 'string' && r.id ? r.id : `row-${i}`,
        counterparty: String(r.counterparty),
        amount: typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : 0,
        ...(typeof r.source === 'string' ? { source: r.source } : {}),
        ...(typeof r.sourceCellKey === 'string' ? { sourceCellKey: r.sourceCellKey } : {}),
        ...(typeof r.sourceAmount === 'number' ? { sourceAmount: r.sourceAmount } : {}),
        ...(r.late === true ? { late: true as const } : {}),
      }));
    if (rows.length > 0) out[key] = rows;
  }
  return out;
}

/** The same, for the mismatches raised on those rows. */
export function normalizeIntercompanyFlags(
  raw: unknown,
): Record<string, IntercompanyFlag> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, IntercompanyFlag> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const f = value as Partial<IntercompanyFlag>;
    if (typeof f.cellKey !== 'string' || typeof f.rowId !== 'string') continue;
    if (typeof f.message !== 'string' || !f.message.trim()) continue;
    out[key] = {
      cellKey: f.cellKey,
      rowId: f.rowId,
      source: typeof f.source === 'string' ? f.source : '—',
      sourceAmount: typeof f.sourceAmount === 'number' ? f.sourceAmount : 0,
      amount: typeof f.amount === 'number' ? f.amount : 0,
      from: typeof f.from === 'string' && f.from ? f.from : 'Unknown',
      fromRole:
        f.fromRole === 'treasury' || f.fromRole === 'approver' ? f.fromRole : 'submitter',
      message: f.message,
      requestedAt:
        typeof f.requestedAt === 'string' ? f.requestedAt : new Date().toISOString(),
      replies: Array.isArray(f.replies)
        ? f.replies.filter(
            (m): m is ThreadMessage =>
              typeof m === 'object' && m !== null && typeof (m as ThreadMessage).text === 'string',
          )
        : [],
      ...(typeof f.answeredAt === 'string' ? { answeredAt: f.answeredAt } : {}),
      ...(typeof f.settledAt === 'string' ? { settledAt: f.settledAt } : {}),
    };
  }
  return out;
}
