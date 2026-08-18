// ============================================================================
// Intercompany netting.
//
// An intercompany amount is ONE movement seen from two sides. It is entered
// once, by whoever owns the relationship, as a list of legs — an amount and
// the legal entity on the other side — and each leg is mirrored into that
// entity's own forecast for the same period, sign flipped and marked as
// system-generated.
//
// Three rules hold the whole thing together:
//
//   1. `values[cellKey]` remains the single number every other screen reads.
//      It is the SUM of the cell's legs and is rewritten whenever they change,
//      so the chart, the totals, the consolidation and the Excel export need to
//      know nothing about intercompany at all.
//   2. Only a leg WITHOUT `mirrorOf` mirrors outward. That one condition is
//      what stops Netherlands → France → Netherlands looping forever, and it
//      is why a receiving side can add its own outgoing legs to the very cell
//      its incoming ones landed in.
//   3. A receiving side that disagrees does NOT overwrite the figure on record.
//      Both numbers are kept — theirs on the leg, the originator's on
//      `mirrorOf.originalAmount` — and the disagreement becomes a thread
//      beside them. It gates nothing.
//
// Everything that writes to ANOTHER entity's forecast lives in this file, so
// there is exactly one place where one country's edit reaches another's data.
// ============================================================================
import type {
  ForecastTemplate,
  IntercompanyLeg,
  IntercompanyMismatch,
  Submission,
  TemplateCategory,
  ThreadMessage,
} from '../types';
import { cellKey } from '../components/submissions/gridMath';
import { listEntities } from './appData';
import { periodsOf } from './periods';
import {
  getOrCreateSubmission,
  isHandedOver,
  templateForEntity,
} from './submissionService';
import { loadTemplates, saveSubmission } from '../storage/localStorage';

/**
 * Mismatches are keyed per LEG, not per cell: a cell that netted three
 * counterparties can disagree with one of them and accept the other two.
 */
const MISMATCH_SEP = '::';

export const mismatchKey = (cell: string, legId: string): string =>
  `${cell}${MISMATCH_SEP}${legId}`;

/** The cell a mismatch key belongs to, for the grid's per-cell markers. */
export const mismatchCell = (key: string): string => key.split(MISMATCH_SEP)[0];

let legSeq = 0;
/**
 * A leg id unique across entities — it is the handle the counterparty's copy
 * keeps on this leg, so two entities generating ids at the same moment must
 * not collide.
 */
export function newLegId(entity: string): string {
  legSeq += 1;
  return `${entity.replace(/\s+/g, '-').toLowerCase()}-${Date.now().toString(36)}-${legSeq}`;
}

// ---------------------------------------------------------------------------
// Reading the template
// ---------------------------------------------------------------------------

/** Whether a template line is an intercompany one (subtotals never are). */
export function isIntercompanyCategory(cat: TemplateCategory | undefined): boolean {
  return Boolean(cat?.intercompany) && cat?.subtotal !== true;
}

/** Does this template collect intercompany figures at all? */
export function hasIntercompany(template: ForecastTemplate): boolean {
  return template.categories.some(isIntercompanyCategory);
}

/**
 * Every cell of a template that is entered through the counterparty
 * breakdown rather than typed into, keyed like `Submission.values`.
 */
export function intercompanyCells(template: ForecastTemplate): Set<string> {
  const out = new Set<string>();
  const periods = periodsOf(template).count;
  template.categories.forEach((cat, catIdx) => {
    if (!isIntercompanyCategory(cat)) return;
    for (let d = 0; d < periods; d++) out.add(cellKey(catIdx, d));
  });
  return out;
}

/**
 * Where a leg entered on `label` lands in another entity's template.
 *
 * Matched by LINE LABEL first, because two entities running the same chart of
 * accounts should see the figure on the same line. Falling back to the
 * template's first intercompany line keeps the mirror working across
 * mismatched templates rather than dropping the figure silently — which is
 * the one outcome nobody could detect.
 */
export function targetCellFor(
  template: ForecastTemplate,
  label: string,
  dayIdx: number,
): string | null {
  const wanted = label.trim().toLowerCase();
  let fallback = -1;
  for (let i = 0; i < template.categories.length; i++) {
    const cat = template.categories[i];
    if (!isIntercompanyCategory(cat)) continue;
    if (cat.label.trim().toLowerCase() === wanted) return cellKey(i, dayIdx);
    if (fallback < 0) fallback = i;
  }
  if (fallback < 0) return null;
  // The counterparty runs a different chart of accounts. Better on their one
  // intercompany line than nowhere.
  return dayIdx < periodsOf(template).count ? cellKey(fallback, dayIdx) : null;
}

