import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { QuestionThread, ThreadComposer } from '../review/QuestionThread';
import { parseCellNumber } from './gridMath';
import { flagKey } from '../../data/intercompanyService';
import { threadOf } from '../../data/submissionService';
import type { IntercompanyFlag, IntercompanyRow, ThreadRole } from '../../types';

/** A mismatch the reader has just created by changing a mirrored amount. */
export interface DisputeDraft {
  rowId: string;
  /** Entity whose figure is being disputed. */
  source: string;
  /** What they said, in this entity's sign. */
  sourceAmount: number;
  /** What this side changed it to. */
  amount: number;
  reason: string;
}

interface IntercompanyModalProps {
  /** The entity whose forecast holds this cell. */
  entity: string;
  /** Line item label, e.g. "Intercompany Payments". */
  label: string;
  /** "Mon 4 Aug" */
  periodLabel: string;
  /** Context line for the panel head, e.g. "Netherlands · CW 33". */
  context?: string;
  /** The cell's rows as stored. */
  rows: IntercompanyRow[];
  /**
   * What the cell currently holds. Normally the sum of `rows` — but a line
   * marked intercompany after forecasts already exist has a figure and no
   * rows behind it, and that figure is the first thing to say who it is with
   * rather than something to silently drop.
   */
  cellValue: number;
  /** Mismatches already raised on this cell. */
  flags: IntercompanyFlag[];
  /** Every entity a counterparty may be — the app's configured legal entities. */
  counterparties: string[];
  /** False locks the whole dialog: the same breakdown, read-only. */
  editable: boolean;
  /** The digit typed to open the cell, which starts the first row's amount. */
  prefill?: string;
  /** Whoever is looking, for anything they write into a thread. */
  viewer: string;
  viewerRole: ThreadRole;
  onClose: () => void;
  /** Save the rows, together with any mismatch raised in the same breath. */
  onSave: (rows: IntercompanyRow[], disputes: DisputeDraft[]) => void;
  onReplyToFlag: (key: string, text: string) => void;
  onSettleFlag: (key: string) => void;
}

/** A row while it is being edited: the amount is text, as typed. */
interface DraftRow {
  id: string;
  counterparty: string;
  amount: string;
  source?: string;
  sourceCellKey?: string;
  sourceAmount?: number;
  late?: boolean;
  /** What the row held when the dialog opened — what a change is measured from. */
  storedAmount: number;
}

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

let draftSeq = 0;
const newRowId = () => `ic-${Date.now().toString(36)}-${(draftSeq += 1)}`;

function toDraft(row: IntercompanyRow): DraftRow {
  return {
    id: row.id,
    counterparty: row.counterparty,
    amount: row.amount === 0 ? '' : String(row.amount),
    source: row.source,
    sourceCellKey: row.sourceCellKey,
    sourceAmount: row.sourceAmount,
    late: row.late,
    storedAmount: row.amount,
  };
}

const amountOf = (row: DraftRow): number => parseCellNumber(row.amount) ?? 0;

/**
 * The counterparty breakdown behind one intercompany cell.
 *
 * The cell is a total; this is what it is made of. Rows the entity entered
 * itself sit alongside rows mirrored in from whoever named this entity as
 * THEIR counterparty — several entities naming the same one in a period is
 * the normal case, so the incoming rows arrive prefilled, each saying where
 * it came from, and the total is simply their sum.
 *
 * Changing a mirrored amount is disagreeing with another entity's figure, so
 * it asks for a reason and raises a mismatch thread rather than quietly
 * overwriting what they said. Rows nobody touched stay clean.
 */
