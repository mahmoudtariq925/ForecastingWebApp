// Thin services over the repositories for the simpler resources. Business
// rules (duplicate checks, key validation) live here so controllers stay
// pure HTTP and repositories stay pure persistence.
import type {
  ApprovalMap,
  Cycle,
  Entity,
  Settings,
  Submission,
  SubmissionStatus,
  User,
  Variance,
} from '../../../shared/types';
import type { Repositories } from '../repositories/index.js';
import { badRequest, conflict, notFound } from './errors.js';

export class EntitiesService {
  constructor(private repos: Repositories) {}
  list(): Entity[] {
    return this.repos.entities.list();
  }
}

export class UsersService {
  constructor(private repos: Repositories) {}
  list(): User[] {
    return this.repos.users.list();
  }
  create(user: User): User {
    if (!user.name?.trim() || !user.email?.trim()) throw badRequest('Name and email are required');
    const email = user.email.trim().toLowerCase();
    if (this.repos.users.getByEmail(email)) throw conflict('A user with this email already exists');
    const created: User = { ...user, email, name: user.name.trim() };
    this.repos.users.create(created);
    return created;
  }
  update(email: string, patch: Partial<User>): User {
    const updated = this.repos.users.update(email, patch);
    if (!updated) throw notFound('User');
    return updated;
  }
  remove(email: string): void {
    if (!this.repos.users.remove(email)) throw notFound('User');
  }
}

export class CyclesService {
  constructor(private repos: Repositories) {}
  list(): Cycle[] {
    return this.repos.cycles.list();
  }
  create(cycle: Cycle): Cycle {
    if (!cycle.id?.trim()) throw badRequest('Cycle ID is required');
    if (this.repos.cycles.getById(cycle.id)) throw conflict(`Cycle ${cycle.id} already exists`);
    this.repos.cycles.create(cycle);
    return cycle;
  }
  update(id: string, patch: Partial<Cycle>): Cycle {
    const updated = this.repos.cycles.update(id, patch);
    if (!updated) throw notFound('Cycle');
    return updated;
  }
}

export class SettingsService {
  constructor(private repos: Repositories) {}
  get(): Settings {
    return this.repos.settings.get();
  }
  put(settings: Settings): Settings {
    this.repos.settings.put(settings);
    return settings;
  }
}

export class SubmissionsService {
  constructor(private repos: Repositories) {}
  list(filter?: { period?: string; entity?: string }): Submission[] {
    return this.repos.submissions.list(filter);
  }
  get(period: string, entity: string, templateId: string): Submission {
    const sub = this.repos.submissions.get(period, entity, templateId);
    if (!sub) throw notFound('Submission');
    return sub;
  }
  upsert(submission: Submission): Submission {
    if (!submission.period || !submission.entity || !submission.templateId) {
      throw badRequest('period, entity and templateId are required');
    }
    this.repos.submissions.upsert({
      ...submission,
      updatedAt: new Date().toISOString(),
    });
    return this.repos.submissions.get(submission.period, submission.entity, submission.templateId)!;
  }
}

export class ApprovalsService {
  constructor(private repos: Repositories) {}
  getForCycle(cycleId: string): ApprovalMap {
    return this.repos.approvals.getForCycle(cycleId);
  }
  decide(cycleId: string, entity: string, status: SubmissionStatus): ApprovalMap {
    if (!['approved', 'rejected', 'pending', 'submitted'].includes(status)) {
      throw badRequest(`Invalid approval status: ${status}`);
    }
    this.repos.approvals.set(cycleId, entity, status);
    return this.repos.approvals.getForCycle(cycleId);
  }
}

export class VariancesService {
  constructor(private repos: Repositories) {}
  list(): Variance[] {
    return this.repos.variances.list();
  }
}