// ---------------------------------------------------------------------------
// Reading and summing legs
// ---------------------------------------------------------------------------

export function legsOf(
  sub: Pick<Submission, 'intercompany'>,
  key: string,
): IntercompanyLeg[] {
  return sub.intercompany?.[key] ?? [];
}

/** A cell IS the sum of its legs — this is what `values[key]` is kept equal to. */
export function legsTotal(legs: IntercompanyLeg[]): number {
  return legs.reduce((sum, leg) => sum + (Number.isFinite(leg.amount) ? leg.amount : 0), 0);
}

/** A leg the app mirrored in, as opposed to one this entity entered. */
export const isMirrored = (leg: IntercompanyLeg): boolean => leg.mirrorOf !== undefined;

/** A mirrored leg whose amount this side has changed — i.e. a dispute. */
export function isDisputed(leg: IntercompanyLeg): boolean {
  return leg.mirrorOf !== undefined && leg.amount !== leg.mirrorOf.originalAmount;
}

/**
 * Counterparties selectable on a cell: every other configured entity, minus
 * the ones already taken by another leg of the same cell.
 *
 * One entity can appear at most once per cell — two rows naming France would
 * mean two mirrors into the same French cell with no way to tell which is
 * which, and no reading of the total that makes sense to either side.
 */
export function counterpartyOptions(
  ownEntity: string,
  legs: IntercompanyLeg[],
  exceptLegId?: string,
): string[] {
  const taken = new Set(
    legs.filter((l) => l.id !== exceptLegId).map((l) => l.counterparty).filter(Boolean),
  );
  return listEntities()
    .map((e) => e.name)
    .filter((name) => name !== ownEntity && !taken.has(name));
}

// ---------------------------------------------------------------------------
// Mismatch threads
//
// Shaped on `threadOf` / `withThreadMessage` in submissionService: the opening
// message plus `replies`, rendered by the same `QuestionThread`. The append
// rule differs — a question flips between "asked" and "answered", whereas a
// disagreement is simply open until somebody settles it — so it gets its own
// two functions rather than bending those.
// ---------------------------------------------------------------------------

/** The whole conversation about a disputed figure, oldest first. */
export function mismatchThread(mismatch: IntercompanyMismatch): ThreadMessage[] {
  return [
    {
      from: mismatch.from,
      role: mismatch.fromRole,
      text: mismatch.message,
      at: mismatch.raisedAt,
    },
    ...(mismatch.replies ?? []),
  ];
}

/** The mismatch map after `message` is added to one thread. */
export function withMismatchMessage(
  mismatches: Record<string, IntercompanyMismatch> | undefined,
  key: string,
  message: ThreadMessage,
): Record<string, IntercompanyMismatch> {
  const next = { ...(mismatches ?? {}) };
  const mismatch = next[key];
  if (!mismatch) return next;
  next[key] = {
    ...mismatch,
    replies: [...(mismatch.replies ?? []), message],
    // Anything said reopens it: a settled disagreement somebody comes back to
    // is a live one again.
    settledAt: undefined,
  };
  return next;
}

/** Mark one disagreement settled — the flag clears, the thread is kept. */
export function withMismatchSettled(
  mismatches: Record<string, IntercompanyMismatch> | undefined,
  key: string,
  at: string,
): Record<string, IntercompanyMismatch> {
  const next = { ...(mismatches ?? {}) };
  const mismatch = next[key];
  if (!mismatch) return next;
  next[key] = { ...mismatch, settledAt: at };
  return next;
}

/** Unsettled disagreements only — a settled one leaves no flag on the grid. */
export function openMismatchEntries(
  mismatches: Record<string, IntercompanyMismatch> | undefined,
): [string, IntercompanyMismatch][] {
  return Object.entries(mismatches ?? {})
    .filter(([, m]) => !m.settledAt)
    .sort((a, b) => a[1].raisedAt.localeCompare(b[1].raisedAt));
}

/** Cells carrying at least one unsettled disagreement. */
export function mismatchedCells(
  mismatches: Record<string, IntercompanyMismatch> | undefined,
): Set<string> {
  return new Set(openMismatchEntries(mismatches).map(([, m]) => m.cellKey));
}