export function IntercompanyModal({
  entity,
  label,
  periodLabel,
  context,
  rows,
  cellValue,
  flags,
  counterparties,
  editable,
  prefill,
  viewer,
  viewerRole,
  onClose,
  onSave,
  onReplyToFlag,
  onSettleFlag,
}: IntercompanyModalProps) {
  /**
   * One row is the default and must be enough to finish: a cell that splits
   * across nobody is still an intercompany cell, and making the submitter
   * press "add" before they can type anything is a step for its own sake.
   */
  const [draft, setDraft] = useState<DraftRow[]>(() => {
    const existing = rows.map(toDraft);
    const blank = (amount: string): DraftRow => ({
      id: newRowId(),
      counterparty: '',
      amount,
      storedAmount: 0,
    });
    // Nothing behind the cell yet: start from whatever it already holds, so a
    // figure entered before the line was marked intercompany is carried into
    // the breakdown instead of quietly becoming zero.
    if (existing.length === 0) {
      return [blank(prefill ?? (cellValue === 0 ? '' : String(cellValue)))];
    }
    if (!prefill) return existing;
    // A digit typed at the cell starts the first row this entity OWNS — the
    // mirrored rows are somebody else's figures, and typing over one of them
    // would be disagreeing with it by accident.
    const first = existing.findIndex((r) => !r.source);
    return first < 0
      ? [...existing, blank(prefill)]
      : existing.map((r, i) => (i === first ? { ...r, amount: prefill } : r));
  });
  /** Reasons for the mirrored amounts changed in this sitting. */
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(
    () => draft.reduce((sum, r) => sum + amountOf(r), 0),
    [draft],
  );

  /** A mirrored row whose amount has been changed here — a disagreement. */
  const isChangedMirror = (row: DraftRow): boolean =>
    row.source !== undefined && amountOf(row) !== row.storedAmount;

  const setRow = (id: string, patch: Partial<DraftRow>) =>
    setDraft((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () =>
    setDraft((prev) => [
      ...prev,
      { id: newRowId(), counterparty: '', amount: '', storedAmount: 0 },
    ]);

  const removeRow = (id: string) => setDraft((prev) => prev.filter((r) => r.id !== id));

  /**
   * Counterparties still available to a row.
   *
   * An entity chosen anywhere in this cell is gone from every other row's
   * options: two rows naming the same counterparty are one row, and they
   * would mirror as two separate figures into the same forecast.
   */
  const optionsFor = (row: DraftRow): string[] => {
    const taken = new Set(
      draft.filter((r) => r.id !== row.id).map((r) => r.counterparty).filter(Boolean),
    );
    return counterparties.filter((name) => !taken.has(name) || name === row.counterparty);
  };

  const save = () => {
    const cleaned = draft.filter((r) => r.counterparty || r.amount.trim());
    const missing = cleaned.find((r) => !r.counterparty);
    if (missing) {
      setError('Every row needs a counterparty — that is what decides whose forecast the amount lands in.');
      return;
    }
    const unexplained = cleaned.find(
      (r) => isChangedMirror(r) && !reasons[r.id]?.trim(),
    );
    if (unexplained) {
      setError(
        `Say why ${unexplained.source}'s figure is wrong before saving — they see the reason and can reply to it.`,
      );
      return;
    }
    const nextRows: IntercompanyRow[] = cleaned.map((r) => ({
      id: r.id,
      counterparty: r.counterparty,
      amount: amountOf(r),
      ...(r.source ? { source: r.source } : {}),
      ...(r.sourceCellKey ? { sourceCellKey: r.sourceCellKey } : {}),
      ...(r.sourceAmount !== undefined ? { sourceAmount: r.sourceAmount } : {}),
      ...(r.late ? { late: true as const } : {}),
    }));
    const disputes: DisputeDraft[] = cleaned.filter(isChangedMirror).map((r) => ({
      rowId: r.id,
      source: r.source ?? '—',
      sourceAmount: r.sourceAmount ?? r.storedAmount,
      amount: amountOf(r),
      reason: reasons[r.id]?.trim() ?? '',
    }));
    onSave(nextRows, disputes);
  };

  const incoming = draft.filter((r) => r.source);
  const own = draft.filter((r) => !r.source);

  return (
    <Modal
      open
      size="wide"
      title={editable ? 'Intercompany Breakdown' : 'Intercompany Breakdown · read-only'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {editable ? 'Cancel' : 'Close'}
          </button>
          {editable && (
            <button className="btn btn-primary" onClick={save}>
              Save Breakdown
            </button>
          )}
        </>
      }
    >
      <div className="variance-panel" style={{ marginBottom: 18 }}>
        <h4>
          Intercompany Cell{context ? ` · ${context}` : ''}
        </h4>
        <div className="row">
          <span>
            {label} · {periodLabel}
          </span>
          <span className="figure">{fmtK(total)}</span>
        </div>
        <div className="row">
          <span className="text-muted">
            {incoming.length > 0
              ? `${incoming.length} incoming from ${incoming.length === 1 ? 'another entity' : 'other entities'}`
              : 'Nothing mirrored in yet'}
            {own.length > 0 ? ` · ${own.length} of your own` : ''}
          </span>
          <span className="text-muted">Inflows positive, outflows negative · EUR thousands</span>
        </div>
      </div>

      <div className="ic-rows" role="group" aria-label="Counterparty breakdown">
        <div className="ic-row ic-row-head" aria-hidden="true">
          <span>Amount</span>
          <span>Counterparty — paid to / received from</span>
          <span />
          <span />
        </div>
        {draft.map((row) => {
          const changed = isChangedMirror(row);
          return (
            <div key={row.id} className={`ic-row${row.source ? ' ic-row-mirrored' : ''}`}>
              <input
                className="form-input ic-amount"
                inputMode="decimal"
                placeholder="0"
                value={row.amount}
                disabled={!editable}
                aria-label={`Amount for ${row.counterparty || 'this counterparty'}`}
                onChange={(e) => setRow(row.id, { amount: e.target.value })}
              />
              <select
                className="form-select ic-party"
                value={row.counterparty}
                // A mirrored row's counterparty is not a choice: it is
                // whoever entered the figure on the other side.
                disabled={!editable || Boolean(row.source)}
                aria-label="Counterparty"
                onChange={(e) => setRow(row.id, { counterparty: e.target.value })}
              >
                <option value="">Select an entity…</option>
                {optionsFor(row).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {row.source ? (
                <span className="ic-source" title={`Entered by ${row.source} and mirrored here`}>
                  from {row.source}
                  {row.late ? ' · arrived after you submitted' : ''}
                </span>
              ) : (
                <span />
              )}
              {editable && !row.source ? (
                <button
                  className="ic-remove"
                  title="Remove this row"
                  aria-label={`Remove ${row.counterparty || 'this row'}`}
                  onClick={() => removeRow(row.id)}
                >
                  ×
                </button>
              ) : (
                <span />
              )}
              {changed && (
                <div className="ic-dispute-draft">
                  <label className="form-label" htmlFor={`ic-reason-${row.id}`}>
                    Why does {row.source}'s figure of{' '}
                    {fmtK(row.sourceAmount ?? row.storedAmount)} not match? (required)
                  </label>
                  <textarea
                    id={`ic-reason-${row.id}`}
                    className="form-textarea"
                    rows={2}
                    placeholder="e.g. their invoice settles on the 14th, not the 12th — ours is a week later"
                    value={reasons[row.id] ?? ''}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                  />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Saving flags this cell and starts a thread with {row.source}. It never
                    blocks your submission or the cycle.
                  </span>
                </div>
              )}
            </div>
          );
        })}
        <div className="ic-row ic-row-total">
          <span className="figure">{fmtK(total)}</span>
          <span className="text-muted">
            The cell shows this total — one row per counterparty adds up to it.
          </span>
          <span />
          <span />
        </div>
      </div>

      {editable && (
        <div className="ic-actions">
          <button
            className="btn btn-ghost"
            disabled={counterparties.every((name) =>
              draft.some((r) => r.counterparty === name),
            )}
            title="Split this amount across another counterparty"
            onClick={addRow}
          >
            + Add Counterparty
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Each row appears in that entity's own forecast for this period, with the sign
            flipped and marked as coming from {entity}.
          </span>
        </div>
      )}

      {error && (
        <div className="variance-panel needs-input" style={{ marginTop: 14 }}>
          <div className="row">
            <span>{error}</span>
          </div>
        </div>
      )}

      {flags.length > 0 && (
        <div className="ic-flags">
          <h4 className="ic-flags-head">
            <span aria-hidden="true">!</span> Mismatches on this cell
          </h4>
          {flags.map((flag) => {
            const key = flagKey(flag.cellKey, flag.rowId);
            return (
              <div
                key={key}
                className={`variance-panel ic-flag${flag.settledAt ? ' settled' : ''}`}
              >
                <div className="row">
                  <span>
                    <strong>{flag.source}</strong> said {fmtK(flag.sourceAmount)}
                    {' · '}
                    {entity} carries {fmtK(flag.amount)}
                  </span>
                  <span className="figure">
                    {fmtK(flag.amount - flag.sourceAmount)} apart
                  </span>
                </div>
                <QuestionThread messages={threadOf(flag, '', viewer)} />
                {flag.settledAt ? (
                  <div className="row">
                    <span className="text-muted">Settled — both sides are done with this one.</span>
                  </div>
                ) : (
                  <>
                    <ThreadComposer
                      role={viewerRole}
                      hint="Enter sends · both sides read this thread"
                      placeholder={`Reply to ${flag.source} — which figure is right, and why?`}
                      sendLabel="Send Reply"
                      onSend={(text) => onReplyToFlag(key, text)}
                    />
                    <div className="row">
                      <span className="text-muted">
                        Neither side is blocked by this — the forecast submits and the cycle
                        closes with it open.
                      </span>
                      <button className="btn btn-ghost" onClick={() => onSettleFlag(key)}>
                        Mark Settled
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
