import { useEffect, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { ErrorView, LoadingView } from '../common/Async';
import { useApi } from '../../hooks/useApi';
import {
  createUser,
  deleteUser,
  getEntities,
  getUsers,
  updateUser,
} from '../../api/resources';
import type { Role, User } from '../../types';

const ROLES: Role[] = ['submitter', 'approver', 'treasury', 'admin'];

const initials = (name: string) =>
  name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('');

/** User management: add users, assign roles per entity, remove — all via API. */
export function Users() {
  const { data, error, loading, reload } = useApi(() =>
    Promise.all([getUsers(), getEntities()]),
  );
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', team: '', role: 'submitter' as Role });
  useEffect(() => {
    if (data) {
      setUsers(data[0]);
      setForm((f) => ({ ...f, team: f.team || data[1][0]?.name || '' }));
    }
  }, [data]);

  if (error) return <ErrorView crumb="Administration" title="User Management" message={error} onRetry={reload} />;
  if (loading && users.length === 0) return <LoadingView crumb="Administration" title="User Management" />;
  const entities = data?.[1] ?? [];

  const fail = (err: unknown) =>
    alert(`Request failed: ${err instanceof Error ? err.message : String(err)}`);

  const setRole = async (email: string, role: Role) => {
    try {
      const updated = await updateUser(email, { role });
      setUsers((prev) => prev.map((u) => (u.email === email ? updated : u)));
    } catch (err) {
      fail(err);
    }
  };

  const removeUser = async (u: User) => {
    if (!confirm(`Remove ${u.name} (${u.email})?`)) return;
    try {
      await deleteUser(u.email);
      setUsers((prev) => prev.filter((x) => x.email !== u.email));
      setEditing(null);
    } catch (err) {
      fail(err);
    }
  };

  const addUser = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      alert('Name and email are required.');
      return;
    }
    try {
      const created = await createUser({
        name: form.name,
        email: form.email,
        team: form.team,
        role: form.role,
        scope: form.role === 'approver' || form.role === 'treasury' ? form.team : '—',
        last: 'Invited',
      });
      setUsers((prev) => [...prev, created]);
      setForm({ name: '', email: '', team: entities[0]?.name ?? '', role: 'submitter' });
      setAdding(false);
    } catch (err) {
      fail(err);
    }
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
              Send Invite
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
