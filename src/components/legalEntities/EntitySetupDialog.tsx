import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { assignmentList, eligibleUsers, withAssignment } from '../../data/legalEntityService';
import { loadSettings } from '../../storage/localStorage';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { EntityResponsibility, ForecastTemplate, LegalEntity, User } from '../../types';

const RESPONSIBILITIES: {
  key: EntityResponsibility;
  title: string;
  blurb: string;
}[] = [
  {
    key: 'viewer',
    title: 'Viewers',
    blurb: 'Can view this entity’s forecasts. Cannot edit, submit or approve.',
  },
  {
    key: 'approver',
    title: 'Approvers',
    blurb: 'Can review submitted forecasts, view comments, approve or return for update.',
  },
  {
    key: 'submitter',
    title: 'Submitters',
    blurb: 'Can edit this entity’s forecasts, add comments and submit them.',
  },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface EntitySetupDialogProps {
  /** The entity being configured; null closes the dialog. */
  entity: LegalEntity | null;
  users: User[];
  templates: ForecastTemplate[];
  canManage: boolean;
  onClose: () => void;
  onChange: (next: LegalEntity) => void;
  /**
   * Renaming is not an ordinary field edit — stored forecasts are keyed by
   * entity name — so the owner handles it, on blur rather than per keystroke.
   */
  onRename: (name: string) => void;
}

/**
 * Everything configurable about one legal entity, in a single dialog opened
 * from its row: master data, who is responsible for it, and the forecast
 * template it submits on.
 *
 * Assigning a user is an inline disclosure rather than a second dialog —
 * stacking modals leaves two focus traps and two Escape handlers fighting
 * over the same keypress.
 */
export function EntitySetupDialog({
  entity,
  users,
  templates,
  canManage,
  onClose,
  onChange,
  onRename,
}: EntitySetupDialogProps) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState<EntityResponsibility | null>(null);
  // The fallback an entity without its own threshold is held to.
  const defaultThreshold = useMemo(
    () => loadSettings(DEFAULT_SETTINGS).varianceThreshold,
    [],
  );

  const update = <K extends keyof LegalEntity>(key: K, value: LegalEntity[K]) => {
    if (!entity || !canManage) return;
    onChange({ ...entity, [key]: value });
  };

  const toggleAssignment = (
    responsibility: EntityResponsibility,
    email: string,
    assigned: boolean,
  ) => {
    if (!entity || !canManage) return;
    onChange(withAssignment(entity, responsibility, email, assigned));
  };

  const commitName = () => {
    if (!entity || nameDraft === null) return;
    const next = nameDraft.trim();
    setNameDraft(null);
    if (!next || next === entity.name) return;
    onRename(next);
  };

  const close = () => {
    setNameDraft(null);
    setPicking(null);
    onClose();
  };

  const assignedTemplate = templates.find((t) => t.id === entity?.forecastTemplateId);
  const displayName = (email: string) => users.find((u) => u.email === email)?.name ?? email;

  return (
    <Modal
      open={entity !== null}
      size="wide"
      title={entity ? `${entity.name} · Setup` : ''}
      onClose={close}
      footer={
        <>
          {canManage && (
            <span className="text-muted" style={{ fontSize: 11, marginRight: 'auto' }}>
              Changes are saved automatically as you edit.
            </span>
          )}
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      {entity && (
        <div className="entity-setup" data-tour="entity-setup">
          {/* ---------- Master data ---------- */}
          <h4 className="setup-heading">Entity details</h4>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Legal Entity Name</label>
              <input
                className="form-input"
                value={nameDraft ?? entity.name}
                disabled={!canManage}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Country</label>
              <input
                className="form-input"
                value={entity.country}
                disabled={!canManage}
                onChange={(e) => update('country', e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Region</label>
              <input
                className="form-input"
                value={entity.region}
                disabled={!canManage}
                onChange={(e) => update('region', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <input
                className="form-input"
                value={entity.currency}
                disabled={!canManage}
                onChange={(e) => update('currency', e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <div className="row-flex">
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={entity.status}
                disabled={!canManage}
                onChange={(e) => update('status', e.target.value as LegalEntity['status'])}
                aria-label="Entity status"
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
              <span className="text-muted" style={{ fontSize: 11 }}>
                Inactive entities stay configured but drop out of forecast selection.
              </span>
            </div>
          </div>

          {/* ---------- Variance rule ---------- */}
          <h4 className="setup-heading">
            Variance rule
            <span className="text-muted"> · when this entity must explain a move</span>
          </h4>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Variance Threshold (%)</label>
              <input
                className="form-input"
                inputMode="numeric"
                placeholder={`${defaultThreshold} (group default)`}
                value={entity.varianceThreshold ?? ''}
                disabled={!canManage}
                aria-label="Variance threshold percent"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  // Blank means "follow the group default" rather than 0%,
                  // which would flag every cell in the grid.
                  update(
                    'varianceThreshold',
                    raw === '' ? undefined : Math.max(0, Number(raw) || 0),
                  );
                }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Effect</label>
              <div className="text-dim" style={{ fontSize: 12, lineHeight: 1.7 }}>
                Cells moving more than ±
                <strong>{entity.varianceThreshold ?? defaultThreshold}%</strong> versus the prior
                cycle are flagged and need commentary before this entity's forecast can be closed.
                <div className="text-muted">
                  Leave blank to follow the group default of ±{defaultThreshold}%.
                </div>
              </div>
            </div>
          </div>

          {/* ---------- Responsibilities ---------- */}
          <h4 className="setup-heading">
            Entity responsibilities
            <span className="text-muted"> · who can do what, for this entity</span>
          </h4>
          {RESPONSIBILITIES.map(({ key, title, blurb }) => {
            const assigned = assignmentList(entity, key);
            const eligible = eligibleUsers(users, key);
            const open = picking === key;
            return (
              <div className="setup-block" key={key}>
                <div className="setup-block-head">
                  <div>
                    <strong>{title}</strong>
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {blurb} Only users with the global <strong>{key}</strong> role can be
                      assigned.
                    </div>
                  </div>
                  {canManage && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      aria-expanded={open}
                      onClick={() => setPicking(open ? null : key)}
                    >
                      {open ? 'Done' : `+ Add ${title.slice(0, -1)}`}
                    </button>
                  )}
                </div>
                {assigned.length === 0 ? (
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    No {title.toLowerCase()} assigned
                    {eligible.length === 0
                      ? ` — no active users hold the ${key} role yet.`
                      : '.'}
                  </span>
                ) : (
                  <div className="assignment-chips">
                    {assigned.map((email) => (
                      <span className="assignment-chip" key={email}>
                        <strong>{displayName(email)}</strong>
                        <span className="text-muted">{email}</span>
                        {canManage && (
                          <button
                            className="chip-remove"
                            aria-label={`Remove ${displayName(email)}`}
                            title="Remove from this entity"
                            onClick={() => toggleAssignment(key, email, false)}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {open &&
                  (eligible.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
                      No active users hold the {key} role. Add one in User Management first.
                    </div>
                  ) : (
                    <div className="assign-picker">
                      {eligible.map((u) => {
                        const isAssigned = assigned.includes(u.email);
                        return (
                          <label key={u.email} className="assign-option">
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={() => toggleAssignment(key, u.email, !isAssigned)}
                            />
                            <span className="assign-option-text">
                              <strong>{u.name}</strong>
                              <span className="text-muted">{u.email}</span>
                            </span>
                            <span className={`role-tag ${u.role}`}>{u.role}</span>
                          </label>
                        );
                      })}
                    </div>
                  ))}
              </div>
            );
          })}

          {/* ---------- Forecast template ---------- */}
          <h4 className="setup-heading">
            Forecast template
            <span className="text-muted"> · used for this entity’s submissions</span>
          </h4>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Assigned Template</label>
              <select
                className="form-select"
                value={entity.forecastTemplateId}
                disabled={!canManage}
                onChange={(e) => update('forecastTemplateId', e.target.value)}
                aria-label="Forecast template"
              >
                <option value="">— none —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Template Details</label>
              {assignedTemplate ? (
                <div className="text-dim" style={{ fontSize: 12, lineHeight: 1.7 }}>
                  <div>
                    <strong>{assignedTemplate.name}</strong>{' '}
                    <span className="role-tag treasury">assigned</span>
                  </div>
                  <div>
                    {assignedTemplate.categories.length} line items ·{' '}
                    {assignedTemplate.fileName ?? 'built-in'}
                  </div>
                  <div className="text-muted">
                    Last updated {formatDate(assignedTemplate.uploadedAt)} by{' '}
                    {assignedTemplate.uploadedBy}
                  </div>
                </div>
              ) : (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  No template assigned — submitters cannot enter a forecast for this entity.
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
