import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { entities, users as seedUsers } from '../../data/mockData';
import { currentUser } from '../../data/session';
import { loadSettings, loadUsers, saveUsers } from '../../storage/localStorage';
import { appUrl, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { Role, User } from '../../types';

const ROLES: Role[] = ['submitter', 'approver', 'treasury', 'admin'];

const initials = (name: string) =>
  name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('');

const EMPTY_FORM = { name: '', email: '', team: entities[0]?.name ?? '', role: 'submitter' as Role };

/**
 * Opens the admin's desktop Outlook with a prefilled account-setup email for
 * `user`. Frontend-only: composing/sending stays in the mail client; the
 * signed-in admin is the sender context (Outlook sends from their account).
 */
function openSetupEmail(user: User): void {
  const admin = currentUser();
  const settings = loadSettings(DEFAULT_SETTINGS);
  openEmail({
    to: user.email,
    subject: `Your Liquid access — Cash Flow Forecasting (${user.role})`,
    body:
      `Hi ${user.name.split(' ')[0]},\n\n` +
      `An account has been set up for you in Liquid, our treasury cash flow forecasting tool.\n\n` +
      `Role: ${user.role}\n` +
      `Entity / Team: ${user.team}\n` +
      `Approval scope: ${user.scope}\n\n` +
      `Getting started:\n` +
      `1. Open ${appUrl()}\n` +
      `2. Sign in with your ${settings.allowedDomains.split(/[,\s]+/)[0] ?? '@contoso.com'} account (${settings.ssoProvider.split('·')[0].trim()})\n` +
      `3. Go to "My Submissions" to enter your first forecast${user.role === 'approver' ? ', or "Approvals" to review your queue' : ''}\n\n` +
      `If anything looks wrong, just reply to this email.\n\n` +
      `Best regards,\n${admin.name}\n${admin.email}`,
  });
}

/** User management: add users, assign roles per entity, remove — all persisted. */
export function Users() {
  const [users, setUsers] = useState<User[]>(() => loadUsers(seedUsers));
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const commit = (next: User[]) => {
    setUsers(next);
    saveUsers(next);
  };

  const setRole = (email: string, role: Role) => {
    commit(users.map((u) => (u.email === email ? { ...u, role } : u)));
  };

  const removeUser = (u: User) => {
    if (!confirm(`Remove ${u.name} (${u.email})?`)) return;
    commit(users.filter((x) => x.email !== u.email));
    setEditing(null);
  };

  const addUser = () => {
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name || !email) {
      alert('Name and email are required.');
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === email)) {
      alert('A user with this email already exists.');
      return;
    }
    const created: User = {
      name,
      email,
      team: form.team,
      role: form.role,
      scope: form.role === 'approver' || form.role === 'treasury' ? form.team : '—',
      last: 'Invited',
      // Submitters/approvers work on the entity they were added under;
      // admin/treasury see everything via permissions.
      assignedEntities:
        form.role === 'submitter' || form.role === 'approver' ? [form.team] : undefined,
    };
    commit([...users, created]);
    setForm(EMPTY_FORM);
    setAdding(false);
    // Hand the setup information straight to Outlook for the admin to send.
    openSetupEmail(created);
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Administration"
        title="User Management"
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add User
          </button>
        }
      />
      <div className="content">
        <div className="panel">
          <div className="panel-body no-pad">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Entity / Team</th>
                  <th>Role</th>
                  <th>Approval For</th>
                  <th>Last Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isEditing = editing === u.email;
                  return (
                    <tr key={u.email}>
                      <td>
                        <div className="row-flex">
                          <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                            {initials(u.name)}
                          </div>
                          <strong>{u.name}</strong>
                        </div>
                      </td>
                      <td className="text-dim">{u.email}</td>
                      <td className="text-dim">{u.team}</td>
                      <td>
                        {isEditing ? (
                          <select
                            className="form-select"
                            style={{ width: 'auto', padding: '4px 8px' }}
                            value={u.role}
                            onChange={(e) => setRole(u.email, e.target.value as Role)}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`role-tag ${u.role}`}>{u.role}</span>
                        )}
                      </td>
                      <td className="text-dim" style={{ fontSize: 12 }}>
                        {u.scope}
                      </td>
                      <td className="text-muted" style={{ fontSize: 12 }}>
                        {u.last}
                      </td>
                      <td>
                        <div className="row-flex">
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            title="Open a prefilled setup email in Outlook"
                            onClick={() => openSetupEmail(u)}
                          >
                            Email Setup
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => setEditing(isEditing ? null : u.email)}
                          >
                            {isEditing ? 'Done' : 'Edit'}
                          </button>
                          {isEditing && (
                            <button
                              className="btn btn-danger"
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={() => removeUser(u)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={adding}
        title="Add User"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={addUser}>
              Add &amp; Compose Invite
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
            <label className="form-label">Entity / Team</label>
            <select
              className="form-select"
              value={form.team}
              onChange={(e) => setForm({ ...form, team: e.target.value })}
            >
              {entities.map((en) => (
                <option key={en.name} value={en.name}>
                  {en.name}
                </option>
              ))}
              <option>Treasury HQ</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
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
          </div>
        </div>
      </Modal>
    </div>
  );
}
