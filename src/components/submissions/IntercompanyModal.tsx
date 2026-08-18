import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { QuestionThread, ThreadComposer } from '../review/QuestionThread';
import {
  counterpartyOptions,
  mismatchThread,
  newLegId,
} from '../../data/intercompanyService';
import { parseCellNumber } from './gridMath';
import type { IntercompanyLeg, IntercompanyMismatch, ThreadRole } from '../../types';

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

/** A leg while it is being edited: the amount is text until it is committed. */
interface DraftLeg {
  id: string;
  counterparty: string;
  amount: string;
  /** Carried through untouched — a mirrored leg keeps where it came from. */
  source?: IntercompanyLeg['mirrorOf'];
  /** Why this side changed a mirrored figure. Required before it can be saved. */
  reason: string;
}

/** One mirrored figure this side has changed, and the reason it gave. */
export interface IntercompanyDispute {
  legId: string;
  counterparty: string;
  originalAmount: number;
  changedAmount: number;
  reason: string;
}

export interface IntercompanySaveResult {
  legs: IntercompanyLeg[];
  /** Changes to mirrored figures — each becomes a flag and a thread. */
  disputes: IntercompanyDispute[];
  /** Mirrored figures put back as they arrived: the disagreement is withdrawn. */
  agreed: string[];
}

const toDraft = (leg: IntercompanyLeg): DraftLeg => ({
  id: leg.id,
  counterparty: leg.counterparty,
  amount: leg.amount === 0 ? '' : String(leg.amount),
  source: leg.mirrorOf,
  reason: '',
});

const draftAmount = (draft: DraftLeg): number =>
  draft.amount.trim() === '' ? 0 : (parseCellNumber(draft.amount) ?? 0);

interface IntercompanyModalProps {
  /** The entity whose forecast this is — never selectable as a counterparty. */
  entity: string;
  /** Line item label, e.g. "Intercompany Payments". */
  label: string;
  /** e.g. "Wed 12 Aug". */
  periodLabel: string;
  legs: IntercompanyLeg[];
  /** Figures are read-only whenever the grid's cells are. */
  readOnly: boolean;
  /**
   * The key that opened the dialog, when a number was typed at the cell. It
   * starts the first amount that is actually this side's to enter — never a
   * mirrored one, where a stray keystroke would read as a dispute.
   */
  initialDigit?: string;
  onClose: () => void;
  onSave: (result: IntercompanySaveResult) => void;
}

/**
 * The counterparty breakdown behind one intercompany cell.
 *
 * The cell is the SUM of these rows, and each row is a movement with one other
 * legal entity — which is why the counterparty is a picker over the configured
 * entities rather than a text box: an amount owed to a name nobody recognises
 * can never be mirrored into the forecast on the other side of it.
 *
 * One row is the default and is enough to finish. Rows the app mirrored in
 * arrive filled and locked to their source entity; changing one of their
 * amounts is a disagreement with another entity's figure, so it asks for a
 * reason before it will save.
 */
