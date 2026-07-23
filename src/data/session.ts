// ============================================================================
// The signed-in user. Phase 1 has no authentication, so the session is the
// seeded Treasury admin from the managed user list; Phase 3 replaces this
// with the Azure AD identity. Everything that needs "who am I" (sidebar
// card, uploadedBy stamps, email signatures) goes through here.
// ============================================================================
import type { User } from '../types';
import { users as seedUsers } from './mockData';
import { loadUsers } from '../storage/localStorage';

export function currentUser(): User {
  const users = loadUsers(seedUsers);
  return users.find((u) => u.role === 'admin') ?? users[0] ?? seedUsers[0];
}
