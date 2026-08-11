import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { EntitySetupDialog } from './EntitySetupDialog';
import { seedUsers } from '../../data/appData';
import { currentUser, permissionsFor } from '../../data/session';
import { listLegalEntities, persistLegalEntities } from '../../data/legalEntityService';
import { loadTemplates, loadUsers, renameEntityInSubmissions } from '../../storage/localStorage';
import type { LegalEntity } from '../../types';

const EMPTY_ENTITY = {
  name: '',
  country: '',
  region: '',
  currency: 'EUR',
  status: 'active' as LegalEntity['status'],
};

/**
 * Legal Entity Setup — the entity is the object being configured.
 *
 * The screen itself is the list of entities; clicking a row opens that
 * entity's setup in a dialog (master data, the users responsible for it, and
 * its forecast template) so configuring one never means scrolling away from
 * the list to find it.
 *
 * This screen owns entity↔user relationships; User Management only reads
 * them. Treasury sees it read-only unless an admin enables management.
 */
export function LegalEntitySetup() {
  const me = currentUser();
  const canManage = permissionsFor(me).canManageLegalEntities;
  const { notify } = useDialog();

  const [entityList, setEntityList] = useState<LegalEntity[]>(() => listLegalEntities());
  /** The entity whose setup dialog is open; null while just browsing. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingEntity, setAddingEntity] = useState(false);
  const [entityForm, setEntityForm] = useState(EMPTY_ENTITY);

  const users = useMemo(() => loadUsers(seedUsers()), []);
  const templates = useMemo(() => loadTemplates(), []);

  const openEntity = entityList.find((e) => e.id === openId) ?? null;

  /** Persist one edited entity and keep local state in sync. */
  const applyEntity = (next: LegalEntity) => {
    setEntityList(persistLegalEntities(entityList.map((e) => (e.id === next.id ? next : e))));
  };

  // Renaming re-keys stored forecasts, so it is validated and reported rather
  // than applied like an ordinary field edit.
  const renameEntity = async (next: string) => {
    if (!openEntity) return;
    if (
      entityList.some((e) => e.id !== openEntity.id && e.name.toLowerCase() === next.toLowerCase())
    ) {
      await notify({ tone: 'error', message: 'Another legal entity already has that name.' });
      return;
    }
    const moved = renameEntityInSubmissions(openEntity.name, next);
    applyEntity({ ...openEntity, name: next });
    if (moved > 0) {
      await notify({
        tone: 'success',
        message: `Renamed to “${next}”. ${moved} stored forecast${moved === 1 ? '' : 's'} moved with it.`,
      });
    }
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
    setEntityForm(EMPTY_ENTITY);
    setAddingEntity(false);
    // Straight into its setup — a new entity has nobody assigned to it yet.
    setOpenId(created.id);
  };

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
        {entityList.length === 0 ? (
          <div className="panel">
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No legal entities configured yet. Add one to get started.</p>
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="grid-toolbar">
              <div className="grid-info">
                <strong>{entityList.length} legal entities</strong> ·{' '}
                <span className="text-muted">
                  {entityList.filter((e) => e.status === 'active').length} active
                </span>
              </div>
              <div className="grid-info">
                <span className="text-muted">
                  Open an entity for its details, responsibilities and template.
                </span>
              </div>
            </div>
            <div className="panel-body no-pad">
              <table data-tour="entity-table">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Country</th>
                    <th>Region</th>
                    <th>Currency</th>
                    <th>Status</th>
                    <th data-tour="entity-template">Forecast Template</th>
                    <th className="num">Variance</th>
                    <th className="num">Viewers</th>
                    <th className="num">Approvers</th>
                    <th className="num">Submitters</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {entityList.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setOpenId(e.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setOpenId(e.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open setup for ${e.name}`}
                      className={`entity-row${e.status === 'inactive' ? ' row-inactive' : ''}`}
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
                      <td className="num">
                        {e.varianceThreshold === undefined ? (
                          <span className="text-muted">default</span>
                        ) : (
                          `±${e.varianceThreshold}%`
                        )}
                      </td>
                      <td className="num">{e.viewers.length}</td>
                      <td className="num">{e.approvers.length}</td>
                      <td className="num">{e.submitters.length}</td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setOpenId(e.id);
                          }}
                        >
                          {canManage ? 'Set Up' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ---------- Per-entity setup ---------- */}
      <EntitySetupDialog
        entity={openEntity}
        users={users}
        templates={templates}
        canManage={canManage}
        onClose={() => setOpenId(null)}
        onChange={applyEntity}
        onRename={renameEntity}
      />

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
    </div>
  );
}