/** Every disagreement on one cell, settled or not, oldest first. */
export function mismatchesOnCell(
  mismatches: Record<string, IntercompanyMismatch> | undefined,
  cell: string,
): [string, IntercompanyMismatch][] {
  return Object.entries(mismatches ?? {})
    .filter(([, m]) => m.cellKey === cell)
    .sort((a, b) => a[1].raisedAt.localeCompare(b[1].raisedAt));
}

// ---------------------------------------------------------------------------
// Mirroring
// ---------------------------------------------------------------------------

/** What a propagation did, so the screen can say so rather than guess. */
export interface MirrorOutcome {
  /** Entities whose forecast now holds a mirrored figure from this cell. */
  mirrored: string[];
  /** Entities whose mirrored figure was withdrawn. */
  removed: string[];
  /** Named counterparties with no intercompany line to receive the figure. */
  unreachable: string[];
  /** Entities whose forecast had already been handed over when it landed. */
  afterSubmission: string[];
}

const EMPTY_OUTCOME = (): MirrorOutcome => ({
  mirrored: [],
  removed: [],
  unreachable: [],
  afterSubmission: [],
});

/** Rewrite a submission's cell from its legs and hand back the new record. */
function withLegs(
  sub: Submission,
  key: string,
  legs: IntercompanyLeg[],
): Submission {
  const intercompany = { ...(sub.intercompany ?? {}) };
  if (legs.length === 0) delete intercompany[key];
  else intercompany[key] = legs;
  const values = { ...sub.values };
  const total = legsTotal(legs);
  // An emptied intercompany cell is emptied, not zeroed — "nothing agreed
  // yet" and "we forecast nil" are different answers, and pre-submit
  // validation reports on exactly that difference.
  if (legs.length === 0) delete values[key];
  else values[key] = total;
  return { ...sub, intercompany, values, updatedAt: new Date().toISOString() };
}

/**
 * Apply the legs a submitter just entered on one cell to every counterparty
 * they name — and withdraw the ones they no longer name.
 *
 * Called with the source entity's OWN legs for a single cell. Mirrored legs in
 * that list are ignored on the way out (rule 2 above): a figure that arrived
 * from somewhere else is not re-broadcast, it is answered.
 *
 * Each own leg produces one mirrored leg in one other entity's forecast, so a
 * cell split three ways writes into three different forecasts.
 */
