import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { ActionMenu } from '../common/ActionMenu';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { seedUsers } from '../../data/appData';
import { currentUser, permissionsFor } from '../../data/session';
import {
  listLegalEntities,
  removeUserFromEntities,
  responsibilitiesFor,
  type Responsibility,
} from '../../data/legalEntityService';
import { loadSettings, loadUsers, saveUsers } from '../../storage/localStorage';
import { appUrl, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { Role, User, UserStatus } from '../../types';

const ROLES: Role[] = ['submitter', 'approver', 'viewer', 'treasury'];

const ROLE_HINTS: Record<Role, string> = {
  treasury:
    'Full treasury oversight across all entities, plus user, template, legal entity and settings management.',
  approver: 'Reviews, approves and returns forecasts for assigned entities.',
  submitter: 'Prepares and submits forecasts for assigned entities.',
  viewer: 'Read-only access to assigned entity forecasts.',
};

const EMPTY_FORM = {
  name: '',
  email: '',
  team: '',
  role: 'submitter' as Role,
  status: 'active' as UserStatus,
};

/**
 * Opens the admin's desktop Outlook with a prefilled account-setup email for
 * `user`. Frontend-only: composing/sending stays in the mail client; the
 * signed-in admin is the sender context (Outlook sends from their account).
 */
function openSetupEmail(user: User, responsibilities: Responsibility[]): void {
  const admin = currentUser();
  const settings = loadSettings(DEFAULT_SETTINGS);
  const scope =
    responsibilities.length > 0
      ? responsibilities.map((r) => `${r.entityName} (${r.responsibility})`).join(', ')
      : 'no entities assigned yet — these are configured in Legal Entity Setup';
  openEmail({
    to: user.email,
    subject: `Your Liquid access — Cash Flow Forecasting (${user.role})`,
    body:
      `Hi ${user.name.split(' ')[0]},\n\n` +
      `An account has been set up for you in Liquid, our treasury cash flow forecasting tool.\n\n` +
      `Role: ${user.role}\n` +
      `Entity responsibilities: ${scope}\n\n` +
      `Getting started:\n` +
      `1. Open ${appUrl()}?welcome=1\n` +
      `2. Sign in with your ${settings.allowedDomains.split(/[,\s]+/)[0] ?? '@contoso.com'} account (${settings.ssoProvider.split('·')[0].trim()})\n` +
      `3. Go to "My Forecasts" to see the entities assigned to you${user.role === 'approver' ? ', or "Approvals" to review your queue' : ''}\n\n` +
      `If anything looks wrong, just reply to this email.\n\n` +
      `Best regards,\n${admin.name}\n${admin.email}`,
  });
}

/** The read-only responsibilities cell, derived from Legal Entity Setup. */
function ResponsibilitiesCell({ items }: { items: Responsibility[] }) {
  if (items.length === 0) {
    return (
      <span className="text-muted" style={{ fontSize: 12 }}>
        No entity assignments
      </span>
    );
  }
  return (
    <div className="responsibility-list">
      {items.map((r) => (
        <span key={`${r.entityId}-${r.responsibility}`} className="responsibility-chip">
          <span className={`role-tag ${r.responsibility}`}>{r.responsibility}</span>
          {r.entityName}
        </span>
      ))}
    </div>
  );
}

/**
 * User Management answers: who is the user, what is their GLOBAL role, and
 * what are their current entity responsibilities? Entity assignments are
 * read-only here — they are configured in Legal Entity Setup and derived
 * live, so removing someone there removes the entity from this list too.
 */
export function Users() {
  const [users, setUsers] = useState<User[]>(() => loadUsers(seedUsers()));
  const [adding, setAdding] = useState(false);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const me = currentUser();
  const canManage = permissionsFor(me).canManageUsers;
  const { confirm, notify } = useDialog();

  // Responsibilities come from the legal entities, never from the user.
  const legalEntities = useMemo(() => listLegalEntities(), []);
  const responsibilities = useMemo(() => {
    const map = new Map<string, Responsibility[]>();
    for (const u of users) map.set(u.email, responsibilitiesFor(u, legalEntities));
    return map;
  }, [users, legalEntities]);

  const commit = (next: User[]) => {
    setUsers(next);
    saveUsers(next);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditingEmail(null);
    setAdding(true);
  };

  const openEdit = (u: User) => {
    setForm({
      name: u.name,
      email: u.email,
      team: u.team ?? '',
      role: u.role,
      status: u.status ?? 'active',
    });
    setEditingEmail(u.email);
    setAdding(true);
  };

  const closeModal = () => {
    setAdding(false);
    setEditingEmail(null);
  };

  const saveUser = async () => {
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name || !email) {
      await notify({ message: 'Name and email are required.', tone: 'error' });
      return;
    }
    const duplicate = users.some(
      (u) => u.email.toLowerCase() === email && u.email !== editingEmail,
    );
    if (duplicate) {
      await notify({ message: 'A user with this email already exists.', tone: 'error' });
      return;
    }

    if (editingEmail) {
      commit(
        users.map((u) =>
          u.email === editingEmail
            ? { ...u, name, email, team: form.team.trim(), role: form.role, status: form.status }
            : u,
        ),
      );
      closeModal();
      return;
    }

    const created: User = {
      name,
      email,
      team: form.team.trim(),
      role: form.role,
      status: form.status,
      last: 'Invited',
    };
    commit([...users, created]);
    closeModal();
    // Hand the setup information straight to Outlook for the admin to send.
    openSetupEmail(created, []);
  };

  const toggleStatus = (u: User) => {
    const next: UserStatus = u.status === 'inactive' ? 'active' : 'inactive';
    commit(users.map((x) => (x.email === u.email ? { ...x, status: next } : x)));
  };

  const removeUser = async (u: User) => {
    const held = responsibilities.get(u.email) ?? [];
    const confirmed = await confirm({
      title: 'Remove user',
      message: (
        <>
          Remove <strong>{u.name}</strong> ({u.email})?
          {held.length > 0 && (
            <>
              {'\n\n'}They are still assigned to {held.length} entit
              {held.length === 1 ? 'y' : 'ies'} in Legal Entity Setup:{' '}
              {held.map((r) => r.entityName).join(', ')}.
            </>
          )}
        </>
      ),
      confirmLabel: 'Remove User',
      danger: true,
    });
    if (!confirmed) return;
    // Take their entity assignments with them, or the entity keeps counting
    // a user who no longer exists.
    if (held.length > 0) removeUserFromEntities(u.email);
    commit(users.filter((x) => x.email !== u.email));
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Administration"
        title="User Management"
        actions={
          canManage ? (
            <button className="btn btn-primary" data-tour="add-user" onClick={openAdd}>
              + Add User
            </button>
          ) : (
            <ViewOnlyBadge />
          )
        }
      />
      <div className="content">
        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>{users.length} users</strong> ·{' '}
              <span className="text-muted">
                global roles only — entity responsibilities are configured in Legal Entity Setup
                and shown here read-only
              </span>
            </div>
          </div>
          <div className="panel-body no-pad">
            <table data-tour="users-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Global Role</th>
                  <th>Status</th>
                  <th>Responsibilities</th>
                  <th>Last Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email} className={u.status === 'inactive' ? 'row-inactive' : undefined}>
                    <td>
                      <strong>{u.name}</strong>
                    </td>
                    <td className="text-dim">{u.email}</td>
                    <td>
                      <span className={`role-tag ${u.role}`}>{u.role}</span>
                    </td>
                    <td>
                      <span
                        className={`status ${u.status === 'inactive' ? 'rejected' : 'approved'}`}
                      >
                        <span className="dot" />
                        {u.status ?? 'active'}
                      </span>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <ResponsibilitiesCell items={responsibilities.get(u.email) ?? []} />
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>
                      {u.last}
                    </td>
                    <td>
                      {/* One button per row rather than four: the actions are
                          the same, the table is readable. */}
                      <ActionMenu
                        ariaLabel={`Actions for ${u.name}`}
                        items={[
                          {
                            label: 'Edit details',
                            onSelect: () => openEdit(u),
                            hidden: !canManage,
                          },
                          {
                            label: u.status === 'inactive' ? 'Activate' : 'Deactivate',
                            onSelect: () => toggleStatus(u),
                            hidden: !canManage,
                          },
                          {
                            label: 'Email setup',
                            onSelect: () =>
                              openSetupEmail(u, responsibilities.get(u.email) ?? []),
                          },
                          {
                            label: 'Remove user',
                            onSelect: () => removeUser(u),
                            danger: true,
                            hidden: !canManage,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={adding}
        title={editingEmail ? 'Edit User' : 'Add User'}
        onClose={closeModal}
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeModal}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveUser}>
              {editingEmail ? 'Save Changes' : 'Add & Compose Invite'}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              placeholder="user@contoso.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Global Role</label>
            <select
              className="form-select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
              {ROLE_HINTS[form.role]}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as UserStatus })}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Team (informational)</label>
          <input
            className="form-input"
            placeholder="e.g. Treasury HQ"
            value={form.team}
            onChange={(e) => setForm({ ...form, team: e.target.value })}
          />
        </div>
        <div className="variance-panel" style={{ marginBottom: 0 }}>
          <h4>Entity responsibilities</h4>
          <div className="row">
            <span>
              Which legal entities this user can view, submit or approve for is configured in
              <strong> Legal Entity Setup</strong>, not here.
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
