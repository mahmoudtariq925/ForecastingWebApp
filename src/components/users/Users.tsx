import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { users as seedUsers } from '../../data/mockData';
import { loadUsers, saveUsers } from '../../storage/localStorage';
import type { Role, User } from '../../types';
import type { ModalId } from '../../types/nav';

interface UsersProps {
  onOpenModal: (id: ModalId) => void;
}

const ROLES: Role[] = ['submitter', 'approver', 'treasury', 'admin'];

const initials = (name: string) =>
  name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('');

/** User management with per-user role assignment persisted to storage. */
export function Users({ onOpenModal }: UsersProps) {
  const [users, setUsers] = useState<User[]>(() => loadUsers(seedUsers));
  const [editing, setEditing] = useState<string | null>(null);

  const setRole = (email: string, role: Role) => {
    const next = users.map((u) => (u.email === email ? { ...u, role } : u));
    setUsers(next);
    saveUsers(next);
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Administration"
        title="User Management"
        actions={
          <button className="btn btn-primary" onClick={() => onOpenModal('newUser')}>
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
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => setEditing(isEditing ? null : u.email)}
                        >
                          {isEditing ? 'Done' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
