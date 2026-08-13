import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import {
  assignmentList,
  lineItemAssignees,
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

  /** Only the entity's own submitters can own one of its lines. */
  const eligible = useMemo(() => {
    if (!entity) return [];
    const assigned = new Set(assignmentList(entity, 'submitter').map((e) => e.toLowerCase()));
    return users.filter((u) => assigned.has(u.email.toLowerCase()) && u.status !== 'inactive');
  }, [entity, users]);

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

  const toggle = (label: string, email: string, assigned: boolean) => {
    if (!entity || !canManage) return;
    onChange(withLineItemAssignment(entity, label, email, assigned));
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
      ) : eligible.length === 0 ? (
        <div className="empty-state">
          <div className="ic">?</div>
          <p>
            No submitters are assigned to {entity.name} yet. Add them under Entity
            responsibilities, then come back to split the template between them.
          </p>
        </div>
      ) : (
        <>
          <div className="line-owner-head">
            <span className="text-dim" style={{ fontSize: 12 }}>
              <strong>{assignedCount}</strong> of {lines.length} line items have an owner of their
              own. The rest stay with {entity.name}’s submitters.
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
                  {eligible.map((u) => (
                    <th key={u.email} className="num line-owner-col" title={u.email}>
                      {u.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((cat) => {
                  const owners = lineItemAssignees(entity, cat.label);
                  return (
                    <tr key={cat.label} className={owners.length === 0 ? 'row-inactive' : ''}>
                      <td>
                        <strong>{cat.label}</strong>
                        {cat.group && (
                          <span className="text-muted" style={{ fontSize: 11, marginLeft: 8 }}>
                            {cat.group}
                          </span>
                        )}
                        {owners.length === 0 && (
                          <span className="text-muted" style={{ fontSize: 11, marginLeft: 8 }}>
                            · entity submitters
                          </span>
                        )}
                      </td>
                      {eligible.map((u) => {
                        const checked = owners.some(
                          (e) => e.toLowerCase() === u.email.toLowerCase(),
                        );
                        return (
                          <td key={u.email} className="num">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canManage}
                              aria-label={`${u.name} owns ${cat.label}`}
                              onChange={() => toggle(cat.label, u.email, !checked)}
                            />
                          </td>
                        );
                      })}
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
