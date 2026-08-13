import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { MultiSelect } from '../common/MultiSelect';
import {
  assignmentList,
  eligibleUsers,
  lineItemAssignees,
  withAssignment,
  withLineItemAssignment,
} from '../../data/legalEntityService';
import type { ForecastTemplate, LegalEntity, User } from '../../types';

interface LineItemOwnersDialogProps {
  /** The entity being configured; null keeps the dialog closed. */
  entity: LegalEntity | null;
  /** The template it submits on — the line items come from here. */
  template: ForecastTemplate | null;
  users: User[];
  canManage: boolean;
  onClose: () => void;
  onChange: (next: LegalEntity) => void;
}

/**
 * Who owns each LINE ITEM of an entity's forecast template.
 *
 * A country forecast is rarely one person's work — payroll comes from HR, tax
 * from the tax team, receivables from the shared service centre — and until
 * now the app knew only "the entity's submitters", so every question about
 * every line went to whoever happened to be first in that list.
 *
 * One row per line item with an owner picker, rather than a checkbox per
 * person per line: a column per candidate looked tidy against three names and
 * became a grid nobody could read against thirty, and it hid the answer people
 * actually want — WHO owns this line — behind counting ticks across a row.
 *
 * Assignment is per line and optional: a line with nobody on it stays with the
 * entity's submitters, which is exactly how every entity behaved before.
 */
export function LineItemOwnersDialog({
  entity,
  template,
  users,
  canManage,
  onClose,
  onChange,
}: LineItemOwnersDialogProps) {
  const [search, setSearch] = useState('');

  /**
   * Everyone who could own a line: every active user holding the submitter
   * role, not only those already on this entity.
   *
   * Offering the entity's existing submitters alone made the picker look
   * broken — the person you wanted to give payroll to was simply not in the
   * list — and left you configuring the same thing in two places. Assigning
   * someone here adds them to the entity's submitters, which is what gives
   * them the forecast in the first place.
   */
  const candidates = useMemo(() => eligibleUsers(users, 'submitter'), [users]);
  const nameOf = useMemo(
    () => new Map(candidates.map((u) => [u.email.toLowerCase(), u.name])),
    [candidates],
  );
  const emailOf = useMemo(
    () => new Map(candidates.map((u) => [u.name, u.email])),
    [candidates],
  );

  /** Input lines only: a subtotal is computed, so nobody forecasts it. */
  const lines = useMemo(() => {
    const seen = new Set<string>();
    return (template?.categories ?? [])
      .filter((c) => !c.subtotal)
      .filter((c) => {
        const key = c.label.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [template]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.group ?? '').toLowerCase().includes(q),
    );
  }, [lines, search]);

  /** The entity's own submitters, shown as the fallback for unassigned lines. */
  const entitySubmitters = entity
    ? assignmentList(entity, 'submitter').map((e) => nameOf.get(e.toLowerCase()) ?? e)
    : [];

  const setOwners = (label: string, names: string[]) => {
    if (!entity || !canManage) return;
    const emails = names.map((n) => emailOf.get(n)).filter((e): e is string => Boolean(e));
    const current = lineItemAssignees(entity, label);
    let next = entity;
    for (const email of emails) {
      if (!current.includes(email)) next = withLineItemAssignment(next, label, email, true);
    }
    for (const email of current) {
      if (!emails.includes(email)) next = withLineItemAssignment(next, label, email, false);
    }
    // Owning a line means submitting for this entity — otherwise the person
    // assigned here cannot even open the forecast the line belongs to.
    for (const email of emails) next = withAssignment(next, 'submitter', email, true);
    onChange(next);
  };

  const assignedCount = entity
    ? lines.filter((c) => lineItemAssignees(entity, c.label).length > 0).length
    : 0;

  return (
    <Modal
      open={entity !== null}
      size="wide"
      title={
        entity && template ? `${entity.name} · ${template.name} — line item owners` : 'Line items'
      }
      onClose={onClose}
      footer={
        <>
          {canManage && (
            <span className="text-muted" style={{ fontSize: 11, marginRight: 'auto' }}>
              Changes are saved automatically as you edit.
            </span>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {!entity || !template ? (
        <div className="empty-state">
          <div className="ic">▦</div>
          <p>Assign a forecast template to this entity first — its line items come from there.</p>
        </div>
      ) : candidates.length === 0 ? (
        <div className="empty-state">
          <div className="ic">?</div>
          <p>
            No active user holds the submitter role yet. Add one in User Management, then come
            back to split this template between them.
          </p>
        </div>
      ) : (
        <>
          <div className="line-owner-head">
            <span className="text-dim" style={{ fontSize: 12 }}>
              <strong>{assignedCount}</strong> of {lines.length} line items have an owner of their
              own. The rest stay with{' '}
              {entitySubmitters.length > 0 ? entitySubmitters.join(', ') : `${entity.name}’s submitters`}.
            </span>
            <input
              className="form-input"
              style={{ width: 200 }}
              placeholder="Find a line item…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search line items"
            />
          </div>
          <div className="panel-body no-pad">
            <table>
              <thead>
                <tr>
                  <th>Line Item</th>
                  <th>Section</th>
                  <th style={{ width: 260 }}>Owners</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((cat) => {
                  const owners = lineItemAssignees(entity, cat.label)
                    .map((e) => nameOf.get(e.toLowerCase()) ?? e)
                    // A name the directory no longer knows cannot be shown as
                    // a selected option, so it is dropped rather than
                    // silently cleared on the next edit.
                    .filter((n) => emailOf.has(n));
                  return (
                    <tr key={cat.label}>
                      <td>
                        <strong>{cat.label}</strong>
                      </td>
                      <td className="text-muted" style={{ fontSize: 11 }}>
                        {cat.group ?? '—'}
                      </td>
                      <td>
                        {canManage ? (
                          <MultiSelect
                            ariaLabel={`Owners of ${cat.label}`}
                            options={candidates.map((u) => u.name)}
                            selected={owners}
                            onChange={(names) => setOwners(cat.label, names)}
                            emptyLabel="Entity submitters"
                            noun="owners"
                            placeholder="Search people…"
                          />
                        ) : (
                          <span className="text-dim" style={{ fontSize: 12 }}>
                            {owners.length > 0 ? owners.join(', ') : 'Entity submitters'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 && (
              <div className="empty-state">
                <p>No line item matches “{search}”.</p>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
