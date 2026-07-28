import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { seedUsers } from '../../data/appData';
import { currentUser, permissionsFor } from '../../data/session';
import {
  assignmentList,
  eligibleUsers,
  listLegalEntities,
  persistLegalEntities,
  withAssignment,
} from '../../data/legalEntityService';
import { loadTemplates, loadUsers } from '../../storage/localStorage';
import type { EntityResponsibility, LegalEntity } from '../../types';

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

const EMPTY_ENTITY = {
  name: '',
  country: '',
  region: '',
  currency: 'EUR',
  status: 'active' as LegalEntity['status'],
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Legal Entity Setup — the entity is the object being configured. Selecting
 * an entity reveals its master data, the users responsible for it (viewers /
 * approvers / submitters, each selectable only from users holding the
 * matching GLOBAL role) and its forecast template.
 *
 * This screen owns entity↔user relationships; User Management only reads
 * them. Treasury sees it read-only unless an admin enables management.
 */
export function LegalEntitySetup() {
  const me = currentUser();
  const canManage = permissionsFor(me).canManageLegalEntities;
  const { notify } = useDialog();

  const [entityList, setEntityList] = useState<LegalEntity[]>(() => listLegalEntities());
  const [selectedId, setSelectedId] = useState<string>(() => listLegalEntities()[0]?.id ?? '');
  const [addingEntity, setAddingEntity] = useState(false);
  const [entityForm, setEntityForm] = useState(EMPTY_ENTITY);
  const [assigning, setAssigning] = useState<EntityResponsibility | null>(null);

  const users = useMemo(() => loadUsers(seedUsers()), []);
  const templates = useMemo(() => loadTemplates(), []);

  const selected = entityList.find((e) => e.id === selectedId) ?? entityList[0] ?? null;

  /** Persist one edited entity and keep local state in sync. */
  const applyEntity = (next: LegalEntity) => {
    const list = entityList.map((e) => (e.id === next.id ? next : e));
    setEntityList(persistLegalEntities(list));
  };

  const updateField = <K extends keyof LegalEntity>(key: K, value: LegalEntity[K]) => {
    if (!selected || !canManage) return;
    applyEntity({ ...selected, [key]: value });
  };

  const toggleAssignment = (
    responsibility: EntityResponsibility,
    email: string,
    assigned: boolean,
  ) => {
    if (!selected || !canManage) return;
    applyEntity(withAssignment(selected, responsibility, email, assigned));
  };

  const addEntity = async () => {
    const name = entityForm.name.trim();
    if (!name) {
      await notify({ tone: 'error', message: 'Legal entity name is required.' });
      return;
    }
    if (entityList.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      await notify({ tone: 'error', message: 'A legal entity with this name already exists.' });
      return;
    }
    const created: LegalEntity = {
      id: `le-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
      name,
      country: entityForm.country.trim() || name,
      region: entityForm.region.trim() || '—',
      currency: entityForm.currency.trim().toUpperCase() || 'EUR',
      status: entityForm.status,
      viewers: [],
      approvers: [],
      submitters: [],
      forecastTemplateId: templates[0]?.id ?? '',
    };
    setEntityList(persistLegalEntities([...entityList, created]));
    setSelectedId(created.id);
    setEntityForm(EMPTY_ENTITY);
    setAddingEntity(false);
  };

  const userByEmail = (email: string) => users.find((u) => u.email === email);
  const displayName = (email: string) => userByEmail(email)?.name ?? email;

  const assignedTemplate = templates.find((t) => t.id === selected?.forecastTemplateId);

  return (
    <div className="view active">
      <TopBar
        crumb="Administration"
        title="Legal Entity Setup"
        actions={
          canManage ? (
            <button className="btn btn-primary" onClick={() => setAddingEntity(true)}>
              + Add Legal Entity
            </button>
          ) : (
            <ViewOnlyBadge />
          )
        }
      />
      <div className="content">
        {/* ---------- Overview of every configured entity ---------- */}
        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-toolbar-left">
              <label className="form-label" style={{ margin: 0 }}>
                Legal Entity
              </label>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={selected?.id ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Select legal entity"
                data-tour="entity-selector"
              >
                {entityList.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.status === 'inactive' ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid-info">
              <strong>{entityList.length} legal entities</strong> ·{' '}
              <span className="text-muted">
                {entityList.filter((e) => e.status === 'active').length} active · entity
                responsibilities and templates are configured here
              </span>
            </div>
          </div>
          <div className="panel-body no-pad">
            <table>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Country</th>
                  <th>Region</th>
                  <th>Currency</th>
                  <th>Status</th>
                  <th>Forecast Template</th>
                  <th className="num">Viewers</th>
                  <th className="num">Approvers</th>
                  <th className="num">Submitters</th>
                </tr>
              </thead>
              <tbody>
                {entityList.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    className={`${e.id === selected?.id ? 'row-selected' : ''}${
                      e.status === 'inactive' ? ' row-inactive' : ''
                    }`}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <strong>{e.name}</strong>
                    </td>
                    <td className="text-dim">{e.country}</td>
                    <td className="text-dim">{e.region}</td>
                    <td className="text-dim">{e.currency}</td>
                    <td>
                      <span
                        className={`status ${e.status === 'inactive' ? 'rejected' : 'approved'}`}
                      >
                        <span className="dot" />
                        {e.status}
                      </span>
                    </td>
                    <td className="text-dim" style={{ fontSize: 12 }}>
                      {templates.find((t) => t.id === e.forecastTemplateId)?.name ?? '— none —'}
                    </td>
                    <td className="num">{e.viewers.length}</td>
                    <td className="num">{e.approvers.length}</td>
                    <td className="num">{e.submitters.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!selected ? (
          <div className="panel">
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No legal entities configured yet. Add one to get started.</p>
            </div>
          </div>
        ) : (
          <>
            {/* ---------- Entity master data ---------- */}
            <div className="section-header">
              <h2>{selected.name}</h2>
              <span className="tag">entity details</span>
            </div>
            <div className="panel">
              <div className="panel-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Legal Entity Name</label>
                    <input
                      className="form-input"
                      value={selected.name}
                      disabled={!canManage}
                      onChange={(e) => updateField('name', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Country</label>
                    <input
                      className="form-input"
                      value={selected.country}
                      disabled={!canManage}
                      onChange={(e) => updateField('country', e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Region</label>
                    <input
                      className="form-input"
                      value={selected.region}
                      disabled={!canManage}
                      onChange={(e) => updateField('region', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Currency</label>
                    <input
                      className="form-input"
                      value={selected.currency}
                      disabled={!canManage}
                      onChange={(e) => updateField('currency', e.target.value.toUpperCase())}
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Status</label>
                  <div className="row-flex">
                    <select
                      className="form-select"
                      style={{ width: 'auto' }}
                      value={selected.status}
                      disabled={!canManage}
                      onChange={(e) =>
                        updateField('status', e.target.value as LegalEntity['status'])
                      }
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
              </div>
            </div>

            {/* ---------- Entity user assignments ---------- */}
            <div className="section-header">
              <h2>Entity Responsibilities</h2>
              <span className="tag">who can do what, for this entity</span>
            </div>
            {RESPONSIBILITIES.map(({ key, title, blurb }) => {
              const assigned = assignmentList(selected, key);
              const eligible = eligibleUsers(users, key);
              return (
                <div className="panel" key={key}>
                  <div className="panel-header">
                    <div>
                      <h3>{title}</h3>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {blurb} Only users with the global <strong>{key}</strong> role can be
                        assigned.
                      </div>
                    </div>
                    {canManage && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '5px 12px', fontSize: 12 }}
                        onClick={() => setAssigning(key)}
                      >
                        + Add {title.slice(0, -1)}
                      </button>
                    )}
                  </div>
                  <div className="panel-body">
                    {assigned.length === 0 ? (
                      <span className="text-muted" style={{ fontSize: 13 }}>
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
                  </div>
                </div>
              );
            })}

            {/* ---------- Forecast template ---------- */}
            <div className="section-header">
              <h2 data-tour="entity-template">Forecast Template</h2>
              <span className="tag">used for this entity’s submissions</span>
            </div>
            <div className="panel">
              <div className="panel-body">
                <div className="form-row">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Assigned Template</label>
                    <select
                      className="form-select"
                      value={selected.forecastTemplateId}
                      disabled={!canManage}
                      onChange={(e) => updateField('forecastTemplateId', e.target.value)}
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
            </div>

            {canManage && (
              <div className="grid-info" style={{ paddingBottom: 20 }}>
                <span className="text-muted">
                  Changes are saved automatically as you edit.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------- Add entity ---------- */}
      <Modal
        open={addingEntity}
        title="Add Legal Entity"
        onClose={() => setAddingEntity(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAddingEntity(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={addEntity}>
              Add Entity
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Legal Entity Name</label>
            <input
              className="form-input"
              value={entityForm.name}
              onChange={(e) => setEntityForm({ ...entityForm, name: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Country</label>
            <input
              className="form-input"
              value={entityForm.country}
              onChange={(e) => setEntityForm({ ...entityForm, country: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Region</label>
            <input
              className="form-input"
              value={entityForm.region}
              onChange={(e) => setEntityForm({ ...entityForm, region: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Currency</label>
            <input
              className="form-input"
              value={entityForm.currency}
              onChange={(e) => setEntityForm({ ...entityForm, currency: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select
            className="form-select"
            value={entityForm.status}
            onChange={(e) =>
              setEntityForm({ ...entityForm, status: e.target.value as LegalEntity['status'] })
            }
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
        <div className="text-muted" style={{ fontSize: 11 }}>
          Viewers, approvers, submitters and the forecast template are assigned after the entity
          is created.
        </div>
      </Modal>

      {/* ---------- Assign a user to a responsibility ---------- */}
      <Modal
        open={assigning !== null}
        title={assigning ? `Add ${assigning}` : ''}
        onClose={() => setAssigning(null)}
        footer={
          <button className="btn btn-ghost" onClick={() => setAssigning(null)}>
            Done
          </button>
        }
      >
        {assigning && selected && (
          <>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Only active users whose <strong>global role</strong> is “{assigning}” appear here.
              Change a user’s global role in User Management.
            </div>
            {eligibleUsers(users, assigning).length === 0 ? (
              <div className="empty-state" style={{ padding: '30px 20px' }}>
                <p>
                  No active users hold the {assigning} role. Add one in User Management first.
                </p>
              </div>
            ) : (
              <div className="assign-picker">
                {eligibleUsers(users, assigning).map((u) => {
                  const isAssigned = assignmentList(selected, assigning).includes(u.email);
                  return (
                    <label key={u.email} className="assign-option">
                      <input
                        type="checkbox"
                        checked={isAssigned}
                        onChange={() => toggleAssignment(assigning, u.email, !isAssigned)}
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
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