export function IntercompanyModal({
  entity,
  label,
  periodLabel,
  legs,
  readOnly,
  initialDigit,
  onClose,
  onSave,
}: IntercompanyModalProps) {
  const [drafts, setDrafts] = useState<DraftLeg[]>(() => {
    const rows = legs.map(toDraft);
    // A cell nobody has entered yet opens with the one row that finishes it.
    if (rows.length === 0) {
      rows.push({ id: newLegId(entity), counterparty: '', amount: '', reason: '' });
    }
    if (!initialDigit) return rows;
    const first = rows.findIndex((r) => !r.source);
    if (first >= 0) {
      rows[first] = { ...rows[first], amount: initialDigit };
      return rows;
    }
    // Every row on this cell came from somebody else. Typing a number means
    // "add mine", not "argue with theirs".
    return [
      ...rows,
      { id: newLegId(entity), counterparty: '', amount: initialDigit, reason: '' },
    ];
  });

  const total = drafts.reduce((sum, d) => sum + draftAmount(d), 0);

  /** Rows this side entered, as legs — the shape counterparty options want. */
  const asLegs = useMemo<IntercompanyLeg[]>(
    () =>
      drafts.map((d) => ({
        id: d.id,
        counterparty: d.counterparty,
        amount: draftAmount(d),
        ...(d.source ? { mirrorOf: d.source } : {}),
      })),
    [drafts],
  );

  const update = (id: string, patch: Partial<DraftLeg>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const addRow = () =>
    setDrafts((prev) => [
      ...prev,
      { id: newLegId(entity), counterparty: '', amount: '', reason: '' },
    ]);

  const removeRow = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id));

  /** Counterparties still free, plus whatever this row already holds. */
  const optionsFor = (draft: DraftLeg): string[] => {
    const free = counterpartyOptions(entity, asLegs, draft.id);
    return draft.counterparty && !free.includes(draft.counterparty)
      ? [draft.counterparty, ...free]
      : free;
  };

  /** A mirrored row whose amount no longer matches what arrived. */
  const changed = (d: DraftLeg): boolean =>
    d.source !== undefined && draftAmount(d) !== d.source.originalAmount;

  const namedRows = drafts.filter((d) => d.counterparty.trim() !== '');
  const missingCounterparty = drafts.some(
    (d) => d.counterparty.trim() === '' && d.amount.trim() !== '',
  );
  const missingReason = drafts.some((d) => changed(d) && !d.reason.trim());
  const noneLeft = counterpartyOptions(entity, asLegs).length === 0;

  const save = () => {
    const kept = namedRows;
    const nextLegs: IntercompanyLeg[] = kept.map((d) => ({
      id: d.id,
      counterparty: d.counterparty,
      amount: draftAmount(d),
      ...(d.source ? { mirrorOf: d.source } : {}),
    }));
    const disputes: IntercompanyDispute[] = kept
      .filter(changed)
      .map((d) => ({
        legId: d.id,
        counterparty: d.counterparty,
        originalAmount: d.source?.originalAmount ?? 0,
        changedAmount: draftAmount(d),
        reason: d.reason.trim(),
      }));
    // A row put back exactly as it arrived is agreement, and takes any flag
    // raised on it earlier away with it.
    const agreed = kept.filter((d) => d.source && !changed(d)).map((d) => d.id);
    onSave({ legs: nextLegs, disputes, agreed });
  };

  return (
    <Modal
      open
      title={readOnly ? 'Counterparty Breakdown' : 'Intercompany · By Counterparty'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              className="btn btn-primary"
              disabled={missingCounterparty || missingReason}
              title={
                missingCounterparty
                  ? 'Every amount needs the entity it moves with'
                  : missingReason
                    ? 'Changing a counterparty’s figure needs a reason'
                    : 'Save the breakdown and mirror it into each counterparty’s forecast'
              }
              onClick={save}
            >
              Save Breakdown
            </button>
          )}
        </>
      }
    >
      <div className="variance-panel" style={{ marginBottom: 18 }}>
        <h4>Intercompany Cell</h4>
        <div className="row">
          <span>
            {label} · {periodLabel}
          </span>
          <span className="figure">{fmtK(total)}</span>
        </div>
        <div className="row">
          <span className="text-muted" style={{ fontSize: 12 }}>
            The cell holds the total; each row is one movement with one entity. Saving mirrors
            every row into that entity’s forecast for this period, with the sign flipped.
          </span>
        </div>
      </div>

      <div className="interco-rows">
        <div className="interco-head">
          <span>Amount (€ thousands)</span>
          <span>Counterparty</span>
          <span />
        </div>
        {drafts.map((d) => {
          const mirrored = d.source !== undefined;
          return (
            <div key={d.id} className={`interco-row${mirrored ? ' interco-mirrored' : ''}`}>
              <div className="interco-cellfield">
                <input
                  className="form-input"
                  inputMode="decimal"
                  placeholder="e.g. -1,250"
                  aria-label={`Amount for ${d.counterparty || 'this counterparty'}`}
                  value={d.amount}
                  disabled={readOnly}
                  onChange={(e) => update(d.id, { amount: e.target.value })}
                />
                {mirrored && (
                  <span className="interco-origin">
                    from {d.source?.entity} · system-generated
                    {d.source?.afterSubmission ? ' · arrived after you submitted' : ''}
                  </span>
                )}
              </div>
              <div className="interco-cellfield">
                {mirrored ? (
                  // The other side owns this row's identity: it is their
                  // figure, on their relationship. Only the amount is arguable.
                  <div className="readback interco-locked">{d.counterparty}</div>
                ) : (
                  <select
                    className="form-select"
                    aria-label="Counterparty"
                    value={d.counterparty}
                    disabled={readOnly}
                    onChange={(e) => update(d.id, { counterparty: e.target.value })}
                  >
                    <option value="">Select entity…</option>
                    {optionsFor(d).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="interco-cellfield interco-rowaction">
                {!readOnly && !mirrored && drafts.length > 1 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Remove this counterparty row"
                    onClick={() => removeRow(d.id)}
                  >
                    ×
                  </button>
                )}
              </div>
              {mirrored && changed(d) && (
                <div className="interco-reason">
                  <label className="form-label" htmlFor={`reason-${d.id}`}>
                    Why does your figure differ? (required)
                  </label>
                  <div className="interco-delta">
                    <span>
                      {d.source?.entity} sent {fmtK(d.source?.originalAmount ?? 0)}
                    </span>
                    <span className="figure">yours {fmtK(draftAmount(d))}</span>
                  </div>
                  <textarea
                    id={`reason-${d.id}`}
                    className="form-textarea"
                    rows={2}
                    placeholder="e.g. the settlement moved to the following week on our side"
                    value={d.reason}
                    disabled={readOnly}
                    onChange={(e) => update(d.id, { reason: e.target.value })}
                  />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Both figures are kept — neither forecast is overwritten. This raises a flag on
                    your cell and starts a thread with {d.source?.entity}. It blocks nothing.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="interco-actions">
          <button
            className="btn btn-ghost"
            disabled={noneLeft}
            title={
              noneLeft
                ? 'Every other entity is already on this cell'
                : 'Split this amount across another counterparty'
            }
            onClick={addRow}
          >
            + Add counterparty
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            One row is enough. Add more only when the amount splits.
          </span>
        </div>
      )}
    </Modal>
  );
}

interface MismatchModalProps {
  /** Line item and period, for the panel head. */
  label: string;
  periodLabel: string;
  /** Every disagreement on this cell, keyed as stored. */
  mismatches: [string, IntercompanyMismatch][];
  /** Which side the reader is on, so their own messages sit right. */
  viewerRole: ThreadRole | null;
  /** Readers can follow the conversation without joining it. */
  canReply: boolean;
  onReply: (key: string, text: string) => void;
  onSettle: (key: string) => void;
  onClose: () => void;
}

/**
 * The disagreement about a mirrored figure: what arrived, what this side put
 * in its place, why — and everything said since.
 *
 * The two numbers are shown side by side rather than reconciled into one:
 * neither entity's forecast is wrong until they agree which it is, and the app
 * has no business picking. Nothing here gates a submission or a cycle close.
 */
export function MismatchModal({
  label,
  periodLabel,
  mismatches,
  viewerRole,
  canReply,
  onReply,
  onSettle,
  onClose,
}: MismatchModalProps) {
  return (
    <Modal
      open
      title="Intercompany Mismatch"
      onClose={onClose}
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      {mismatches.length === 0 ? (
        <div className="empty-state">
          <p>Nothing is in dispute on this cell.</p>
        </div>
      ) : (
        mismatches.map(([key, m]) => (
          <div key={key} className="interco-mismatch">
            <div className="variance-panel" style={{ marginBottom: 12 }}>
              <h4>
                {label} · {periodLabel} · {m.counterparty}
                {m.settledAt && <span className="tag" style={{ marginLeft: 8 }}>settled</span>}
              </h4>
              <div className="row">
                <span>{m.counterparty} sent</span>
                <span className="figure">{fmtK(m.originalAmount)}</span>
              </div>
              <div className="row">
                <span>Changed to</span>
                <span className="figure">{fmtK(m.changedAmount)}</span>
              </div>
              <div className="row">
                <span className="text-muted" style={{ fontSize: 12 }}>
                  Both forecasts keep their own figure. This is a conversation, not a correction.
                </span>
              </div>
            </div>
            <QuestionThread messages={mismatchThread(m)} viewerRole={viewerRole} />
            {canReply && !m.settledAt && (
              <>
                <ThreadComposer
                  role={viewerRole ?? 'submitter'}
                  placeholder={`Reply to ${m.counterparty} about this figure…`}
                  sendLabel="Send Reply"
                  hint="Enter sends · Shift+Enter for a new line"
                  onSend={(text) => onReply(key, text)}
                />
                <div className="interco-actions">
                  <button
                    className="btn btn-ghost"
                    title="Agree the difference is explained and clear the flag"
                    onClick={() => onSettle(key)}
                  >
                    Mark settled
                  </button>
                </div>
              </>
            )}
          </div>
        ))
      )}
    </Modal>
  );
}