export function propagateMirrors(params: {
  sourceEntity: string;
  period: string;
  /** The source entity's template — for the line label the mirror travels on. */
  template: ForecastTemplate;
  catIdx: number;
  dayIdx: number;
  legs: IntercompanyLeg[];
  /** Display name of whoever made the edit, for any dispute thread it touches. */
  by: string;
}): MirrorOutcome {
  const { sourceEntity, period, template, catIdx, dayIdx, legs, by } = params;
  const outcome = EMPTY_OUTCOME();
  const sourceCellKey = cellKey(catIdx, dayIdx);
  const label = template.categories[catIdx]?.label ?? '';
  if (!isIntercompanyCategory(template.categories[catIdx])) return outcome;

  const own = legs.filter((leg) => !isMirrored(leg) && leg.counterparty.trim() !== '');
  const wantedBy = new Map(own.map((leg) => [leg.counterparty, leg]));
  const templates = loadTemplates();
  const at = new Date().toISOString();

  // Every other entity is visited, not just the ones named: an entity dropped
  // from the list this time round still holds last time's mirror, and nothing
  // else would ever come back for it.
  for (const entity of listEntities().map((e) => e.name)) {
    if (entity === sourceEntity) continue;
    const wanted = wantedBy.get(entity);
    const targetTemplate = templateForEntity(templates, entity);
    if (!targetTemplate) {
      if (wanted) outcome.unreachable.push(entity);
      continue;
    }
    const targetKey = targetCellFor(targetTemplate, label, dayIdx);
    if (!targetKey) {
      if (wanted) outcome.unreachable.push(entity);
      continue;
    }

    let target = getOrCreateSubmission(entity, period, targetTemplate);
    // Sweep every cell, not only the target one: a template change can move
    // where this leg belongs, and the old copy must not survive as a second
    // figure from the same source.
    const stale: string[] = [];
    for (const [key, cellLegs] of Object.entries(target.intercompany ?? {})) {
      const holds = cellLegs.some(
        (l) => l.mirrorOf?.entity === sourceEntity && l.mirrorOf.sourceCellKey === sourceCellKey,
      );
      if (holds && key !== targetKey) stale.push(key);
    }
    for (const key of stale) {
      target = withLegs(
        target,
        key,
        legsOf(target, key).filter(
          (l) =>
            !(l.mirrorOf?.entity === sourceEntity && l.mirrorOf.sourceCellKey === sourceCellKey),
        ),
      );
    }

    const existing = legsOf(target, targetKey);
    const priorMirror = existing.find(
      (l) => l.mirrorOf?.entity === sourceEntity && l.mirrorOf.sourceCellKey === sourceCellKey,
    );
    const others = existing.filter((l) => l !== priorMirror);

    if (!wanted) {
      if (!priorMirror && stale.length === 0) continue;
      if (priorMirror) {
        target = withLegs(target, targetKey, others);
        target = closeMismatchFor(target, targetKey, priorMirror.id, {
          from: by,
          role: 'submitter',
          text: `${sourceEntity} withdrew this intercompany figure, so there is nothing left to reconcile.`,
          at,
        });
        outcome.removed.push(entity);
      }
      saveSubmission(target);
      continue;
    }

    // Sign flip: one side's payment is the other side's receipt.
    const mirroredAmount = -wanted.amount;
    const afterSubmission = isHandedOver(target.status);
    const source = {
      entity: sourceEntity,
      legId: wanted.id,
      sourceCellKey,
      originalAmount: mirroredAmount,
      at,
      ...(afterSubmission ? { afterSubmission: true as const } : {}),
    };

    let mirrorLeg: IntercompanyLeg;
    if (priorMirror) {
      // A figure the receiving side has already disputed keeps THEIR number —
      // the originator moving theirs does not overrule it, it moves what the
      // disagreement is about.
      const disputed = isDisputed(priorMirror);
      mirrorLeg = {
        ...priorMirror,
        counterparty: sourceEntity,
        amount: disputed ? priorMirror.amount : mirroredAmount,
        mirrorOf: source,
      };
      if (disputed && priorMirror.mirrorOf?.originalAmount !== mirroredAmount) {
        target = restateMismatch(target, targetKey, priorMirror.id, mirroredAmount, {
          from: by,
          role: 'submitter',
          text: `${sourceEntity} changed their figure to ${mirroredAmount.toLocaleString()} (as it reaches you).`,
          at,
        });
      }
    } else {
      mirrorLeg = {
        id: wanted.id,
        counterparty: sourceEntity,
        amount: mirroredAmount,
        mirrorOf: source,
      };
    }

    target = withLegs(target, targetKey, [...others, mirrorLeg]);
    saveSubmission(target);
    outcome.mirrored.push(entity);
    if (afterSubmission) outcome.afterSubmission.push(entity);
  }

  return outcome;
}

/** Settle a disagreement whose subject has gone away, keeping the record. */
function closeMismatchFor(
  sub: Submission,
  cell: string,
  legId: string,
  message: ThreadMessage,
): Submission {
  const key = mismatchKey(cell, legId);
  const existing = sub.mismatches?.[key];
  if (!existing || existing.settledAt) return sub;
  return {
    ...sub,
    mismatches: {
      ...sub.mismatches,
      [key]: {
        ...existing,
        replies: [...(existing.replies ?? []), message],
        settledAt: message.at,
      },
    },
  };
}

/** Move what a live disagreement is about, because the originator restated it. */
function restateMismatch(
  sub: Submission,
  cell: string,
  legId: string,
  originalAmount: number,
  message: ThreadMessage,
): Submission {
  const key = mismatchKey(cell, legId);
  const existing = sub.mismatches?.[key];
  if (!existing) return sub;
  return {
    ...sub,
    mismatches: {
      ...sub.mismatches,
      [key]: {
        ...existing,
        originalAmount,
        replies: [...(existing.replies ?? []), message],
        settledAt: undefined,
      },
    },
  };
}

/**
 * Where a mirrored leg came from, in words — "Netherlands · system-generated".
 * One phrasing, so the modal, the cell tooltip and the thread agree.
 */
export function mirrorLabel(leg: IntercompanyLeg): string {
  return leg.mirrorOf ? `from ${leg.mirrorOf.entity} · system-generated` : '';
}
